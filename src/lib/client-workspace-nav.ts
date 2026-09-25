export const clientSections = [
  "home",
  "receptionist",
  "overview",
  "investment",
  "outcomes",
  "systems",
  "links",
  "notes",
] as const;
export type ClientSection = (typeof clientSections)[number];
export const receptionistViews = [
  "today",
  "practice",
  "improvements",
  "callers",
  "phones",
  "details",
  "calls",
] as const;
export type ReceptionistView = (typeof receptionistViews)[number];
export function receptionistView(value: unknown): ReceptionistView {
  return receptionistViews.find((view) => view === value) ?? "today";
}
export function clientSearch(search: Record<string, unknown>): {
  tenant?: string;
  section?: ClientSection;
  view?: ReceptionistView;
} {
  return {
    tenant: typeof search.tenant === "string" && search.tenant ? search.tenant : undefined,
    section: clientSections.find((section) => section === search.section) ?? "home",
    ...(search.section === "receptionist" ? { view: receptionistView(search.view) } : {}),
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
export function receptionistHref(tenant?: string, view: ReceptionistView = "today") {
  const href = clientWorkspaceHref(tenant, "receptionist");
  return view === "today" ? href : `${href}&view=${encodeURIComponent(view)}`;
}

/** UI visibility only. The existing admin route and server authority remain mandatory. */
export function canShowOpenFolkAdmin(email: string | null | undefined, authorised: unknown) {
  return authorised === true && email?.trim().toLowerCase() === "chris@openfolk.ai";
}
