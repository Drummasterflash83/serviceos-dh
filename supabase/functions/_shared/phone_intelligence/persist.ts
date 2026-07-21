// ServiceOS — PHONE INTELLIGENCE V1: orchestration + persistence adapter.
//
// One place that turns a call + transcript + tenant configuration into explainable
// intelligence and writes it idempotently. The COMPUTE core is PURE (fully testable);
// the DB layer only loads tenant-scoped rows and upserts. Identity logic is NOT
// duplicated here — it delegates to the engine modules. Raw payload and raw transcript
// are never mutated.

import { classifyCallDirection, type DirectionResult } from "./direction.ts";
import { canonicaliseCall, type CanonicalCallEvidence } from "./provider_adapter.ts";
import { detectSpokenNames, type KnownPerson } from "./spoken_name.ts";
import {
  normaliseTranscript,
  type NormalisationResult,
  type VocabularyEntry,
} from "./vocabulary.ts";
import {
  resolveInternalParticipant,
  resolveExternalParticipant,
  resolveCallIdentity,
  type CallIdentity,
  type ExtensionMapping,
  type NumberMatch,
  type ResolvedParticipant,
} from "./participants.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const PIPELINE_VERSION = "v1";

/** A tenant telephony_directory row, already scoped to this tenant by the caller. */
export interface DirectoryRow {
  extension: string;
  e164Number: string | null;
  /** Opaque provider endpoint URI this mapping is for, if configured. */
  endpointRef: string | null;
  personId: string | null;
  displayName: string | null;
  role: string | null;
  isSharedDevice: boolean;
  confidence: number;
  source: string;
}

export interface ComputeInput {
  rawPayload: Record<string, unknown> | null | undefined;
  fromNumber: string | null;
  toNumber: string | null;
  transcriptText: string | null;
  transcriptQuality?: number;
  directory: DirectoryRow[];
  vocabulary: VocabularyEntry[];
  knownPeople: KnownPerson[];
  /** External-party canonical match from the interaction→person linkage (caller-fetched). */
  externalMatch: NumberMatch | null;
  companyName?: string | null;
}

export interface ComputedIntelligence {
  canonical: CanonicalCallEvidence;
  direction: DirectionResult;
  internal: ResolvedParticipant;
  external: ResolvedParticipant;
  identity: CallIdentity;
  normalisation: NormalisationResult | null;
  identitySummary: Record<string, unknown>;
  pipelineVersion: string;
}

/** Match a directory row to this call: by configured endpoint URI first, else by a
 *  real extension the provider supplied. Returns null when nothing is configured. */
function matchExtensionMapping(
  canonical: CanonicalCallEvidence,
  directory: DirectoryRow[],
): ExtensionMapping | null {
  const endpointRef =
    canonical.providerDirection?.toUpperCase() === "OUT"
      ? canonical.originatingEndpointRef
      : canonical.destinationEndpointRef;
  const extension =
    canonical.providerDirection?.toUpperCase() === "OUT"
      ? canonical.originatingExtension
      : canonical.answeringExtension;

  const byRef = endpointRef
    ? directory.find((d) => d.endpointRef && d.endpointRef === endpointRef)
    : null;
  const byExt = extension ? directory.find((d) => d.extension === extension) : null;
  const row = byRef ?? byExt;
  if (!row) return null;
  return {
    extension: row.extension,
    personId: row.personId,
    displayName: row.displayName,
    role: row.role,
    isSharedDevice: row.isSharedDevice,
    confidence: row.confidence,
    source: row.source,
  };
}

/**
 * PURE: compute all phone intelligence for one call. Deterministic — the same inputs
 * always produce the same output (so re-processing writes identical rows, never
 * duplicates). No DB, no provider calls, no mutation of inputs.
 */
export function computeCallIntelligence(input: ComputeInput): ComputedIntelligence {
  const canonical = canonicaliseCall({
    rawPayload: input.rawPayload,
    fromNumber: input.fromNumber,
    toNumber: input.toNumber,
  });

  const internalExtensions = input.directory.map((d) => d.extension).filter(Boolean);
  const direction = classifyCallDirection({
    rawPayload: input.rawPayload,
    internalExtensions,
  });

  const spokenNames = input.transcriptText
    ? detectSpokenNames({
        transcript: input.transcriptText,
        transcriptQuality: input.transcriptQuality,
        knownPeople: input.knownPeople,
      })
    : [];

  const extensionMapping = matchExtensionMapping(canonical, input.directory);
  const internal = resolveInternalParticipant({ extensionMapping, spokenNames });
  const external = resolveExternalParticipant({
    externalNumber: canonical.externalNumber,
    numberMatch: input.externalMatch,
    spokenNames,
  });

  const contextTerms = [input.companyName, internal.displayName, external.displayName].filter(
    (t): t is string => !!t,
  );
  const normalisation = input.transcriptText
    ? normaliseTranscript(input.transcriptText, input.vocabulary, { contextTerms })
    : null;

  const identity = resolveCallIdentity({
    direction: direction.direction,
    directionConfidence: direction.confidence,
    internal,
    external,
  });

  const identitySummary = {
    direction: direction.direction,
    direction_confidence: direction.confidence,
    internal: internal.resolvedEntityId
      ? {
          entity_id: internal.resolvedEntityId,
          name: internal.displayName,
          role: internal.staffRole,
          confidence: internal.confidence,
        }
      : null,
    external: external.resolvedEntityId
      ? {
          entity_id: external.resolvedEntityId,
          name: external.displayName,
          confidence: external.confidence,
        }
      : { number: canonical.externalNumber, unresolved: true },
    has_conflict: identity.hasConflict,
    unresolved: identity.unresolved,
    identity_confidence: identity.identityConfidence,
    corrections_applied: normalisation
      ? normalisation.corrections.filter((c) => c.applied).length
      : 0,
    pipeline_version: PIPELINE_VERSION,
  };

  return {
    canonical,
    direction,
    internal,
    external,
    identity,
    normalisation,
    identitySummary,
    pipelineVersion: PIPELINE_VERSION,
  };
}

/**
 * Build the honest RESOLVED CONTEXT block fed to the summary generator. States only
 * what is supported; unresolved/unknown participants are labelled as such so the model
 * never invents a name. Company name grounds "our side" without asserting the speaker.
 */
export function buildSummaryContext(
  computed: ComputedIntelligence,
  companyName?: string | null,
): string {
  const internal = computed.internal.resolvedEntityId
    ? `${computed.internal.displayName}${computed.internal.staffRole ? ` (${computed.internal.staffRole})` : ""} — confidence ${computed.internal.confidence.toFixed(2)}`
    : "Unknown team member (no confirmed extension mapping)";
  const external = computed.external.resolvedEntityId
    ? `${computed.external.displayName} — confidence ${computed.external.confidence.toFixed(2)}`
    : `Unresolved external caller${computed.canonical.externalNumber ? " (number on file)" : ""}`;
  const lines = [
    `Call direction: ${computed.direction.direction} (confidence ${computed.direction.confidence.toFixed(2)})`,
    `Tenant company: ${companyName ?? "the company"}`,
    `Internal participant: ${internal}`,
    `External participant: ${external}`,
    computed.identity.hasConflict
      ? "Identity conflict: metadata and the spoken introduction disagree — do not assert a single internal name."
      : "Identity conflict: none",
  ];
  return lines.join("\n");
}

// ── DB persistence (idempotent, tenant-scoped, failure-isolated) ─────────────
// The caller passes a service-role client and the already-validated tenant/call/
// transcript ids. Every write is scoped by tenant_id and keyed so re-processing
// updates in place (no duplicate rows). Best-effort per row: a phone-intelligence
// failure must never destroy the transcript, the call, or prior good intelligence.

type Db = SupabaseClient;

export interface PersistIds {
  tenantId: string;
  callId: string;
  transcriptId: string | null;
  insightId: string | null;
}

export async function persistComputed(
  db: Db,
  ids: PersistIds,
  computed: ComputedIntelligence,
): Promise<{ ok: boolean; wrote: string[]; error?: string }> {
  const wrote: string[] = [];
  try {
    const d = computed.direction;
    // 1) call_directions — one row per (tenant, call): upsert.
    await db.from("call_directions").upsert(
      {
        tenant_id: ids.tenantId,
        call_id: ids.callId,
        direction: d.direction,
        provider_direction: d.providerDirection,
        originating_number: d.originatingNumber,
        destination_number: d.destinationNumber,
        external_party_number: d.externalPartyNumber,
        originating_extension: d.originatingExtension,
        answering_extension: d.answeringExtension,
        pickup_extension: d.pickupExtension,
        transferred_from_extension: d.transferredFromExtension,
        transferred_to_extension: d.transferredToExtension,
        direction_evidence: d.evidence,
        direction_confidence: d.confidence,
        classifier_version: d.classifierVersion,
      },
      { onConflict: "tenant_id,call_id" },
    );
    wrote.push("call_directions");

    // 2) call_participants — idempotent: replace this call's rows for this resolver.
    await db
      .from("call_participants")
      .delete()
      .eq("tenant_id", ids.tenantId)
      .eq("call_id", ids.callId)
      .eq("resolver_version", computed.internal.resolverVersion);
    const rows = [computed.internal, computed.external]
      .filter((p) => p.role !== "unknown" || p.resolvedEntityId)
      .map((p) => ({
        tenant_id: ids.tenantId,
        call_id: ids.callId,
        participant_role: p.role,
        resolved_entity_id: p.resolvedEntityId,
        display_name: p.displayName,
        confidence: p.confidence,
        evidence: p.evidence,
        conflicts: p.conflicts,
        source_fields: p.sourceFields,
        resolver_version: p.resolverVersion,
      }));
    if (rows.length) await db.from("call_participants").insert(rows);
    wrote.push("call_participants");

    // 3) call_transcript_normalisations — upsert by (tenant, transcript, version).
    if (ids.transcriptId && computed.normalisation) {
      await db.from("call_transcript_normalisations").upsert(
        {
          tenant_id: ids.tenantId,
          transcript_id: ids.transcriptId,
          normalised_text: computed.normalisation.normalised,
          corrections: computed.normalisation.corrections,
          normalisation_version: computed.normalisation.version,
        },
        { onConflict: "tenant_id,transcript_id,normalisation_version" },
      );
      wrote.push("call_transcript_normalisations");
    }

    // 4) phone_ai_insights.identity_summary — enrich the existing insight in place.
    if (ids.insightId) {
      await db
        .from("phone_ai_insights")
        .update({ identity_summary: computed.identitySummary })
        .eq("tenant_id", ids.tenantId)
        .eq("id", ids.insightId);
      wrote.push("phone_ai_insights.identity_summary");
    }
    return { ok: true, wrote };
  } catch (e) {
    return { ok: false, wrote, error: e instanceof Error ? e.message : String(e) };
  }
}
