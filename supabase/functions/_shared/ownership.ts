// resolveUserOwnership — the missing bridge from a logged-in user to what they
// actually own, cover and may govern. PURE (no IO): the caller loads the tenant-
// scoped rows (RLS/service-role) and passes them in; this resolves + explains them.
// Effective-date-aware and explainable (every conclusion carries a reason).

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export interface OwnershipInput {
  tenantId: string;
  userId: string;
  now: string; // ISO — for effective-date filtering
  profileRole: string | null; // authorization role (owner|admin|ops|viewer)
  member: Row | null; // the caller's team_members row (matched by profile_id)
  responsibilities: Row[]; // responsibility_assignments for the member
  authorityGrants: Row[]; // authority_grants for the member (+ vocabulary category)
  objectives: Row[]; // objectives this member owns/accountable-for (title/status)
  teams: Row[]; // org_units the member belongs to {id,name}
  managedMembers: Row[]; // team_members this member manages {id,display_name}
}

export interface ResolvedOwnership {
  user: {
    userId: string;
    memberId: string | null;
    displayName: string | null;
    formalRole: string | null;
    observedRole: string | null;
    observedStatus: string | null;
    authorityLevel: string | null;
    profileRole: string | null;
  };
  roles: string[];
  teams: { id: string; name: string }[];
  objectives: { id: string; title: string; raci: string; reason: string }[];
  workflows: { ref: string; label: string; reason: string }[];
  responsibilities: {
    kind: string; ref: string | null; label: string; raci: string;
    weekdayMask: number | null; coverFor: string | null; confidence: number | null; reason: string;
  }[];
  authority: { permission: string; category: string; scope: string }[];
  managedUsers: { id: string; name: string }[];
  canBeAssignedWork: boolean;
  canApproveWork: boolean;
  agents: { permissions: string[]; configurable: boolean; observeOnly: boolean; scope: string | null };
  reasons: string[];
}

const isActive = (r: Row, now: string): boolean => {
  // Compare numerically — ISO strings from the DB ("+00:00") and a JS `now` ("Z")
  // are not lexicographically comparable.
  const n = Date.parse(now);
  const from = r.effective_from ? Date.parse(r.effective_from) : Number.NEGATIVE_INFINITY;
  const to = r.effective_to ? Date.parse(r.effective_to) : Number.POSITIVE_INFINITY;
  return from <= n && to > n;
};

// Agent permissions that constitute genuine CONFIGURATION/governance (vs observe).
const CONFIGURE_AGENT = new Set([
  "agent.configure", "agent.create", "agent.activate", "agent.set_autonomy",
  "agent.set_access", "agent.assign", "agent.retire",
]);

export function resolveUserOwnership(input: OwnershipInput): ResolvedOwnership {
  const now = input.now;
  const m = input.member;
  const reasons: string[] = [];

  const roles: string[] = [];
  if (m?.formal_role) roles.push(m.formal_role);
  if (m?.observed_role) roles.push(`${m.observed_role} (${m.observed_status ?? "proposed"})`);
  if (!m) reasons.push("No operational team member is linked to this login yet — only the authorization role applies.");

  const resp = (input.responsibilities ?? []).filter((r) => isActive(r, now));
  const responsibilities = resp.map((r) => ({
    kind: r.kind,
    ref: r.target_ref ?? null,
    label: r.label,
    raci: r.raci_role,
    weekdayMask: r.weekday_mask ?? null,
    coverFor: r.cover_for ?? null,
    confidence: r.confidence ?? null,
    reason:
      (r.raci_role === "accountable" ? "accountable" : "responsible") +
      ` for ${r.kind}` +
      (r.weekday_mask ? " (weekday-scoped)" : "") +
      (r.cover_for ? " (cover)" : "") +
      (r.confidence != null ? ` · confidence ${r.confidence}` : ""),
  }));

  const objectives = (input.objectives ?? [])
    .filter((o) => o.status !== "archived" && o.status !== "cancelled")
    .map((o) => {
      const own = resp.find((r) => r.kind === "objective" && r.target_ref === o.id);
      return {
        id: o.id,
        title: o.title,
        raci: own?.raci_role ?? "accountable",
        reason: own
          ? `${own.raci_role} for this objective (proposed)`
          : "owner reference on the objective",
      };
    });

  const workflows = resp
    .filter((r) => r.kind === "workflow")
    .map((r) => ({ ref: r.target_ref ?? "", label: r.label, reason: `owns workflow (${r.raci_role})` }));

  const grants = (input.authorityGrants ?? []).filter((g) => isActive(g, now));
  const authority = grants.map((g) => ({
    permission: g.permission,
    category: g.category ?? g.permission.split(".")[0],
    scope: g.scope,
  }));
  const agentPerms = authority.filter((a) => a.permission.startsWith("agent."));
  const configurable = agentPerms.some((a) => CONFIGURE_AGENT.has(a.permission));
  const observeOnly = agentPerms.length > 0 && !configurable;
  const agentScope = agentPerms.reduce<string | null>((acc, a) => {
    const rank = { self: 1, team: 2, company: 3 } as Record<string, number>;
    return acc == null || rank[a.scope] > rank[acc] ? a.scope : acc;
  }, null);

  const canApproveWork = authority.some((a) => a.permission === "work.approve");
  const canBeAssignedWork = !!m; // a modelled member can be assigned work

  if (m) reasons.push(`Resolved as team member "${m.display_name}" (${m.authority_level}).`);
  if (objectives.length) reasons.push(`Owns ${objectives.length} objective(s).`);
  if (configurable) reasons.push(`May configure agents at ${agentScope} scope.`);
  else if (observeOnly) reasons.push("May observe/interact with assigned agents but not configure them.");
  if (canApproveWork) reasons.push("Holds work-approval authority.");

  return {
    user: {
      userId: input.userId,
      memberId: m?.id ?? null,
      displayName: m?.display_name ?? null,
      formalRole: m?.formal_role ?? null,
      observedRole: m?.observed_role ?? null,
      observedStatus: m?.observed_status ?? null,
      authorityLevel: m?.authority_level ?? null,
      profileRole: input.profileRole ?? null,
    },
    roles,
    teams: (input.teams ?? []).map((t) => ({ id: t.id, name: t.name })),
    objectives,
    workflows,
    responsibilities,
    authority,
    managedUsers: (input.managedMembers ?? []).map((x) => ({ id: x.id, name: x.display_name })),
    canBeAssignedWork,
    canApproveWork,
    agents: { permissions: agentPerms.map((a) => a.permission), configurable, observeOnly, scope: agentScope },
    reasons,
  };
}
