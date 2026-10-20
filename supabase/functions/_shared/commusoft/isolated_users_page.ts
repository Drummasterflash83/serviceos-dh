import { CommusoftReadError, readCommusoftPage } from "./read_page.ts";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export interface IsolatedUsersPageRequest { tenantId: string; connectionId: string; requestId: string; after: number | null; reason: string }
export function validateIsolatedUsersPageRequest(v: unknown): v is IsolatedUsersPageRequest {
  return object(v) && Object.keys(v).sort().join(",") === "after,connectionId,reason,requestId,tenantId" &&
    uuid(v.tenantId) && uuid(v.connectionId) && uuid(v.requestId) &&
    (v.after === null || (Number.isSafeInteger(v.after) && Number(v.after) > 0)) &&
    typeof v.reason === "string" && v.reason.trim().length >= 3 && v.reason.trim().length <= 500;
}
interface Ready { state: "ready"; request_id: string; tenant_id: string; connection_id: string;
  region: "uk" | "us"; after: number | null; send_before: number; api_key: string }
function ready(v: unknown, request: IsolatedUsersPageRequest, now: number): v is Ready {
  return object(v) && v.state === "ready" && v.request_id === request.requestId &&
    v.tenant_id === request.tenantId && v.connection_id === request.connectionId &&
    (v.region === "uk" || v.region === "us") && v.after === request.after &&
    Number.isSafeInteger(v.send_before) && Number(v.send_before) > now && Number(v.send_before) <= now + 6000 &&
    typeof v.api_key === "string" && /^[\x21-\x7e]{1,4096}$/.test(v.api_key);
}
function waiting(v: unknown, now: number): v is { state: "wait"; retry_at: number } {
  return object(v) && v.state === "wait" && Number.isSafeInteger(v.retry_at) &&
    Number(v.retry_at) > now && Number(v.retry_at) <= now + 90000 &&
    (v.wait_kind === "lease" || v.wait_kind === "quota");
}

/** One independently leased GET. No source job or cursor RPC is available here. */
export async function runIsolatedUsersPage(request: IsolatedUsersPageRequest, ports: {
  userRpc: Rpc; serviceRpc: Rpc; fetcher?: typeof fetch; signal?: AbortSignal; clock?: () => number;
}): Promise<unknown> {
  if (!validateIsolatedUsersPageRequest(request)) throw Error("request_invalid");
  const started = await ports.userRpc("new_dawn_commusoft_users_page_start", {
    p_tenant: request.tenantId, p_connection: request.connectionId, p_request: request.requestId,
    p_after: request.after, p_reason: request.reason,
  });
  if (started.error || !object(started.data) || started.data.request_id !== request.requestId ||
    started.data.state !== "prepared") throw Error("scope_denied");
  const clock = ports.clock ?? Date.now;
  let claimed = false;
  try {
    const acquired = await ports.serviceRpc("new_dawn_commusoft_users_page_acquire", { p_request: request.requestId });
    if (acquired.error) throw Error("scope_changed");
    if (waiting(acquired.data, clock()))
      return { state: "waiting", request_id: request.requestId, retry_at: acquired.data.retry_at };
    // Even an unexpected ready payload may have claimed the lease in SQL.
    claimed = object(acquired.data) && acquired.data.state === "ready";
    if (!ready(acquired.data, request, clock())) throw Error("scope_changed");
    const a = acquired.data;
    const current = async () => {
      const result = await ports.serviceRpc("new_dawn_commusoft_users_page_guard", { p_request: request.requestId });
      return !result.error && result.data === true;
    };
    const page = await readCommusoftPage({ region: a.region, resource: "users", after: a.after, limit: 10 }, a.api_key, {
      stillAuthorized: current, fetcher: ports.fetcher, signal: ports.signal,
      timeoutMs: 30000, sendBefore: a.send_before, clock,
    });
    const envelope = page.rawEnvelope;
    if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 262144) throw Error("response_too_large");
    const finished = await ports.serviceRpc("new_dawn_commusoft_users_page_finish", {
      p_request: request.requestId, p_envelope: envelope,
    });
    if (finished.error || !object(finished.data) || finished.data.version !== "commusoft-isolated-users-page/1" ||
      finished.data.request_id !== request.requestId || finished.data.tenant_id !== request.tenantId ||
      finished.data.connection_id !== request.connectionId || finished.data.record_count !== page.records.length ||
      finished.data.has_more !== !page.collectionExhausted || finished.data.next_cursor !== page.nextCursor)
      throw Error("result_unconfirmed");
    return finished.data;
  } catch (error) {
    const code = error instanceof CommusoftReadError ?
      ["authority_unavailable", "authority_transport_unavailable", "request_window_expired"].includes(error.code)
        ? "scope_changed" : error.code === "invalid_request" ? "invalid_response" : error.code
      : error instanceof Error && ["scope_changed", "response_too_large", "result_unconfirmed"].includes(error.message)
        ? error.message : "transport_unavailable";
    if (claimed) await Promise.resolve(ports.serviceRpc("new_dawn_commusoft_users_page_fail", {
      p_request: request.requestId, p_code: code,
      p_retry_at: error instanceof CommusoftReadError && error.code === "rate_limited" && error.retryAt
        ? new Date(error.retryAt).toISOString() : null,
    })).catch(() => {});
    throw Error(code);
  }
}
