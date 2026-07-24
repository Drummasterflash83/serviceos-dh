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

// Canonical section keys — the order the sidebar renders them in. `overview` is the
// safe default: an absent or invalid `?section=` resolves here.
export const WORKSPACE_SECTIONS = [
  "overview",
  "people",
  "review",
  "connections",
  "phone",
  "email",
  "slack",
  "ownership",
  "data_quality",
  "audit",
] as const;
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

/** Coerce any untrusted value (URL param, storage) to a valid section. Invalid → overview. */
export function resolveSection(value: unknown): WorkspaceSection {
  return typeof value === "string" && (WORKSPACE_SECTIONS as readonly string[]).includes(value)
    ? (value as WorkspaceSection)
    : "overview";
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
