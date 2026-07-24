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
