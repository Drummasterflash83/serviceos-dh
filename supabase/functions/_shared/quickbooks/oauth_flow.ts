import { quickBooksAuthorizationUrl, validateQuickBooksCallback } from "./oauth_contract.ts";
import type { QuickBooksPendingAuthorization } from "./oauth_contract.ts";
import { requestQuickBooksTokens } from "./token_transport.ts";
import { readQuickBooksCompany } from "./company_info.ts";

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export async function quickBooksStateHash(state: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(state)) throw new Error("authorization_invalid");
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

/** rpc must use the caller's validated user JWT. SQL records auth.uid() itself. */
export async function startQuickBooksAuthorization(
  input: {
    tenantId: string;
    connectionId: string;
    appId: string;
    requestId: string;
    reason: string;
  },
  rpc: Rpc,
): Promise<{ authorizationUrl: string; connectionId: string }> {
  if (
    !input ||
    ![input.tenantId, input.connectionId, input.appId, input.requestId].every(uuid) ||
    typeof input.reason !== "string" ||
    !input.reason.trim() ||
    input.reason.length > 1000
  )
    throw new Error("request_invalid");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const state = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  const result = await rpc("learn_quickbooks_begin", {
    p_tenant: input.tenantId,
    p_connection: input.connectionId,
    p_app: input.appId,
    p_request: input.requestId,
    p_state_hash: await quickBooksStateHash(state),
    p_reason: input.reason,
  });
  if (
    result.error ||
    !object(result.data) ||
    result.data.tenantId !== input.tenantId ||
    result.data.connectionId !== input.connectionId ||
    !object(result.data.app) ||
    result.data.app.registrationId !== input.appId
  )
    throw new Error("authorization_unavailable");
  const pending = {
    ...result.data,
    state,
    usedAt: null,
  } as unknown as QuickBooksPendingAuthorization;
  return {
    authorizationUrl: quickBooksAuthorizationUrl(pending),
    connectionId: input.connectionId,
  };
}

/** Anonymous provider callback, governed by a one-time durable state claim.
 * Never return/log raw RPC errors, URLs, codes, provider payloads or credentials.
 */
export async function completeQuickBooksAuthorization(
  callbackUrl: string,
  ports: {
    rpc: Rpc;
    minorVersion: number;
    fetcher?: typeof fetch;
    clock?: () => number;
    signal?: AbortSignal;
  },
): Promise<{ state: "saved" | "unconfirmed" }> {
  let requestId: string | undefined, claimId: string | undefined;
  try {
    const url = new URL(callbackUrl);
    if (
      url.href.length > 12000 ||
      url.searchParams.getAll("state").length !== 1 ||
      url.searchParams.has("error") ||
      url.searchParams.getAll("code").length !== 1 ||
      url.searchParams.getAll("realmId").length !== 1
    )
      return { state: "unconfirmed" };
    const state = url.searchParams.get("state")!;
    const acquired = await ports.rpc("learn_quickbooks_claim", {
      p_state_hash: await quickBooksStateHash(state),
    });
    if (acquired.error || !object(acquired.data)) return { state: "unconfirmed" };
    const p = acquired.data;
    if (
      !uuid(p.requestId) ||
      !uuid(p.claimId) ||
      typeof p.claimUntil !== "string" ||
      typeof p.clientSecret !== "string" ||
      !object(p.app)
    )
      return { state: "unconfirmed" };
    requestId = p.requestId;
    claimId = p.claimId;
    const now = ports.clock ?? Date.now;
    const remaining = Date.parse(p.claimUntil) - now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 120000)
      throw new Error("authorization_invalid");
    const signal = ports.signal
      ? AbortSignal.any([ports.signal, AbortSignal.timeout(Math.ceil(remaining))])
      : AbortSignal.timeout(Math.ceil(remaining));
    const pending = { ...p, state, usedAt: null } as unknown as QuickBooksPendingAuthorization;
    const callback = validateQuickBooksCallback(callbackUrl, pending, pending.app, now());
    if (p.expectedRealmId !== null && p.expectedRealmId !== callback.realmId)
      throw new Error("company_mismatch");
    const bound = { p_request: requestId, p_claim: claimId };
    const stillAuthorized = async () => {
      signal.throwIfAborted();
      const result = await ports.rpc("learn_quickbooks_claim_current", bound);
      return !result.error && result.data === true;
    };
    if (!(await stillAuthorized())) throw new Error("authorization_invalid");
    const pair = await requestQuickBooksTokens(
      { clientId: pending.app.clientId, clientSecret: p.clientSecret },
      { kind: "code", code: callback.code, redirectUri: pending.app.redirectUri },
      { fetcher: ports.fetcher, clock: now, signal },
    );
    const company = await readQuickBooksCompany(
      {
        environment: pending.app.environment,
        realmId: callback.realmId,
        accessToken: pair.accessToken,
        minorVersion: ports.minorVersion,
      },
      { fetcher: ports.fetcher, stillAuthorized, signal },
    );
    if (!(await stillAuthorized())) throw new Error("authorization_invalid");
    const saved = await ports.rpc("learn_quickbooks_finish", {
      ...bound,
      p_realm: company.realmId,
      p_company_name: company.companyName,
      p_pair: pair,
    });
    if (
      saved.error ||
      !object(saved.data) ||
      saved.data.state !== "saved" ||
      saved.data.connectionId !== p.connectionId
    )
      return { state: "unconfirmed" };
    return { state: "saved" };
  } catch {
    if (requestId && claimId) {
      try {
        await ports.rpc("learn_quickbooks_fail", {
          p_request: requestId,
          p_claim: claimId,
          p_code: "outcome_unknown",
        });
      } catch {
        /* status reader exposes expired claim */
      }
    }
    return { state: "unconfirmed" };
  }
}

/** No automatic refresh retry. Expired leases require reauthorisation; a lost
 * persistence reply is inspected through status before another worker runs. */
export async function refreshQuickBooksConnection(
  tenantId: string,
  connectionId: string,
  ports: { rpc: Rpc; fetcher?: typeof fetch; clock?: () => number; signal?: AbortSignal },
): Promise<"current" | "refreshed" | "busy" | "authentication_required" | "unconfirmed"> {
  if (!uuid(tenantId) || !uuid(connectionId)) return "unconfirmed";
  try {
    const scope = { p_tenant: tenantId, p_connection: connectionId };
    const acquired = await ports.rpc("learn_quickbooks_refresh_acquire", scope);
    if (acquired.error || !object(acquired.data)) return "unconfirmed";
    const a = acquired.data;
    if (a.state === "current" || a.state === "busy" || a.state === "authentication_required")
      return a.state;
    if (
      a.state !== "ready" ||
      !uuid(a.leaseId) ||
      typeof a.leaseUntil !== "string" ||
      !Number.isSafeInteger(a.revision) ||
      !Number.isSafeInteger(a.generation) ||
      typeof a.clientId !== "string" ||
      typeof a.clientSecret !== "string" ||
      typeof a.refreshToken !== "string"
    )
      return "unconfirmed";
    const remaining = Date.parse(a.leaseUntil) - (ports.clock ?? Date.now)();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 120000) return "unconfirmed";
    const signal = ports.signal
      ? AbortSignal.any([ports.signal, AbortSignal.timeout(Math.ceil(remaining))])
      : AbortSignal.timeout(Math.ceil(remaining));
    const pair = await requestQuickBooksTokens(
      { clientId: a.clientId, clientSecret: a.clientSecret },
      { kind: "refresh", refreshToken: a.refreshToken },
      { ...ports, signal },
    );
    const saved = await ports.rpc("learn_quickbooks_refresh_finish", {
      ...scope,
      p_lease: a.leaseId,
      p_generation: a.generation,
      p_revision: a.revision,
      p_pair: pair,
    });
    return saved.error ? "unconfirmed" : "refreshed";
  } catch {
    return "unconfirmed";
  }
}
