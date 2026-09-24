export const clientSections = [
  "overview",
  "investment",
  "outcomes",
  "systems",
  "links",
  "notes",
] as const;
export type ClientSection = (typeof clientSections)[number];
export function clientSearch(search: Record<string, unknown>): {
  tenant?: string;
  section?: ClientSection;
} {
  return {
    tenant: typeof search.tenant === "string" ? search.tenant : undefined,
    section: clientSections.find((section) => section === search.section),
  };
}
export function selectedWorkspace<T extends { tenant_id: string }>(
  rows: T[] | undefined,
  requested?: string,
) {
  // A stale or inaccessible explicit workspace must never open another client's data.
  return requested ? rows?.find((row) => row.tenant_id === requested) : rows?.[0];
}
export function clientWorkspaceHref(tenant?: string) {
  return tenant ? `/client?tenant=${encodeURIComponent(tenant)}` : "/client";
}
