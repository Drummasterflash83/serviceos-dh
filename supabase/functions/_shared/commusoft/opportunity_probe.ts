/** One manual, source-only Commusoft opportunity page. No scheduled capture,
 * customer/quote projection, or provider mutation. Raw data goes only to the
 * private, operator-gated retention RPC; responses contain bounded summaries.
 */
import { CommusoftThrottle } from "./retry_after.ts";
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export interface OpportunityProbeRequest {
  tenantId: string;
  connectionId: string;
  requestId: string;
  reason: string;
}
export function validOpportunityProbeRequest(value: unknown): value is OpportunityProbeRequest {
  return (
    object(value) &&
    Object.keys(value).sort().join(",") === "connectionId,reason,requestId,tenantId" &&
    uuid(value.tenantId) &&
    uuid(value.connectionId) &&
    uuid(value.requestId) &&
    typeof value.reason === "string" &&
    value.reason.trim().length >= 3 &&
    value.reason.trim().length <= 500
  );
}
type Permit = {
  state: "ready";
  requestId: string;
  tenantId: string;
  connectionId: string;
  region: "uk" | "us";
  apiKey: string;
  permitId: string;
  sendBefore: number;
};
function validPermit(value: unknown, request: OpportunityProbeRequest): value is Permit {
  return (
    object(value) &&
    value.state === "ready" &&
    value.requestId === request.requestId &&
    value.tenantId === request.tenantId &&
    value.connectionId === request.connectionId &&
    (value.region === "uk" || value.region === "us") &&
    uuid(value.permitId) &&
    typeof value.apiKey === "string" &&
    /^[\x21-\x7e]{1,4096}$/.test(value.apiKey) &&
    Number.isSafeInteger(value.sendBefore) &&
    Number(value.sendBefore) > Date.now()
  );
}
export function opportunityProbeOrigin(projectUrl: string, origin: string | null): string | null {
  let host: string;
  try {
    host = new URL(projectUrl).host;
  } catch {
    return null;
  }
  const allowed =
    host === "tgbnakbxwcqjeimygroz.supabase.co"
      ? ["https://app.openfolk.ai", "https://www.openfolk.ai"]
      : host === "saatxzwxvdvqevbnskxy.supabase.co"
        ? ["https://test.openfolk.ai"]
        : [];
  if (!allowed.length) return null;
  if (origin === null) return allowed[0];
  return allowed.includes(origin) ? origin : null;
}

async function readPage(
  permit: Permit,
  ports: {
    fetcher?: typeof fetch;
    stillAuthorized: () => Promise<boolean>;
    signal?: AbortSignal;
  },
): Promise<string> {
  if (Date.now() >= permit.sendBefore || !(await ports.stillAuthorized()))
    throw Error("scope_changed");
  const origin =
    permit.region === "uk" ? "https://app.commusoft.co.uk" : "https://app.commusoft.us";
  const url = `${origin}/api/v2/opportunities?limit=10&includeCount=true`;
  const signal = ports.signal
    ? AbortSignal.any([ports.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  const response = await (ports.fetcher ?? fetch)(url, {
    method: "GET",
    redirect: "error",
    signal,
    headers: { Authorization: `Bearer ${permit.apiKey}`, Accept: "application/json" },
  });
  if (
    !response.ok ||
    !response.body ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  ) {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) throw new CommusoftThrottle(response.headers.get("retry-after"));
    throw Error(
      response.status === 401
        ? "authentication_required"
        : response.status === 403
          ? "access_denied"
          : "provider_unavailable",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 262144) throw Error("response_too_large");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let raw: string, body: unknown;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    body = JSON.parse(raw);
  } catch {
    throw Error("response_invalid");
  }
  if (
    !object(body) ||
    !Array.isArray(body.data) ||
    body.data.length > 10 ||
    body.data.some(
      (item: unknown) => !object(item) || !["string", "number"].includes(typeof item.id),
    )
  )
    throw Error("response_invalid");
  if (!(await ports.stillAuthorized())) throw Error("scope_changed");
  return raw;
}

export async function runOpportunityProbe(
  request: OpportunityProbeRequest,
  ports: {
    userRpc: Rpc;
    serviceRpc: Rpc;
    fetcher?: typeof fetch;
    signal?: AbortSignal;
  },
): Promise<unknown> {
  if (!validOpportunityProbeRequest(request)) throw Error("request_invalid");
  const start = await ports.userRpc("new_dawn_commusoft_opportunity_probe_start", {
    p_tenant: request.tenantId,
    p_connection: request.connectionId,
    p_request: request.requestId,
    p_reason: request.reason,
  });
  if (
    start.error ||
    !object(start.data) ||
    start.data.requestId !== request.requestId ||
    start.data.state !== "prepared" ||
    start.data.limit !== 10
  )
    throw Error("scope_denied");
  const claim = await ports.serviceRpc("new_dawn_commusoft_opportunity_probe_acquire", {
    p_request: request.requestId,
  });
  if (claim.error || !object(claim.data)) throw Error("claim_unavailable");
  if (claim.data.state === "wait" && Number.isSafeInteger(claim.data.retryAt))
    return { requestId: request.requestId, state: "waiting", retryAt: claim.data.retryAt };
  if (!validPermit(claim.data, request)) throw Error("claim_unavailable");
  const permit = claim.data;
  const stillAuthorized = async () => {
    const check = await ports.serviceRpc("new_dawn_commusoft_opportunity_probe_current", {
      p_request: request.requestId,
      p_permit: permit.permitId,
    });
    return !check.error && check.data === true;
  };
  try {
    const raw = await readPage(permit, { ...ports, stillAuthorized });
    if (!(await stillAuthorized())) throw Error("scope_changed");
    const saved = await ports.serviceRpc("new_dawn_commusoft_opportunity_probe_finish", {
      p_request: request.requestId,
      p_permit: permit.permitId,
      p_raw: raw,
    });
    if (
      saved.error ||
      !object(saved.data) ||
      saved.data.version !== "commusoft-opportunity-probe/1" ||
      saved.data.requestId !== request.requestId ||
      !Number.isInteger(saved.data.recordCount)
    )
      throw Error("result_unconfirmed");
    return saved.data;
  } catch (error) {
    const code =
      error instanceof Error &&
      [
        "scope_changed",
        "authentication_required",
        "access_denied",
        "provider_unavailable",
        "rate_limited",
        "response_too_large",
        "response_invalid",
        "result_unconfirmed",
      ].includes(error.message)
        ? error.message
        : "transport_unavailable";
    await Promise.resolve(
      ports.serviceRpc("new_dawn_commusoft_opportunity_probe_fail", {
        p_request: request.requestId,
        p_code: code,
        p_retry_at: error instanceof CommusoftThrottle ? new Date(error.retryAt).toISOString() : null,
      }),
    ).catch(() => {});
    throw Error(code);
  }
}
