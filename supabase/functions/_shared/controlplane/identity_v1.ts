// ServiceOS — OpenFolk Identity Resolution V1 (governed operator-review workflow).
//
// A UNIFIED, read-only projection of identity candidates across channels (email address /
// alias / mailbox, telephone extension / DDI, telephony-provider identity, and — structurally —
// future Commusoft / Slack), each mapped toward a canonical team_member. This module REUSES the
// existing pure suggestion engines (computeIdentityResolution / computeTelephonyIdentityResolution)
// and the append-only review ledger; it adds (1) a single candidate shape, (2) a derived mapping
// state, and (3) a read-only impact preview. It NEVER writes and NEVER auto-confirms: confirmation
// is a separate, capability-gated operator action (see index.ts `identity.review`).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeIdentityResolution, type IdentityResolution } from "./store.ts";
import {
  computeTelephonyIdentityResolution,
  type TelephonyEndpointCandidate,
} from "./telephony_discovery.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type IdentityMappingState =
  | "discovered" // endpoint exists, no suggestion, no decision
  | "suggested" // a member is suggested, not yet decided
  | "conflicting" // more than one candidate member / provider conflict
  | "confirmed" // an active verified link OR a confirmed_person decision
  | "shared" // shared/team mailbox or line — never an individual
  | "rejected" // operator rejected the suggestion
  | "deferred" // operator deferred pending more evidence
  | "historical" // superseded (endpoint inactive / effective_to set)
  | "unassigned"; // intentionally unassigned (or unresolved, no candidate)

export type IdentityChannel = "email" | "phone" | "slack" | "commusoft";
export type IdentityCandidateKind =
  | "email_address"
  | "email_alias"
  | "mailbox"
  | "extension"
  | "ddi"
  | "telephony_provider"
  | "commusoft"
  | "slack";
export type Confidence = "high" | "medium" | "low" | "unresolved";

export interface IdentityCandidate {
  key: string;
  endpointId: string | null;
  channel: IdentityChannel;
  candidateKind: IdentityCandidateKind;
  provider: string | null; // provider / source (evidence only, never inferred identity)
  rawExternalIdentity: string; // the raw external identity value
  isShared: boolean;
  suggestedMemberId: string | null;
  suggestedMemberName: string | null;
  suggestedKind: "person" | "shared" | "none";
  confidence: Confidence;
  mappingState: IdentityMappingState;
  supportingEvidence: string[];
  conflictingEvidence: string[];
  lastObservedAt: string | null;
  activityCount: number | null; // e.g. telephony call_count; null when not tracked
  latestDecision: string | null;
}

export interface IdentityCandidateSet {
  tenantId: string;
  generatedAt: string;
  candidates: IdentityCandidate[];
  summary: {
    total: number;
    byState: Record<string, number>;
    byChannel: Record<string, number>;
    confirmed: number;
    needsReview: number; // discovered + suggested + conflicting
  };
}

// ── Pure: derive the mapping state from existing signals ──────────────────────
export function deriveMappingState(a: {
  active: boolean;
  hasConfirmedLink: boolean;
  latestDecision: string | null;
  suggestedMemberId: string | null;
  suggestedKind: "person" | "shared" | "none";
  ambiguityCount: number;
}): IdentityMappingState {
  if (!a.active) return "historical";
  if (a.hasConfirmedLink || a.latestDecision === "confirmed_person") return "confirmed";
  switch (a.latestDecision) {
    case "shared":
    case "team":
      return "shared";
    case "rejected":
      return "rejected";
    case "deferred":
      return "deferred";
    case "unassigned":
    case "system":
      return "unassigned";
    case "unresolved":
      return a.ambiguityCount > 0 ? "conflicting" : "unassigned";
  }
  if (a.ambiguityCount > 0) return "conflicting";
  if (a.suggestedKind === "shared") return "shared";
  if (a.suggestedMemberId) return "suggested";
  return "discovered";
}

const EMAIL_KIND: Record<string, IdentityCandidateKind> = {
  email: "email_address",
  email_alias: "email_alias",
  shared_mailbox: "mailbox",
  group_address: "mailbox",
};

// ── Pure: unify email + telephony resolution into one candidate list ──────────
export interface UnifyInput {
  emailRes: IdentityResolution;
  telephony: { candidates: TelephonyEndpointCandidate[] };
  endpointsById: Map<string, Row>; // id -> {endpoint_kind, provider, is_shared, normalized_value, status, effective_to}
  membersById: Map<string, string>; // id -> display_name
  confirmedEndpointIds: Set<string>;
}
export function unifyCandidates(inp: UnifyInput): IdentityCandidate[] {
  const { emailRes, telephony, endpointsById, membersById, confirmedEndpointIds } = inp;
  const name = (id: string | null) => (id ? (membersById.get(id) ?? null) : null);
  const latestByEndpoint = new Map<string, string>();
  for (const r of emailRes.reviews)
    if (!latestByEndpoint.has(r.endpoint_id)) latestByEndpoint.set(r.endpoint_id, r.decision);

  const out: IdentityCandidate[] = [];

  // Email candidates
  for (const s of emailRes.suggestions) {
    const ep = endpointsById.get(s.endpoint_id) ?? {};
    const active = (ep.status ?? "active") === "active" && !ep.effective_to;
    const latest = latestByEndpoint.get(s.endpoint_id) ?? null;
    const ambiguityNames = (s.ambiguity ?? []).map((id) => name(id) ?? id);
    out.push({
      key: s.endpoint_id,
      endpointId: s.endpoint_id,
      channel: "email",
      candidateKind: EMAIL_KIND[ep.endpoint_kind as string] ?? "email_address",
      provider: (ep.provider as string) ?? "google_workspace",
      rawExternalIdentity: s.endpoint_email,
      isShared: !!ep.is_shared || s.suggested_kind === "shared",
      suggestedMemberId: s.suggested_member_id,
      suggestedMemberName: name(s.suggested_member_id),
      suggestedKind: s.suggested_kind,
      confidence: s.confidence,
      mappingState: deriveMappingState({
        active,
        hasConfirmedLink: confirmedEndpointIds.has(s.endpoint_id),
        latestDecision: latest,
        suggestedMemberId: s.suggested_member_id,
        suggestedKind: s.suggested_kind,
        ambiguityCount: (s.ambiguity ?? []).length,
      }),
      supportingEvidence: [s.evidence, s.provenance].filter(Boolean) as string[],
      conflictingEvidence:
        ambiguityNames.length > 0
          ? [`${ambiguityNames.length} candidate members: ${ambiguityNames.join(", ")}`]
          : [],
      lastObservedAt: null,
      activityCount: null,
      latestDecision: latest,
    });
  }

  // Telephony candidates (extensions today; DDIs when present — each its own endpoint,
  // so an extension and a DDI can map to different people).
  for (const c of telephony.candidates) {
    const ep = endpointsById.get(c.endpoint_id) ?? {};
    const active = (ep.status ?? "active") === "active" && !ep.effective_to;
    const latest = latestByEndpoint.get(c.endpoint_id) ?? null;
    const kind: IdentityCandidateKind = ep.endpoint_kind === "ddi" ? "ddi" : "extension";
    const ambiguityNames = (c.ambiguity ?? []).map((id) => name(id) ?? id);
    const conflicts: string[] = [];
    if (ambiguityNames.length)
      conflicts.push(`${ambiguityNames.length} candidate members: ${ambiguityNames.join(", ")}`);
    if ((c.unknown_label_names ?? []).length)
      conflicts.push(`unrecognised label names: ${c.unknown_label_names.join(", ")}`);
    out.push({
      key: c.endpoint_id,
      endpointId: c.endpoint_id,
      channel: "phone",
      candidateKind: kind,
      provider: (ep.provider as string) ?? "telephony",
      rawExternalIdentity: c.endpoint_extension || (ep.normalized_value as string) || "",
      isShared: !!ep.is_shared || c.suggested_kind === "shared",
      suggestedMemberId: c.suggested_member_id,
      suggestedMemberName: name(c.suggested_member_id),
      suggestedKind: c.suggested_kind,
      confidence: c.confidence,
      mappingState: deriveMappingState({
        active,
        hasConfirmedLink: confirmedEndpointIds.has(c.endpoint_id),
        latestDecision: latest,
        suggestedMemberId: c.suggested_member_id,
        suggestedKind: c.suggested_kind,
        ambiguityCount: (c.ambiguity ?? []).length,
      }),
      // Provider labels are evidence only — never an inferred answered-by identity.
      supportingEvidence: [
        c.evidence,
        c.provenance,
        ...(c.observed_labels ?? []).map((l) => `label: ${l}`),
      ].filter(Boolean) as string[],
      conflictingEvidence: conflicts,
      lastObservedAt: c.last_activity ?? null,
      activityCount: c.call_count ?? null,
      latestDecision: latest,
    });
  }

  return out;
}

export function summarise(candidates: IdentityCandidate[]): IdentityCandidateSet["summary"] {
  const byState: Record<string, number> = {};
  const byChannel: Record<string, number> = {};
  for (const c of candidates) {
    byState[c.mappingState] = (byState[c.mappingState] ?? 0) + 1;
    byChannel[c.channel] = (byChannel[c.channel] ?? 0) + 1;
  }
  const needsReview =
    (byState.discovered ?? 0) + (byState.suggested ?? 0) + (byState.conflicting ?? 0);
  return {
    total: candidates.length,
    byState,
    byChannel,
    confirmed: byState.confirmed ?? 0,
    needsReview,
  };
}

// ── Gather (READ-ONLY, tenant-scoped) ────────────────────────────────────────
export async function gatherIdentityCandidates(
  db: SupabaseClient,
  tenantId: string,
  now: string,
): Promise<IdentityCandidateSet> {
  const [emailRes, telephony, endpoints, members, links] = await Promise.all([
    computeIdentityResolution(db, tenantId),
    computeTelephonyIdentityResolution(db, tenantId),
    db
      .from("communication_endpoints")
      .select("id, endpoint_kind, provider, is_shared, normalized_value, status, effective_to")
      .eq("tenant_id", tenantId),
    db
      .from("team_members")
      .select("id, display_name")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
    db
      .from("member_integration_identities")
      .select("external_ref, verification_state")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
  ]);

  const endpointsById = new Map<string, Row>();
  for (const e of (endpoints.data ?? []) as Row[]) endpointsById.set(e.id, e);
  const membersById = new Map<string, string>();
  for (const m of (members.data ?? []) as Row[]) membersById.set(m.id, m.display_name);

  // Confirmed = an active verified identity whose external_ref matches an endpoint value.
  const verifiedRefs = new Set(
    ((links.data ?? []) as Row[])
      .filter((l) => l.verification_state === "verified")
      .map((l) => String(l.external_ref).toLowerCase()),
  );
  const confirmedEndpointIds = new Set<string>();
  for (const [id, ep] of endpointsById)
    if (verifiedRefs.has(String(ep.normalized_value).toLowerCase())) confirmedEndpointIds.add(id);

  const candidates = unifyCandidates({
    emailRes,
    telephony,
    endpointsById,
    membersById,
    confirmedEndpointIds,
  });
  return { tenantId, generatedAt: now, candidates, summary: summarise(candidates) };
}

// ── Impact preview (READ-ONLY): what a confirmation would associate ───────────
export interface IdentityImpact {
  endpointId: string;
  channel: string;
  rawExternalIdentity: string;
  interactions: number;
  intelligenceObjects: number;
  unresolvedActions: number;
  sampleInteractionIds: string[];
  note: string | null;
}

export async function gatherIdentityImpact(
  db: SupabaseClient,
  tenantId: string,
  endpointId: string,
): Promise<IdentityImpact> {
  const { data: ep } = await db
    .from("communication_endpoints")
    .select("id, channel, normalized_value")
    .eq("tenant_id", tenantId)
    .eq("id", endpointId)
    .maybeSingle();
  const base: IdentityImpact = {
    endpointId,
    channel: (ep?.channel as string) ?? "unknown",
    rawExternalIdentity: (ep?.normalized_value as string) ?? "",
    interactions: 0,
    intelligenceObjects: 0,
    unresolvedActions: 0,
    sampleInteractionIds: [],
    note: null,
  };
  if (!ep) return { ...base, note: "endpoint not found in tenant" };

  if (ep.channel === "email") {
    const value = String(ep.normalized_value).toLowerCase();
    // Interactions authored by, or addressed to, this address.
    const { data: ints } = await db
      .from("interactions")
      .select("id")
      .eq("tenant_id", tenantId)
      .or(`from_address.eq.${value},to_addresses.cs.{${value}}`)
      .limit(2000);
    const ids = ((ints ?? []) as Row[]).map((r) => r.id as string);
    let intel = 0;
    let unresolved = 0;
    if (ids.length) {
      const chunk = ids.slice(0, 1000); // bound the overlap filter
      const { data: objs } = await db
        .from("intelligence_objects")
        .select("id, object_type, accountable_ref")
        .eq("tenant_id", tenantId)
        .overlaps("source_interactions", chunk)
        .limit(3000);
      const rows = (objs ?? []) as Row[];
      intel = rows.length;
      unresolved = rows.filter(
        (r) => r.object_type === "Action" && r.accountable_ref == null,
      ).length;
    }
    return {
      ...base,
      interactions: ids.length,
      intelligenceObjects: intel,
      unresolvedActions: unresolved,
      sampleInteractionIds: ids.slice(0, 5),
      note: ids.length >= 2000 ? "interaction count capped at 2000 (read-only preview)" : null,
    };
  }

  // Telephony/other: interaction linkage for an extension is not reliably modelled yet —
  // report honestly rather than fabricate an association.
  return {
    ...base,
    note: "interaction-level impact for this channel is not yet derivable (no reliable extension→interaction link)",
  };
}
