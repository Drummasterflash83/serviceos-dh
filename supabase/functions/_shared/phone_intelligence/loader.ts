// ServiceOS — PHONE INTELLIGENCE V1: DB loader for the orchestration core.
//
// Assembles the deterministic ComputeInput for ONE call/transcript from tenant-scoped
// rows, following the real linkage:
//   phone_transcripts → phone_recordings.provider_call_id → phone_calls
//   → interactions(source_table='phone_calls') → related_person_id → graph_nodes
// Every query is tenant-scoped. Never reads graph-node phone properties (they hold only
// has_phone/has_email flags). No full phone numbers are logged. Works in both the Deno
// worker and node (backfill) by taking the client in — the SupabaseClient type import is
// type-only (erased at runtime).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { ComputeInput, DirectoryRow } from "./persist.ts";
import type { VocabularyEntry } from "./vocabulary.ts";
import type { KnownPerson } from "./spoken_name.ts";
import type { NumberMatch } from "./participants.ts";

export interface LoadedIds {
  tenantId: string;
  callId: string;
  transcriptId: string;
  insightId: string | null;
}

export interface LoadResult {
  ids: LoadedIds;
  input: ComputeInput;
  /** Diagnostics safe to log (no PII). */
  meta: { hasCall: boolean; hasInteraction: boolean; directoryRows: number; vocabRows: number };
}

type Db = SupabaseClient;

/** Rough transcript-quality heuristic (0..1) until a provider/ASR score exists. */
function estimateQuality(text: string): number {
  const len = text.trim().length;
  if (len < 40) return 0.4;
  if (len < 120) return 0.6;
  return 0.75;
}

/**
 * Load everything the compute core needs for one transcript. Returns null when the
 * transcript or its call cannot be resolved for this tenant (caller treats as skip).
 */
export async function loadCallIntelligenceInput(
  db: Db,
  args: { tenantId: string; transcriptId: string },
): Promise<LoadResult | null> {
  const { tenantId, transcriptId } = args;

  const { data: transcript } = await db
    .from("phone_transcripts")
    .select("id, recording_id, transcript_text")
    .eq("tenant_id", tenantId)
    .eq("id", transcriptId)
    .maybeSingle();
  if (!transcript) return null;
  const transcriptText = (transcript.transcript_text as string | null) ?? null;
  const recordingId = (transcript.recording_id as string | null) ?? null;

  // transcript → recording → provider_call_id/linked_id
  let providerCallId: string | null = null;
  let recLinkedId: string | null = null;
  if (recordingId) {
    const { data: rec } = await db
      .from("phone_recordings")
      .select("provider_call_id, linked_id")
      .eq("tenant_id", tenantId)
      .eq("id", recordingId)
      .maybeSingle();
    providerCallId = (rec?.provider_call_id as string | null) ?? null;
    recLinkedId = (rec?.linked_id as string | null) ?? null;
  }

  // recording → phone_call (by provider_call_id, else linked_id)
  let call: Record<string, unknown> | null = null;
  for (const [col, val] of [
    ["provider_call_id", providerCallId],
    ["linked_id", recLinkedId],
  ] as const) {
    if (!val || call) continue;
    const { data } = await db
      .from("phone_calls")
      .select("id, from_number, to_number, direction, raw_payload")
      .eq("tenant_id", tenantId)
      .eq(col, val)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) call = data;
  }
  if (!call) return null;
  const callId = call.id as string;

  // call → canonical interaction → related person/company
  const { data: interaction } = await db
    .from("interactions")
    .select("related_person_id, related_company_id")
    .eq("tenant_id", tenantId)
    .eq("source_table", "phone_calls")
    .eq("source_id", callId)
    .limit(1)
    .maybeSingle();

  let externalMatch: NumberMatch | null = null;
  const relatedPerson = (interaction?.related_person_id as string | null) ?? null;
  const relatedCompany = (interaction?.related_company_id as string | null) ?? null;
  const entityId = relatedPerson ?? relatedCompany;
  if (entityId) {
    const { data: node } = await db
      .from("graph_nodes")
      .select("id, label, node_type")
      .eq("tenant_id", tenantId)
      .eq("id", entityId)
      .maybeSingle();
    if (node)
      externalMatch = {
        entityId: node.id as string,
        displayName: (node.label as string | null) ?? "External contact",
        kind: (node.node_type as string) === "company" ? "company" : "person",
        confidence: 0.85,
        source: "interaction_linkage",
      };
  }

  // existing insight (for identity_summary enrichment)
  let insightId: string | null = null;
  if (recordingId) {
    const { data: insight } = await db
      .from("phone_ai_insights")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("recording_id", recordingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    insightId = (insight?.id as string | null) ?? null;
  }

  // tenant configuration
  const { data: dirRows } = await db
    .from("telephony_directory")
    .select(
      "extension, e164_number, endpoint_ref, person_node_id, role, is_shared_device, confidence, source, metadata",
    )
    .eq("tenant_id", tenantId)
    .eq("active", true);
  const directory: DirectoryRow[] = (dirRows ?? []).map((d) => ({
    extension: (d.extension as string) ?? "",
    e164Number: (d.e164_number as string | null) ?? null,
    endpointRef:
      (d.endpoint_ref as string | null) ??
      ((d.metadata as Record<string, unknown> | null)?.endpoint_ref as string | null) ??
      null,
    personId: (d.person_node_id as string | null) ?? null,
    displayName: null, // filled from people below
    role: (d.role as string | null) ?? null,
    isSharedDevice: (d.is_shared_device as boolean) ?? false,
    confidence: Number(d.confidence ?? 0.9),
    source: (d.source as string) ?? "configured",
  }));

  const { data: vocabRows } = await db
    .from("tenant_vocabulary")
    .select("term, category, aliases, phonetic_variants, confidence")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  const vocabulary: VocabularyEntry[] = (vocabRows ?? []).map((v) => ({
    term: v.term as string,
    category: (v.category as string) ?? "terminology",
    aliases: (v.aliases as string[] | null) ?? [],
    phoneticVariants: (v.phonetic_variants as string[] | null) ?? [],
    confidence: Number(v.confidence ?? 0.8),
    active: true,
  }));

  // tenant people (for spoken-name matching + directory display names)
  const { data: peopleRows } = await db
    .from("graph_nodes")
    .select("id, label")
    .eq("tenant_id", tenantId)
    .eq("node_type", "person")
    .limit(2000);
  const knownPeople: KnownPerson[] = (peopleRows ?? [])
    .filter((p) => p.label)
    .map((p) => ({ id: p.id as string, name: p.label as string }));
  const nameById = new Map(knownPeople.map((p) => [p.id, p.name]));
  for (const d of directory) if (d.personId) d.displayName = nameById.get(d.personId) ?? null;

  const { data: tenant } = await db
    .from("tenants")
    .select("display_name")
    .eq("id", tenantId)
    .maybeSingle();

  const input: ComputeInput = {
    rawPayload: (call.raw_payload as Record<string, unknown> | null) ?? {},
    fromNumber: (call.from_number as string | null) ?? null,
    toNumber: (call.to_number as string | null) ?? null,
    transcriptText,
    transcriptQuality: transcriptText ? estimateQuality(transcriptText) : undefined,
    directory,
    vocabulary,
    knownPeople,
    externalMatch,
    companyName: (tenant?.display_name as string | null) ?? null,
  };

  return {
    ids: { tenantId, callId, transcriptId, insightId },
    input,
    meta: {
      hasCall: true,
      hasInteraction: !!interaction,
      directoryRows: directory.length,
      vocabRows: vocabulary.length,
    },
  };
}
