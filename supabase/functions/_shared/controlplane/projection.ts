// ServiceOS — OpenFolk Control Plane: tenant-facing DERIVED projection.
//
// The customer-facing Command Centre must NEVER read raw Control Plane tables. This maps
// a full internal OwnershipResolution to the minimal, tenant-safe shape the operational
// product needs — and enriches owner refs with human labels — while withholding provider
// metadata, identity records, audit history, platform grants and unrelated endpoint
// internals. §4 truthfulness: unresolved / team-role fallback / needs-config / historical-
// unavailable / low-confidence are surfaced honestly; a classifier name is never promoted
// to a confirmed owner, and an observed handoff moves the LIKELY HANDLER only.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { EndpointEvidence, OwnerRef, OwnershipResolution } from "./resolver.ts";
import { resolveForEvidence } from "./store.ts";

export type OwnershipStatus =
  | "resolved" // a confirmed accountable owner
  | "team_role_fallback" // only a team/role, no specific accountable person
  | "unresolved" // endpoint mapped but no owner effective at the time
  | "unmapped"; // no configured endpoint matched — needs OpenFolk configuration

export interface DerivedOwner {
  kind: string;
  label: string | null;
}
export interface DerivedOwnership {
  status: OwnershipStatus;
  accountable: DerivedOwner | null;
  likelyHandler: DerivedOwner | null;
  cover: DerivedOwner | null;
  escalation: DerivedOwner | null;
  explanation: string;
  confidence: number;
  historicalAssignmentRef: string | null;
  unresolvedReason: string | null;
  warnings: string[]; // display-safe codes (e.g. shared_endpoint, low_confidence, needs_configuration)
  needsConfiguration: boolean;
}

/** Pure: map an internal resolution to the tenant-safe derived shape (labels applied by
 * the impure helper below). */
export function deriveOwnership(
  r: OwnershipResolution,
  labels: Map<string, string>,
): DerivedOwnership {
  const status: OwnershipStatus = !r.matched
    ? "unmapped"
    : r.accountable
      ? "resolved"
      : r.teamOrRole
        ? "team_role_fallback"
        : "unresolved";
  const lbl = (o: OwnerRef | null): DerivedOwner | null =>
    o ? { kind: o.kind, label: (o.ref ? labels.get(o.ref) : null) ?? o.label ?? o.ref } : null;

  const warnings = [...r.warnings];
  if (status === "unmapped") warnings.push("needs_configuration");
  if (r.confidence > 0 && r.confidence < 0.5 && !warnings.includes("low_confidence")) {
    warnings.push("low_confidence");
  }

  return {
    status,
    accountable: lbl(r.accountable),
    likelyHandler: lbl(r.likelyCurrentHandler),
    cover: lbl(r.cover),
    escalation: lbl(r.escalation),
    explanation: r.explanation,
    confidence: r.confidence,
    historicalAssignmentRef: r.assignmentVersionId,
    unresolvedReason: r.unresolvedReason,
    warnings: [...new Set(warnings)],
    needsConfiguration: status === "unmapped",
  };
}

/** Impure: resolve ownership for a tenant's interaction evidence and return ONLY the
 * derived, label-enriched projection. This is what the tenant Command Centre consumes. */
export async function deriveOwnershipForEvidence(
  admin: SupabaseClient,
  tenantId: string,
  evidence: EndpointEvidence,
  nowMs: number,
  opts: { subjectRef?: string | null; subjectType?: string | null } = {},
): Promise<DerivedOwnership> {
  const resolution = await resolveForEvidence(admin, tenantId, evidence, nowMs, opts);

  // Collect owner refs needing a human label.
  const refs = new Set<string>();
  for (const o of [
    resolution.accountable,
    resolution.likelyCurrentHandler,
    resolution.cover,
    resolution.escalation,
    resolution.teamOrRole,
  ]) {
    if (o?.ref && (o.kind === "person" || o.kind === "team")) refs.add(o.ref);
  }
  const labels = new Map<string, string>();
  if (refs.size) {
    const ids = [...refs];
    const [{ data: members }, { data: units }] = await Promise.all([
      admin.from("team_members").select("id, display_name").eq("tenant_id", tenantId).in("id", ids),
      admin.from("org_units").select("id, name").eq("tenant_id", tenantId).in("id", ids),
    ]);
    for (const m of members ?? []) labels.set(m.id as string, m.display_name as string);
    for (const u of units ?? []) labels.set(u.id as string, u.name as string);
  }
  return deriveOwnership(resolution, labels);
}

// Configuration readiness is collected separately from ownership projection.
export { computeSourceReadiness } from "./readiness.ts";
export type { ReadinessLevel, ReadinessCheck, SourceReadiness } from "./readiness.ts";
