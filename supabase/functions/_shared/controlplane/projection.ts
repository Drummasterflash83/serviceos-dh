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
  opts: { subjectRef?: string | null } = {},
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

// ── Source readiness gate (§2). ─────────────────────────────────────────────
export type ReadinessLevel =
  "not_ready" | "ready_for_evaluation" | "ready_for_chris_shadow" | "ready_for_staff_pilot";

export interface ReadinessCheck {
  key: string;
  ok: boolean;
  detail: string;
}
export interface SourceReadiness {
  channel: string;
  level: ReadinessLevel;
  checks: ReadinessCheck[];
  summary: string;
}

/** Assess whether a tenant's phone source is configured enough to activate — honestly.
 * Mapping some endpoints is NOT readiness. Also reports the Health policy/allowlist gates. */
export async function computeSourceReadiness(
  admin: SupabaseClient,
  tenantId: string,
): Promise<SourceReadiness> {
  const [{ data: endpoints }, { data: ownership }, { data: cv }, { data: allow }] =
    await Promise.all([
      admin
        .from("communication_endpoints")
        .select("id, endpoint_kind")
        .eq("tenant_id", tenantId)
        .eq("channel", "phone")
        .eq("status", "active"),
      admin
        .from("endpoint_ownership_assignments")
        .select("endpoint_id, assignment_role, review_state, confidence")
        .eq("tenant_id", tenantId)
        .is("effective_to", null),
      admin
        .from("config_versions")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("artifact_kind", "policy")
        .eq("artifact_key", "customer_health")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("operating_profile_entries")
        .select("value")
        .eq("tenant_id", tenantId)
        .eq("namespace", "customer_health")
        .eq("key", "source.allowlist")
        .maybeSingle(),
    ]);

  const byKind = (k: string) => (endpoints ?? []).filter((e) => e.endpoint_kind === k);
  const ddis = byKind("ddi");
  const exts = byKind("extension");
  const queues = [...byKind("queue"), ...byKind("ring_group")];
  const accByEndpoint = new Map<string, { review_state: string; confidence: number | null }>();
  const handlerEndpoints = new Set<string>();
  for (const o of ownership ?? []) {
    if (o.review_state === "rejected") continue;
    if (o.assignment_role === "accountable")
      accByEndpoint.set(o.endpoint_id as string, {
        review_state: o.review_state as string,
        confidence: (o.confidence as number | null) ?? null,
      });
    if (o.assignment_role === "primary_handler") handlerEndpoints.add(o.endpoint_id as string);
  }
  const mappedDdis = ddis.filter((e) => accByEndpoint.has(e.id as string));
  const conflicts = (ownership ?? []).filter((o) => o.review_state === "conflicted").length;
  const lowConf = [...accByEndpoint.values()].filter(
    (a) => a.confidence != null && a.confidence < 0.5,
  ).length;
  const policyDraft = (cv?.status as string | undefined) ?? "none";
  const allowEnabled =
    ((allow?.value as { enabled?: boolean } | undefined)?.enabled ?? false) === true;

  const checks: ReadinessCheck[] = [
    { key: "ddis_discovered", ok: ddis.length > 0, detail: `${ddis.length} DDI(s) discovered` },
    {
      key: "extensions_discovered",
      ok: exts.length > 0,
      detail: `${exts.length} extension(s) discovered`,
    },
    {
      key: "queues_discovered",
      ok: queues.length > 0,
      detail: `${queues.length} queue/ring-group(s) discovered`,
    },
    {
      key: "ddis_mapped",
      ok: ddis.length > 0 && mappedDdis.length === ddis.length,
      detail: `${mappedDdis.length}/${ddis.length} DDIs have accountable ownership`,
    },
    {
      key: "accountable_ownership",
      ok: accByEndpoint.size > 0,
      detail: `${accByEndpoint.size} endpoint(s) with accountable owner`,
    },
    {
      key: "primary_handling",
      ok: handlerEndpoints.size > 0,
      detail: `${handlerEndpoints.size} endpoint(s) with a primary handler`,
    },
    {
      key: "no_conflicts",
      ok: conflicts === 0,
      detail:
        conflicts === 0 ? "no conflicting assignments" : `${conflicts} conflicting assignment(s)`,
    },
    {
      key: "confidence_sufficient",
      ok: lowConf === 0,
      detail:
        lowConf === 0
          ? "ownership confidence sufficient"
          : `${lowConf} low-confidence assignment(s)`,
    },
    { key: "health_policy_state", ok: true, detail: `Customer Health policy: ${policyDraft}` },
    {
      key: "source_allowlist_state",
      ok: true,
      detail: `source allowlist: ${allowEnabled ? "enabled" : "disabled"}`,
    },
  ];

  // Level: honest gating. Mapping SOME endpoints is not readiness.
  const req = (k: string) => checks.find((c) => c.key === k)?.ok === true;
  let level: ReadinessLevel = "not_ready";
  if (req("ddis_discovered") && req("accountable_ownership") && req("no_conflicts")) {
    level = "ready_for_evaluation";
  }
  if (
    level === "ready_for_evaluation" &&
    req("ddis_mapped") &&
    req("primary_handling") &&
    req("confidence_sufficient")
  ) {
    level = "ready_for_chris_shadow";
  }
  // Staff pilot additionally requires Track B (staff safety) — never reached by config alone in v1.

  const summary =
    level === "not_ready"
      ? "Not ready — discover and map endpoints with accountable ownership first."
      : level === "ready_for_evaluation"
        ? "Ready for evaluation — enough mapping to label real calls; not yet ready for shadow."
        : "Ready for Chris-only shadow — DDIs mapped with accountable + handler, no conflicts. (Staff pilot needs Track B.)";
  return { channel: "phone", level, checks, summary };
}
