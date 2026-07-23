// ServiceOS — OpenFolk Control Plane: universal ownership resolver (PURE).
//
// resolveEndpointOwnership(evidence, endpoints, assignments, handoffs, nowMs, order)
// answers, for one interaction's endpoint evidence at a point in time:
//   which endpoint, who is ACCOUNTABLE, who normally HANDLES it, team/role, cover,
//   escalation, the effective assignment version, an explanation, confidence,
//   provenance, an unresolved reason and data-quality warnings.
//
// Deterministic and IO-free (injected clock). Historical lookups use the INTERACTION
// time, not "now". Static configuration answers "who normally owns/handles this
// endpoint"; an observed handoff may change the LIKELY CURRENT HANDLER without ever
// rewriting the accountable owner (the static/dynamic distinction, §9). Config-driven
// match order — the classifier's named-recipient hint contributes evidence but never
// overrides a configured owner.

export type MatchStep =
  "provider_ref" | "ddi" | "extension" | "queue" | "ring_group" | "normalized_value";

export const DEFAULT_MATCH_ORDER: MatchStep[] = [
  "provider_ref",
  "ddi",
  "extension",
  "queue",
  "ring_group",
  "normalized_value",
];

export interface EndpointEvidence {
  channel: string;
  provider?: string | null;
  providerExternalRef?: string | null;
  normalizedValue?: string | null;
  ddi?: string | null;
  extension?: string | null;
  queue?: string | null;
  ringGroup?: string | null;
  requestedName?: string | null; // classifier hint — evidence only, never authoritative
}

export interface EndpointRow {
  id: string;
  tenant_id: string;
  channel: string;
  endpoint_kind: string;
  normalized_value: string;
  display_value?: string | null;
  provider?: string | null;
  provider_external_ref?: string | null;
  is_shared: boolean;
  status: string;
}

export interface AssignmentRow {
  id: string;
  endpoint_id: string;
  owner_kind: "person" | "team" | "role" | "shared";
  owner_member_id?: string | null;
  owner_org_unit_id?: string | null;
  owner_role?: string | null;
  assignment_role: "accountable" | "primary_handler" | "cover" | "escalation";
  effective_from: string;
  effective_to?: string | null;
  confidence?: number | null;
  review_state: string;
}

export interface HandoffRow {
  to_party?: { kind?: string; ref?: string | null; label?: string | null } | null;
  occurred_at?: string | null;
  observed_state?: string | null;
}

export interface OwnerRef {
  kind: "person" | "team" | "role" | "shared";
  ref: string | null;
  label?: string | null;
}

export interface OwnershipResolution {
  matched: boolean;
  sourceEndpoint: { id: string; kind: string; value: string } | null;
  accountable: OwnerRef | null;
  primaryHandler: OwnerRef | null;
  likelyCurrentHandler: OwnerRef | null; // handler after any observed handoff (dynamic)
  teamOrRole: OwnerRef | null;
  cover: OwnerRef | null;
  escalation: OwnerRef | null;
  assignmentVersionId: string | null;
  explanation: string;
  confidence: number;
  provenance: string;
  unresolvedReason: string | null;
  warnings: string[];
  matchStep: MatchStep | null;
}

function norm(s: string | null | undefined): string {
  return (s ?? "").toString().trim().toLowerCase();
}

function ownerOf(a: AssignmentRow): OwnerRef {
  if (a.owner_kind === "person") return { kind: "person", ref: a.owner_member_id ?? null };
  if (a.owner_kind === "team") return { kind: "team", ref: a.owner_org_unit_id ?? null };
  if (a.owner_kind === "role")
    return { kind: "role", ref: a.owner_role ?? null, label: a.owner_role };
  return { kind: "shared", ref: null };
}

/** Endpoints matching the evidence for a given step. */
function matchByStep(
  step: MatchStep,
  ev: EndpointEvidence,
  endpoints: EndpointRow[],
): EndpointRow[] {
  const active = endpoints.filter((e) => e.status === "active");
  switch (step) {
    case "provider_ref":
      if (!ev.providerExternalRef) return [];
      return active.filter(
        (e) =>
          norm(e.provider_external_ref) === norm(ev.providerExternalRef) &&
          (!ev.provider || norm(e.provider) === norm(ev.provider)),
      );
    case "ddi":
      if (!ev.ddi) return [];
      return active.filter(
        (e) => e.endpoint_kind === "ddi" && norm(e.normalized_value) === norm(ev.ddi),
      );
    case "extension":
      if (!ev.extension) return [];
      return active.filter(
        (e) => e.endpoint_kind === "extension" && norm(e.normalized_value) === norm(ev.extension),
      );
    case "queue":
      if (!ev.queue) return [];
      return active.filter(
        (e) => e.endpoint_kind === "queue" && norm(e.normalized_value) === norm(ev.queue),
      );
    case "ring_group":
      if (!ev.ringGroup) return [];
      return active.filter(
        (e) => e.endpoint_kind === "ring_group" && norm(e.normalized_value) === norm(ev.ringGroup),
      );
    case "normalized_value":
      if (!ev.normalizedValue) return [];
      return active.filter((e) => norm(e.normalized_value) === norm(ev.normalizedValue));
  }
}

function effectiveAt(a: AssignmentRow, nowMs: number): boolean {
  if (a.review_state === "rejected") return false;
  const from = Date.parse(a.effective_from);
  const to = a.effective_to ? Date.parse(a.effective_to) : Infinity;
  return Number.isFinite(from) && from <= nowMs && nowMs < to;
}

export function resolveEndpointOwnership(input: {
  evidence: EndpointEvidence;
  endpoints: EndpointRow[];
  assignments: AssignmentRow[];
  handoffs?: HandoffRow[];
  nowMs: number;
  order?: MatchStep[];
}): OwnershipResolution {
  const { evidence: ev, endpoints, assignments, nowMs } = input;
  const order = input.order ?? DEFAULT_MATCH_ORDER;
  const warnings: string[] = [];

  const empty = (reason: string): OwnershipResolution => ({
    matched: false,
    sourceEndpoint: null,
    accountable: null,
    primaryHandler: null,
    likelyCurrentHandler: null,
    teamOrRole: null,
    cover: null,
    escalation: null,
    assignmentVersionId: null,
    explanation: reason,
    confidence: 0,
    provenance: "controlplane",
    unresolvedReason: reason,
    warnings: [...warnings, "unmapped_endpoint"],
    matchStep: null,
  });

  // ── Phase A: match the endpoint (config-driven order; first match wins). ──
  let endpoint: EndpointRow | null = null;
  let matchStep: MatchStep | null = null;
  for (const step of order) {
    const hits = matchByStep(step, ev, endpoints);
    if (hits.length > 0) {
      endpoint = hits[0];
      matchStep = step;
      if (hits.length > 1) warnings.push("ambiguous_endpoint_match");
      break;
    }
  }
  if (!endpoint) {
    return empty("No configured endpoint matched this interaction — needs OpenFolk mapping.");
  }

  // ── Phase B: resolve owners from assignments EFFECTIVE AT the interaction time. ──
  const live = assignments.filter((a) => a.endpoint_id === endpoint!.id && effectiveAt(a, nowMs));
  const byRole = (r: AssignmentRow["assignment_role"]) =>
    live.find((a) => a.assignment_role === r) ?? null;

  const accountableA = byRole("accountable");
  const handlerA = byRole("primary_handler");
  const coverA = byRole("cover");
  const escalationA = byRole("escalation");

  const accountable = accountableA ? ownerOf(accountableA) : null;
  const primaryHandler = handlerA ? ownerOf(handlerA) : null;
  const cover = coverA ? ownerOf(coverA) : null;
  const escalation = escalationA ? ownerOf(escalationA) : null;
  const teamOrRole =
    accountable && (accountable.kind === "team" || accountable.kind === "role")
      ? accountable
      : live.find((a) => a.owner_kind === "team" || a.owner_kind === "role")
        ? ownerOf(live.find((a) => a.owner_kind === "team" || a.owner_kind === "role")!)
        : null;

  // Dynamic: an observed handoff changes the LIKELY CURRENT HANDLER only — never accountable.
  const recentHandoff = (input.handoffs ?? [])
    .filter((h) => h.to_party?.ref && h.observed_state !== "rejected")
    .sort((a, b) => Date.parse(a.occurred_at ?? "") - Date.parse(b.occurred_at ?? ""))
    .at(-1);
  let likelyCurrentHandler: OwnerRef | null = primaryHandler ?? null;
  if (recentHandoff?.to_party?.ref) {
    likelyCurrentHandler = {
      kind: (recentHandoff.to_party.kind as OwnerRef["kind"]) ?? "person",
      ref: recentHandoff.to_party.ref,
      label: recentHandoff.to_party.label ?? null,
    };
    warnings.push("handler_from_observed_handoff");
  }

  let unresolvedReason: string | null = null;
  let confidence = 0.9;
  if (!accountable && !teamOrRole) {
    unresolvedReason = "Endpoint is mapped but has no owner effective at the interaction time.";
    warnings.push("no_effective_owner");
    confidence = 0.3;
  } else if (!accountable && teamOrRole) {
    confidence = 0.6; // team/role fallback, no specific accountable person
    warnings.push("team_or_role_fallback");
  } else {
    confidence = Math.min(0.95, accountableA?.confidence ?? 0.9);
  }
  if (endpoint.is_shared) warnings.push("shared_endpoint");

  const label = endpoint.display_value ?? endpoint.normalized_value;
  const explanation = accountable
    ? `${endpoint.endpoint_kind} ${label} → accountable ${accountable.kind}${accountable.ref ? ` ${accountable.ref}` : ""}${cover ? " (cover configured)" : ""}.`
    : teamOrRole
      ? `${endpoint.endpoint_kind} ${label} → ${teamOrRole.kind} ${teamOrRole.ref ?? ""} (no specific accountable person).`
      : `${endpoint.endpoint_kind} ${label} is mapped but unowned at this time.`;

  return {
    matched: true,
    sourceEndpoint: {
      id: endpoint.id,
      kind: endpoint.endpoint_kind,
      value: endpoint.normalized_value,
    },
    accountable,
    primaryHandler,
    likelyCurrentHandler,
    teamOrRole,
    cover,
    escalation,
    assignmentVersionId: accountableA?.id ?? null,
    explanation,
    confidence,
    provenance: "controlplane",
    unresolvedReason,
    warnings,
    matchStep,
  };
}
