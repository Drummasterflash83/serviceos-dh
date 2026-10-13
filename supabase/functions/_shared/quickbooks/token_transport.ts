/** Server-only token endpoint transport. Call only after durable state consumption
 * (code exchange) or a tenant-bound refresh lease. Persist the returned pair in
 * one Vault transaction; this module neither authorises nor stores credentials.
 * No accounting writes and no automatic retries after uncertain token outcomes.
 */
export type QuickBooksTokenGrant =
  | { kind: "code"; code: string; redirectUri: string }
  | { kind: "refresh"; refreshToken: string };
export interface QuickBooksTokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  refreshHardExpiresAt: string | null;
}
export class QuickBooksTokenError extends Error {
  readonly code: string;
  constructor(code: "invalid_request" | "authentication_required" | "rate_limited" |
    "provider_rejected" | "outcome_unknown" | "invalid_response") {
    super(code); this.code = code; this.name = "QuickBooksTokenError";
  }
}
function fail(code: ConstructorParameters<typeof QuickBooksTokenError>[0]): never { throw new QuickBooksTokenError(code); }
const token = (s: unknown): s is string => typeof s === "string" && /^[\x21-\x7e]{1,16384}$/.test(s);
const ttl = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0 && n <= 10 * 366 * 86400;

export async function requestQuickBooksTokens(
  client: { clientId: string; clientSecret: string }, grant: QuickBooksTokenGrant,
  ports: { fetcher?: typeof fetch; clock?: () => number; signal?: AbortSignal } = {},
): Promise<QuickBooksTokenPair> {
  if (!client || !token(client.clientId) || client.clientId.includes(":") || !token(client.clientSecret) || !grant) fail("invalid_request");
  const body = new URLSearchParams();
  if (grant.kind === "code") {
    let redirect: URL;
    try { redirect = new URL(grant.redirectUri); } catch { return fail("invalid_request"); }
    if (!token(grant.code) || redirect.protocol !== "https:" || redirect.username || redirect.password ||
      redirect.search || redirect.hash || redirect.href !== grant.redirectUri || redirect.pathname === "/") fail("invalid_request");
    body.set("grant_type", "authorization_code"); body.set("code", grant.code); body.set("redirect_uri", grant.redirectUri);
  } else if (grant.kind === "refresh" && token(grant.refreshToken)) {
    body.set("grant_type", "refresh_token"); body.set("refresh_token", grant.refreshToken);
  } else fail("invalid_request");
  const authorization = `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`;
  const now = ports.clock ?? Date.now, startedAt = now();
  if (!Number.isFinite(startedAt)) fail("invalid_request");
  const signal = ports.signal ? AbortSignal.any([ports.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  try {
    signal.throwIfAborted();
    const response = await (ports.fetcher ?? fetch)("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST", redirect: "error", signal,
      headers: { Authorization: authorization, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded",
        "x-include-refresh-token-hard-expires-in": "true" }, body: body.toString(),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 400 || response.status === 401) fail("authentication_required");
      if (response.status === 429) fail("rate_limited");
      fail(response.status >= 500 ? "outcome_unknown" : "provider_rejected");
    }
    if (!response.body || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      await response.body?.cancel(); fail("invalid_response");
    }
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    let text = "", bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted();
        if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 65536) fail("invalid_response");
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      await reader.cancel().catch(() => {}); reader.releaseLock();
    }
    let result: unknown;
    try { result = JSON.parse(text); } catch { return fail("invalid_response"); }
    if (!result || typeof result !== "object" || Array.isArray(result)) fail("invalid_response");
    const r = result as Record<string, unknown>;
    if (Object.hasOwn(r, "error") || typeof r.token_type !== "string" || r.token_type.toLowerCase() !== "bearer" ||
      !token(r.access_token) || !token(r.refresh_token) || !ttl(r.expires_in) || !ttl(r.x_refresh_token_expires_in) ||
      (r.x_refresh_token_hard_expires_in !== undefined && !ttl(r.x_refresh_token_hard_expires_in))) fail("invalid_response");
    // Starting time is conservative: network latency must not extend token life.
    const expiry = (seconds: number) => new Date(startedAt + seconds * 1000).toISOString();
    signal.throwIfAborted();
    if (startedAt + r.expires_in * 1000 <= now()) fail("invalid_response");
    return { accessToken: r.access_token, refreshToken: r.refresh_token,
      accessExpiresAt: expiry(r.expires_in), refreshExpiresAt: expiry(r.x_refresh_token_expires_in),
      refreshHardExpiresAt: r.x_refresh_token_hard_expires_in === undefined ? null : expiry(r.x_refresh_token_hard_expires_in as number) };
  } catch (error) {
    if (error instanceof QuickBooksTokenError) throw error;
    throw new QuickBooksTokenError("outcome_unknown");
  }
}
