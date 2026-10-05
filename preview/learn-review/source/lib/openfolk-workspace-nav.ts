/**
 * OpenFolk Control Plane — tenant-workspace navigation logic (pure, no JSX, no DOM).
 *
 * The active workspace section is DURABLE STATE, not throwaway component state: it lives
 * in the URL (`?section=ownership&endpoint=<id>`) so that a data refresh after a mutation,
 * a page reload, or Back/Forward all keep the operator where they were. Keeping the
 * section/ownership-role helpers here (a) makes them unit-testable without a DOM harness
 * and (b) lets the route's `validateSearch` and the presentational component agree on the
 * exact same rules. See src/lib/openfolk-workspace-nav.test.ts.
 */

// Canonical section keys — every deep-linkable workspace surface. `overview` (the Command
// Centre) is the safe default: an absent or invalid `?section=` resolves here. `people`,
// `review` and `ownership` are grouped under "Directory" in the sidebar but keep their own
// URLs so legacy bookmarks resolve.
export const WORKSPACE_SECTIONS = [
  "overview",
  "learning",
  "company",
  "connections",
  "people",
  "review",
  "communications",
  "ownership",
  "agents",
  "automations",
  "health",
  "data_quality",
  "identity",
  "security",
  "audit",
] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

// Legacy section keys → their new home, so durable URLs from the previous IA keep working
// (email/phone/slack were re-homed under Communications).
const LEGACY_SECTION_ALIASES: Record<string, WorkspaceSection> = {
  email: "communications",
  phone: "communications",
  slack: "communications",
};

/** Coerce any untrusted value (URL param, storage) to a valid section. Invalid → overview. */
export function resolveSection(value: unknown): WorkspaceSection {
  if (typeof value !== "string") return "overview";
  if ((WORKSPACE_SECTIONS as readonly string[]).includes(value)) return value as WorkspaceSection;
  return LEGACY_SECTION_ALIASES[value] ?? "overview";
}

// ── Grouped information architecture (OPERATE / CONFIGURE / GOVERN) ────────────
// The sidebar item key is a nav concept, not always a section: "directory" is one nav item
// that fronts the people/review/ownership sections. Icon + rendering live in the component.
export type NavItemKey =
  | "overview"
  | "learning"
  | "connections"
  | "directory"
  | "communications"
  | "company"
  | "health"
  | "data_quality"
  | "identity"
  | "security"
  | "audit";
export interface NavItem {
  key: NavItemKey;
  label: string;
  section: WorkspaceSection; // where clicking the item navigates
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Operate",
    items: [
      { key: "overview", label: "Command Centre", section: "overview" },
      { key: "learning", label: "Learning", section: "learning" },
      { key: "connections", label: "Connections", section: "connections" },
      { key: "directory", label: "Directory", section: "people" },
      { key: "communications", label: "Communications", section: "communications" },
    ],
  },
  {
    title: "Configure",
    items: [
      { key: "company", label: "Company", section: "company" },
      { key: "health", label: "Health & Readiness", section: "health" },
    ],
  },
  {
    title: "Govern",
    items: [
      { key: "data_quality", label: "Data Quality", section: "data_quality" },
      { key: "identity", label: "Identity", section: "identity" },
      { key: "security", label: "Security", section: "security" },
      { key: "audit", label: "Audit", section: "audit" },
    ],
  },
];
// Sections fronted by the "Directory" nav item (sub-navigated in the content area).
export const DIRECTORY_SECTIONS: WorkspaceSection[] = ["people", "review", "ownership"];
// Sections kept OUT of primary navigation until they hold something useful. Routes still
// resolve (direct links / a future Labs area), they just aren't advertised in the sidebar.
export const HIDDEN_SECTIONS: WorkspaceSection[] = ["agents", "automations"];

/** Which sidebar nav item should read as active for a given section. */
export function activeNavKey(section: WorkspaceSection): NavItemKey | null {
  if (DIRECTORY_SECTIONS.includes(section)) return "directory";
  if (HIDDEN_SECTIONS.includes(section)) return null; // hidden section → no highlighted item
  return section as NavItemKey;
}

// ── Command Centre: meaningful activity (drop idempotent-refresh noise) ────────
export interface AuditLike {
  action: string;
  resource_type: string;
  reason: string | null;
  created_at: string;
}
export interface ActivitySignal {
  title: string;
  meta: string;
  tone: "ok" | "attention" | "risk" | "neutral" | "info";
}
const ACTIVITY_LABEL: {
  match: (a: string) => boolean;
  title: string;
  tone: ActivitySignal["tone"];
}[] = [
  { match: (a) => a.includes("ownership.assign"), title: "Ownership assigned", tone: "ok" },
  { match: (a) => a.includes("ownership.end"), title: "Ownership ended", tone: "attention" },
  { match: (a) => a.includes("identity.review"), title: "Identity reviewed", tone: "info" },
  { match: (a) => a.includes("delegated.issue"), title: "Setup request issued", tone: "info" },
  {
    match: (a) => a.includes("delegated.revoke"),
    title: "Setup request revoked",
    tone: "attention",
  },
  {
    match: (a) => a.includes("discovery") || a.includes("discover"),
    title: "Discovery run",
    tone: "neutral",
  },
  {
    match: (a) => a.includes("connection") || a.includes("authoris"),
    title: "Connection changed",
    tone: "info",
  },
  { match: (a) => a.includes("endpoint.archive"), title: "Endpoint archived", tone: "attention" },
  { match: (a) => a.includes("endpoint"), title: "Endpoint changed", tone: "neutral" },
];

/**
 * Turn the raw change-log into a concise Command-Centre activity view: drop the noisy
 * idempotent discovery-refresh upserts, humanise action codes, and collapse identical
 * back-to-back events into a single "· ×N" row. `limit` caps the output.
 */
export function summariseActivity(entries: AuditLike[], limit = 8): ActivitySignal[] {
  const isNoise = (e: AuditLike) =>
    e.action.includes("endpoint.upsert") &&
    /idempotency re-run|discovery refresh/i.test(e.reason ?? "");
  const meaningful = entries.filter((e) => !isNoise(e));
  const out: (ActivitySignal & { key: string; count: number })[] = [];
  for (const e of meaningful) {
    const spec = ACTIVITY_LABEL.find((l) => l.match(e.action)) ?? {
      title: e.action.replace(/^controlplane\./, "").replace(/[._]/g, " "),
      tone: "neutral" as const,
    };
    const day = e.created_at.slice(0, 10);
    const key = `${spec.title}|${day}`;
    const prev = out[out.length - 1];
    if (prev && prev.key === key) {
      prev.count += 1;
      prev.meta = `${day} · ×${prev.count}`;
    } else {
      out.push({ title: spec.title, tone: spec.tone, meta: day, key, count: 1 });
    }
    if (out.length >= limit + 5) break; // read a little ahead before capping
  }
  return out.slice(0, limit).map(({ title, meta, tone }) => ({ title, meta, tone }));
}

/** URL form of a section: overview (the default) is omitted so the URL stays clean. */
export function sectionSearchValue(value: unknown): WorkspaceSection | undefined {
  const s = resolveSection(value);
  return s === "overview" ? undefined : s;
}

// The four governed ownership roles, in confirmation order. An endpoint is
// ownership-complete only when all four are actively assigned.
export const OWNERSHIP_ROLES = ["accountable", "primary_handler", "cover", "escalation"] as const;
export type OwnershipRole = (typeof OWNERSHIP_ROLES)[number];

/**
 * The next role to focus after a confirmation. Given the roles already assigned (and,
 * optimistically, the one just confirmed before the data round-trips), return the first
 * still-missing role in canonical order, or null when the endpoint is complete.
 */
export function nextMissingRole(
  assignedRoles: Iterable<string>,
  justAssigned?: string | null,
): OwnershipRole | null {
  const have = new Set<string>(assignedRoles);
  if (justAssigned) have.add(justAssigned);
  return OWNERSHIP_ROLES.find((r) => !have.has(r)) ?? null;
}

/** True when every governed ownership role is present. */
export function isOwnershipComplete(assignedRoles: Iterable<string>): boolean {
  const have = new Set<string>(assignedRoles);
  return OWNERSHIP_ROLES.every((r) => have.has(r));
}

// ── Ownership concentration (separation-of-duties) ────────────────────────────
// A concentration warning flags when ownership is too concentrated in one person to
// preserve a meaningful fallback. Crucially, accountable == primary_handler on a personal
// mailbox is EXPECTED and must NOT warn on its own — the old "holds >1 role" rule was wrong.
export type ConcentrationSeverity = "warning" | "critical";
export type ConcentrationCode =
  | "single_person_all" // one person holds all four roles — no separation of duties (critical)
  | "holds_three_roles" // one person holds three of the four roles
  | "primary_equals_cover" // handler and their cover are the same person — no handling fallback
  | "cover_equals_escalation" // cover and escalation collapse to one person — no independent fallback
  | "threshold_exceeded"; // an explicitly configured per-person role limit was exceeded

export interface ConcentrationFinding {
  severity: ConcentrationSeverity;
  code: ConcentrationCode;
  member_id: string;
  roles: OwnershipRole[];
}

/**
 * Evaluate ownership concentration for ONE endpoint.
 *
 * `roleOwners` maps each role to the owning person's id (or null/absent for unassigned or
 * team-owned roles — those never count toward person-concentration). Returns zero or more
 * findings, most-severe first. Rules (warn if ANY apply):
 *   - one person holds three (warning) or all four (critical) roles;
 *   - primary_handler and cover are the same person;
 *   - cover and escalation are the same person (removes the independent escalation fallback);
 *   - an explicitly configured `maxRolesPerPerson` threshold is exceeded.
 * Explicitly NOT a finding: accountable == primary_handler and nothing else.
 */
export function evaluateConcentration(
  roleOwners: Partial<Record<OwnershipRole, string | null>>,
  opts: { maxRolesPerPerson?: number } = {},
): ConcentrationFinding[] {
  const active = OWNERSHIP_ROLES.map((r) => [r, roleOwners[r] ?? null] as const).filter(
    (pair): pair is readonly [OwnershipRole, string] => Boolean(pair[1]),
  );

  const byMember = new Map<string, OwnershipRole[]>();
  for (const [role, m] of active) byMember.set(m, [...(byMember.get(m) ?? []), role]);

  const findings: ConcentrationFinding[] = [];

  // Per-person role counts: 4 → critical, 3 → warning, or an explicit stricter threshold.
  for (const [member_id, roles] of byMember) {
    if (roles.length >= 4) {
      findings.push({ severity: "critical", code: "single_person_all", member_id, roles });
    } else if (roles.length === 3) {
      findings.push({ severity: "warning", code: "holds_three_roles", member_id, roles });
    } else if (
      opts.maxRolesPerPerson !== undefined &&
      roles.length > opts.maxRolesPerPerson &&
      roles.length < 3
    ) {
      findings.push({ severity: "warning", code: "threshold_exceeded", member_id, roles });
    }
  }

  // Pair rules — the fallback chain collapsing onto one person.
  const primary = roleOwners.primary_handler ?? null;
  const cover = roleOwners.cover ?? null;
  const escalation = roleOwners.escalation ?? null;
  if (primary && cover && primary === cover) {
    findings.push({
      severity: "warning",
      code: "primary_equals_cover",
      member_id: primary,
      roles: ["primary_handler", "cover"],
    });
  }
  if (cover && escalation && cover === escalation) {
    findings.push({
      severity: "warning",
      code: "cover_equals_escalation",
      member_id: cover,
      roles: ["cover", "escalation"],
    });
  }
  // NOTE: accountable == primary_handler alone is intentionally never a finding.

  // When one person holds all four (critical), the pair rules for that same person are
  // redundant noise — suppress them so the critical finding stands alone.
  const criticalMembers = new Set(
    findings.filter((f) => f.severity === "critical").map((f) => f.member_id),
  );
  const deduped = findings.filter(
    (f) => f.severity === "critical" || !criticalMembers.has(f.member_id),
  );

  // Most-severe first, then dedupe identical (code, member) pairs.
  const seen = new Set<string>();
  return deduped
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1))
    .filter((f) => {
      const k = `${f.code}:${f.member_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}
