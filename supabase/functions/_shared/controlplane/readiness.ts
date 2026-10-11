/** Phone configuration gates. These do not prove capture, playback or staff safety. */
import { readOperatorInventory } from "./inventory.ts";

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

function current(row: any, now: number) {
  const from = Date.parse(row.effective_from);
  const to = row.effective_to === null ? Infinity : Date.parse(row.effective_to);
  if (!Number.isFinite(from) || Number.isNaN(to) || to <= from)
    throw Error("Invalid Phone readiness effective dates");
  return from <= now && now < to;
}

export async function computeSourceReadiness(
  db: { from(table: string): any },
  tenantId: string,
  now = Date.now(),
): Promise<SourceReadiness> {
  if (!Number.isFinite(now) || Math.abs(now) > 8.64e15)
    throw Error("Invalid Phone readiness observation time");
  const read = (table: string, columns: string, filter?: (q: any) => any) =>
    readOperatorInventory(db, tenantId, table, columns, { filter, label: "Phone readiness" });
  const [endpoints, assignments, members, teams, policies, sources] = await Promise.all([
    read(
      "communication_endpoints",
      "id,channel,status,endpoint_kind,effective_from,effective_to",
      (q) => q.eq("channel", "phone").eq("status", "active"),
    ),
    read(
      "endpoint_ownership_assignments",
      "id,endpoint_id,assignment_role,review_state,confidence,owner_kind,owner_member_id,owner_org_unit_id,owner_role,effective_from,effective_to",
    ),
    read("team_members", "id,effective_from,effective_to"),
    read("org_units", "id"),
    read("config_versions", "id,status,version", (q) =>
      q.eq("artifact_kind", "policy").eq("artifact_key", "customer_health"),
    ),
    read("operating_profile_entries", "id,value", (q) =>
      q.eq("scope_kind", "tenant").eq("namespace", "customer_health").eq("key", "source.allowlist"),
    ),
  ]);
  if (endpoints.some((e) => e.channel !== "phone" || e.status !== "active"))
    throw Error("Phone readiness endpoint scope changed");
  const active = endpoints.filter((e) => current(e, now));
  const endpointIds = new Set(active.map((e) => e.id));
  const people = new Set(members.filter((m) => current(m, now)).map((m) => m.id));
  const teamIds = new Set(teams.map((t) => t.id));
  const ownership = assignments.filter((a) => current(a, now) && endpointIds.has(a.endpoint_id));
  const confirmed = ownership.filter((a) => a.review_state === "confirmed");
  const validOwner = (a: any) =>
    a.owner_kind === "person"
      ? people.has(a.owner_member_id)
      : a.owner_kind === "team"
        ? teamIds.has(a.owner_org_unit_id)
        : a.owner_kind === "role"
          ? typeof a.owner_role === "string" && a.owner_role.trim().length > 0
          : false;
  const byRole = (role: string) => {
    const result = new Map<string, any[]>();
    for (const a of confirmed.filter((a) => a.assignment_role === role))
      result.set(a.endpoint_id, [...(result.get(a.endpoint_id) ?? []), a]);
    return result;
  };
  const accountable = byRole("accountable"),
    handlers = byRole("primary_handler");
  const uniqueValid = (rows: any[] | undefined) => rows?.length === 1 && validOwner(rows[0]);
  const ddis = active.filter((e) => e.endpoint_kind === "ddi");
  const mapped = ddis.filter((e) => uniqueValid(accountable.get(e.id)));
  const handled = ddis.filter((e) => uniqueValid(handlers.get(e.id)));
  const relevant = confirmed.filter((a) =>
    ["accountable", "primary_handler"].includes(a.assignment_role),
  );
  const invalid = relevant.filter((a) => !validOwner(a)).length;
  const ambiguous = [...accountable.values(), ...handlers.values()].filter(
    (rows) => rows.length > 1,
  ).length;
  const conflicts = ownership.filter((a) => a.review_state === "conflicted").length;
  const low = relevant.filter(
    (a) =>
      typeof a.confidence !== "number" ||
      !Number.isFinite(a.confidence) ||
      a.confidence < 0.5 ||
      a.confidence > 1,
  ).length;
  if (
    policies.some((p) => !Number.isSafeInteger(p.version) || p.version < 1) ||
    new Set(policies.map((p) => p.version)).size !== policies.length ||
    sources.length > 1
  )
    throw Error("Ambiguous Phone readiness policy or source configuration");
  policies.sort((a, b) => b.version - a.version);
  const policy = policies[0]?.status ?? "none";
  const source = sources[0]?.value;
  const enabled = source?.enabled === true;
  // Match the actual shadow pipeline's exact interaction-type allowlist.
  const phoneAllowed =
    enabled && Array.isArray(source?.sources) && source.sources.includes("phone_call");
  const checks: ReadinessCheck[] = [
    {
      key: "ddis_discovered",
      ok: ddis.length > 0,
      detail: `${ddis.length} current DDI(s) discovered`,
    },
    {
      key: "extensions_discovered",
      ok: active.some((e) => e.endpoint_kind === "extension"),
      detail: `${active.filter((e) => e.endpoint_kind === "extension").length} current extension(s) discovered (inventory information)`,
    },
    {
      key: "queues_discovered",
      ok: active.some((e) => ["queue", "ring_group"].includes(e.endpoint_kind)),
      detail: `${active.filter((e) => ["queue", "ring_group"].includes(e.endpoint_kind)).length} current queue/ring-group(s) discovered (inventory information)`,
    },
    {
      key: "ddis_mapped",
      ok: ddis.length > 0 && mapped.length === ddis.length,
      detail: `${mapped.length}/${ddis.length} DDIs have one confirmed, valid accountable owner`,
    },
    {
      key: "accountable_ownership",
      ok: mapped.length > 0,
      detail: `${mapped.length} DDI(s) available for ownership evaluation`,
    },
    {
      key: "primary_handling",
      ok: ddis.length > 0 && handled.length === ddis.length,
      detail: `${handled.length}/${ddis.length} DDIs have one confirmed, valid primary handler`,
    },
    {
      key: "no_conflicts",
      ok: conflicts === 0 && ambiguous === 0,
      detail: `${conflicts} conflicting assignment(s); ${ambiguous} overlapping confirmed ownership role(s)`,
    },
    {
      key: "owner_targets_valid",
      ok: invalid === 0,
      detail: `${invalid} confirmed assignment(s) need a current person, company team or named role`,
    },
    {
      key: "confidence_sufficient",
      ok: relevant.length > 0 && low === 0,
      detail: `${low} confirmed accountable/handler assignment(s) have missing, invalid or low confidence`,
    },
    {
      key: "health_policy_state",
      ok: policy === "published",
      detail: `Latest Customer Health policy: ${policy}; publication required for shadow processing`,
    },
    {
      key: "source_allowlist_state",
      ok: phoneAllowed,
      detail: `Source allowlist: ${enabled ? "enabled" : "disabled"}; phone_call ${phoneAllowed ? "allowed" : "not allowed"}`,
    },
  ];
  const ok = (key: string) => checks.some((c) => c.key === key && c.ok);
  let level: ReadinessLevel = "not_ready";
  if (ok("accountable_ownership") && ok("no_conflicts") && ok("owner_targets_valid"))
    level = "ready_for_evaluation";
  if (
    level === "ready_for_evaluation" &&
    [
      "ddis_mapped",
      "primary_handling",
      "confidence_sufficient",
      "health_policy_state",
      "source_allowlist_state",
    ].every(ok)
  )
    level = "ready_for_chris_shadow";
  const summary =
    (level === "not_ready"
      ? "Phone configuration needs attention before ownership evaluation."
      : level === "ready_for_evaluation"
        ? "Ready to evaluate configured Phone ownership; one or more shadow configuration gates remain incomplete."
        : "Phone configuration meets the Chris-only shadow gates.") +
    " This does not verify live capture, recording playback or processing results. Staff pilot approval needs separate safety and end-to-end checks.";
  return { channel: "phone", level, checks, summary };
}
