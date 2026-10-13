export type QuickBooksConnectionStatus =
  | "authorizing"
  | "awaiting_confirmation"
  | "paused"
  | "active"
  | "authentication_required"
  | "disconnected";
export interface QuickBooksConnection {
  id: string;
  appId: string;
  environment: "sandbox" | "production";
  realmId: string | null;
  companyName: string | null;
  status: QuickBooksConnectionStatus;
  revision: number;
  verifiedAt: string | null;
  confirmedAt: string | null;
  accessExpiresAt: string | null;
  refreshExpiresAt: string | null;
  refreshInProgress: boolean;
}
export interface QuickBooksOverview {
  tenantId: string;
  checkedAt: string;
  connections: QuickBooksConnection[];
  apps: { id: string; environment: "sandbox" | "production" }[];
}
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const maybeDate = (v: unknown) => v === null || date(v);
export function readQuickBooksOverview(value: unknown, tenantId: string): QuickBooksOverview {
  if (
    !object(value) ||
    value.tenantId !== tenantId ||
    !uuid(tenantId) ||
    !date(value.checkedAt) ||
    !Array.isArray(value.connections) ||
    !Array.isArray(value.apps)
  )
    throw new Error("QuickBooks status could not be verified.");
  const ids = new Set<string>();
  for (const c of value.connections) {
    if (
      !object(c) ||
      !uuid(c.id) ||
      ids.has(c.id) ||
      !uuid(c.appId) ||
      !["sandbox", "production"].includes(String(c.environment)) ||
      ![
        "authorizing",
        "awaiting_confirmation",
        "paused",
        "active",
        "authentication_required",
        "disconnected",
      ].includes(String(c.status)) ||
      !Number.isSafeInteger(c.revision) ||
      Number(c.revision) < 1 ||
      typeof c.refreshInProgress !== "boolean" ||
      !(
        c.realmId === null ||
        (typeof c.realmId === "string" && /^[1-9][0-9]{0,29}$/.test(c.realmId))
      ) ||
      !(
        c.companyName === null ||
        (typeof c.companyName === "string" && c.companyName.length <= 1024)
      ) ||
      ![c.verifiedAt, c.confirmedAt, c.accessExpiresAt, c.refreshExpiresAt].every(maybeDate)
    )
      throw new Error("QuickBooks status could not be verified.");
    ids.add(c.id);
  }
  const apps = new Set<string>();
  for (const a of value.apps) {
    if (
      !object(a) ||
      !uuid(a.id) ||
      apps.has(a.id) ||
      !["sandbox", "production"].includes(String(a.environment))
    )
      throw new Error("QuickBooks setup could not be verified.");
    apps.add(a.id);
  }
  return value as unknown as QuickBooksOverview;
}
export function verifiedQuickBooksAuthorizationUrl(
  value: unknown,
  connectionId: string,
  backend: string,
): string {
  if (
    !object(value) ||
    value.connectionId !== connectionId ||
    typeof value.authorizationUrl !== "string"
  )
    throw new Error("Authorisation could not be verified.");
  const url = new URL(value.authorizationUrl),
    q = url.searchParams;
  if (
    url.origin !== "https://appcenter.intuit.com" ||
    url.pathname !== "/connect/oauth2" ||
    url.username ||
    url.password ||
    url.hash ||
    q.get("redirect_uri") !==
      backend.replace(/\/$/, "") + "/functions/v1/quickbooks-oauth-callback" ||
    q.get("response_type") !== "code" ||
    q.get("scope") !== "com.intuit.quickbooks.accounting" ||
    !q.get("client_id") ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(q.get("state") ?? "") ||
    [...q.keys()].sort().join(",") !== "client_id,redirect_uri,response_type,scope,state"
  )
    throw new Error("Authorisation could not be verified.");
  return url.href;
}
export const quickBooksStatusLabel: Record<QuickBooksConnectionStatus, string> = {
  authorizing: "Waiting for QuickBooks authorisation",
  awaiting_confirmation: "Confirm the connected company",
  paused: "Capture paused",
  active: "Capture enabled",
  authentication_required: "Reconnect QuickBooks",
  disconnected: "Disconnected",
};
