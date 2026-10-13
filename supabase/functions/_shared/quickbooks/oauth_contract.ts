/** Pure OAuth boundary validation. Not a deployed callback or token store.
 * The server must persist and atomically consume state before exchanging a code.
 * App identity is separate from the tenant/company, allowing future owner migration.
 */
export interface QuickBooksApp {
  registrationId: string;
  clientId: string;
  environment: "sandbox" | "production";
  redirectUri: string;
}
export interface QuickBooksPendingAuthorization {
  tenantId: string;
  connectionId: string;
  actorId: string;
  app: QuickBooksApp;
  state: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}
export class QuickBooksAuthorizationError extends Error {
  constructor() { super("authorization_invalid"); this.name = "QuickBooksAuthorizationError"; }
}
const invalid = (): never => { throw new QuickBooksAuthorizationError(); };
const uuid = (s: unknown) => typeof s === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const opaque = (s: unknown, min: number, max: number) => typeof s === "string" && s.length >= min && s.length <= max && /^[A-Za-z0-9_-]+$/.test(s);
export const accountingScope = "com.intuit.quickbooks.accounting";

function validateApp(app: QuickBooksApp) {
  if (!app || !uuid(app.registrationId) || !opaque(app.clientId, 1, 256) ||
    !["sandbox", "production"].includes(app.environment)) invalid();
  let url: URL;
  try { url = new URL(app.redirectUri); } catch { return invalid(); }
  // Use a configured, exact HTTPS server callback, never a caller-provided return URL.
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
    url.href !== app.redirectUri || url.pathname === "/") invalid();
}

function validatePending(pending: QuickBooksPendingAuthorization, now: number) {
  if (!pending || !uuid(pending.tenantId) || !uuid(pending.connectionId) || !uuid(pending.actorId) ||
    !opaque(pending.state, 43, 128) || pending.usedAt !== null || !Number.isFinite(now)) invalid();
  validateApp(pending.app);
  const created = Date.parse(pending.createdAt), expires = Date.parse(pending.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now ||
    expires <= now || expires <= created || expires - created > 600000) invalid();
}

/** Persist this exact tuple in server-only storage BEFORE returning the URL. */
export function newQuickBooksAuthorization(
  input: Pick<QuickBooksPendingAuthorization, "tenantId" | "connectionId" | "actorId" | "app">,
  now = Date.now(),
): QuickBooksPendingAuthorization {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const pending = { ...input, app: { ...input.app }, state, createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600000).toISOString(), usedAt: null };
  validatePending(pending, now);
  return pending;
}

export function quickBooksAuthorizationUrl(pending: QuickBooksPendingAuthorization, now = Date.now()): string {
  validatePending(pending, now);
  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.search = new URLSearchParams({ client_id: pending.app.clientId, redirect_uri: pending.app.redirectUri,
    response_type: "code", scope: accountingScope, state: pending.state }).toString();
  return url.href;
}

/** Validation alone DOES NOT consume state or prove company access. The callback
 * must claim unused/unexpired state atomically, recheck current actor authority,
 * exchange the code, then read CompanyInfo through the exact realm-bound URL.
 * CompanyInfo.Id is an entity identifier, not assumed to equal the OAuth realm.
 * Confirm the returned company with the operator before starting capture.
 * Errors intentionally exclude the callback URL, code, state and provider message.
 */
export function validateQuickBooksCallback(callbackUrl: string, pending: QuickBooksPendingAuthorization,
  configuredApp: QuickBooksApp, now = Date.now()): { code: string; realmId: string } {
  validatePending(pending, now); validateApp(configuredApp);
  for (const key of ["registrationId", "clientId", "environment", "redirectUri"] as const)
    if (pending.app[key] !== configuredApp[key]) invalid();
  let url: URL;
  try { url = new URL(callbackUrl); } catch { return invalid(); }
  if (url.hash || url.username || url.password || `${url.origin}${url.pathname}` !== pending.app.redirectUri) invalid();
  const query = url.searchParams;
  if (query.has("error") || query.has("error_description")) invalid();
  for (const key of ["code", "realmId", "state"])
    if (query.getAll(key).length !== 1) invalid();
  const code = query.get("code"), realmId = query.get("realmId");
  if (query.get("state") !== pending.state || typeof code !== "string" ||
    !/^[\x21-\x7e]{1,8192}$/.test(code) || typeof realmId !== "string" || !/^[1-9][0-9]{0,29}$/.test(realmId)) invalid();
  return { code: code!, realmId: realmId! };
}
