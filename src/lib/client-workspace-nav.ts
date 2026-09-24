export const clientSections = [
  "home",
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
    tenant: typeof search.tenant === "string" && search.tenant ? search.tenant : undefined,
    section: clientSections.find((section) => section === search.section) ?? "home",
  };
}
export function selectedWorkspace<T extends { tenant_id: string }>(
  rows: T[] | undefined,
  requested?: string,
) {
  return requested ? rows?.find((row) => row.tenant_id === requested) : rows?.[0];
}
export function clientWorkspaceHref(tenant?: string, section: ClientSection = "home") {
  const params = new URLSearchParams();
  if (tenant) params.set("tenant", tenant);
  if (section !== "home") params.set("section", section);
  return `/client${params.size ? `?${params}` : ""}`;
}
export function receptionistHref(tenant?: string) {
  return tenant ? `/receptionist?tenant=${encodeURIComponent(tenant)}` : "/receptionist";
}
