type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
import { CommusoftThrottle } from "./retry_after.ts";
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export interface ExactJobDetailRequest {
  tenantId: string;
  jobId: string;
  requestId: string;
  reason: string;
}
export function validateExactJobDetailRequest(value: unknown): value is ExactJobDetailRequest {
  if (!object(value) || Object.keys(value).sort().join(",") !== "jobId,reason,requestId,tenantId") return false;
  return uuid(value.tenantId) && uuid(value.jobId) && uuid(value.requestId) &&
    typeof value.reason === "string" && value.reason.trim().length >= 3 && value.reason.trim().length <= 500;
}
interface Ready {
  state: "ready";
  request_id: string;
  tenant_id: string;
  job_id: string;
  source_version_id: string;
  external_id: string;
  region: "uk" | "us";
  api_key: string;
}
function ready(value: unknown, request: ExactJobDetailRequest): value is Ready {
  return object(value) && value.state === "ready" && value.request_id === request.requestId &&
    value.tenant_id === request.tenantId && value.job_id === request.jobId &&
    uuid(value.source_version_id) && typeof value.external_id === "string" &&
    /^[1-9][0-9]{0,15}$/.test(value.external_id) && Number(value.external_id) <= Number.MAX_SAFE_INTEGER &&
    (value.region === "uk" || value.region === "us") &&
    typeof value.api_key === "string" && /^[\x21-\x7e]{1,4096}$/.test(value.api_key);
}
function wait(value: unknown): value is { state: "wait"; retry_at: number; wait_kind?: "lease" | "quota" } {
  return object(value) && value.state === "wait" && Number.isSafeInteger(value.retry_at) &&
    Number(value.retry_at) > Date.now() && Number(value.retry_at) <= Date.now() + 90000 &&
    (value.wait_kind === undefined || value.wait_kind === "lease" || value.wait_kind === "quota");
}
// A fixed, value-free category for a rejected provider response. Never log the
// response itself, a field value, a job ID, or the provider's error object.
export function rejectedJobDetailShape(raw: string, externalId: string): string {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return "json_invalid"; }
  if (!object(body)) return "root_type";
  if (typeof body.id !== "number" || !Number.isSafeInteger(body.id) ||
    String(body.id) !== externalId || "error" in body) return "identity_type";
  const users = body.usersCurrentlyAssignedToJob;
  if (users !== undefined && users !== null) {
    if (!Array.isArray(users)) return "assigned_type";
    if (users.length > 20) return "assigned_count";
    for (const user of users) {
      if (!object(user)) return "assigned_item_type";
      if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) ||
        user.id < 0 || user.id > 9999999999999999)
        return "assigned_id_type";
      if (typeof user.fullName !== "string") return "assigned_name_type";
      if (user.fullName.length > 200) return "assigned_name_length";
    }
  }
  for (const field of ["lastUpdatedOnDateTime", "expectedOnsiteDateTime", "expectedCompletionDateTime"]) {
    const value = body[field];
    if (value !== undefined && value !== null && String(value).length > 80) return `${field}_length`;
  }
  for (const field of ["isJobOnHold", "hasSLA", "onHoldReasonDescription", "SLAStatus", "contractID"]) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    const expected = ["isJobOnHold", "hasSLA"].includes(field) ? "boolean"
      : field === "contractID" ? "number" : "string";
    if (typeof value !== expected) return `${field}_type`;
    if (expected === "string" && String(value).length > 200) return `${field}_length`;
    if (expected === "number" && (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER))
      return `${field}_range`;
  }
  if ("quotedAmount" in body && body.quotedAmount !== null) {
    if (typeof body.quotedAmount !== "string") return "quotedAmount_type";
    if (new TextEncoder().encode(body.quotedAmount).byteLength > 200) return "quotedAmount_length";
  }
  return "sql_rejection_unclassified";
}
async function boundedJson(response: Response, externalId: string, signal: AbortSignal): Promise<string> {
  if (!response.ok || !response.body || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) throw new CommusoftThrottle(response.headers.get("retry-after"));
    throw Error(response.status === 401 ? "authentication_required" : "provider_unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 131072) throw Error("response_too_large");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed: unknown = JSON.parse(raw);
  if (!object(parsed) || parsed.error !== undefined ||
    !(typeof parsed.id === "number" && Number.isSafeInteger(parsed.id) && String(parsed.id) === externalId))
    throw Error("response_invalid");
  return raw;
}
export async function runExactJobDetail(request: ExactJobDetailRequest, ports: {
  userRpc: Rpc;
  serviceRpc: Rpc;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  clock?: () => number;
  pause?: (ms: number) => Promise<void>;
  onRejectedShape?: (category: string) => void;
}): Promise<unknown> {
  if (!validateExactJobDetailRequest(request)) throw Error("request_invalid");
  const started = await ports.userRpc("new_dawn_commusoft_job_detail_start", {
    p_tenant: request.tenantId, p_job: request.jobId,
    p_request: request.requestId, p_reason: request.reason,
  });
  if (started.error || !object(started.data) || started.data.request_id !== request.requestId || started.data.state !== "prepared")
    throw Error("scope_denied");
  const clock = ports.clock ?? Date.now;
  const pause = ports.pause ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let a: Ready | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const acquired = await ports.serviceRpc("new_dawn_commusoft_job_detail_acquire", { p_request: request.requestId });
      if (acquired.error) throw Error("scope_changed");
      if (ready(acquired.data, request)) { a = acquired.data; break; }
      if (!wait(acquired.data)) throw Error("provider_unavailable");
      if (acquired.data.retry_at - clock() > 1500 || attempt === 2)
        return { request_id: request.requestId, state: "waiting", retry_at: acquired.data.retry_at };
      await pause(Math.max(1, Math.min(1500, acquired.data.retry_at - clock() + 20)));
    }
    if (!a) throw Error("provider_unavailable");
    const current = async () => {
      const result = await ports.serviceRpc("new_dawn_commusoft_job_detail_current", { p_request: request.requestId });
      return !result.error && result.data === true;
    };
    if (!await current()) throw Error("scope_changed");
    const signal = ports.signal ? AbortSignal.any([ports.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const origin = a.region === "uk" ? "https://app.commusoft.co.uk" : "https://app.commusoft.us";
    const response = await (ports.fetcher ?? fetch)(`${origin}/api/v2/jobs/${a.external_id}`, {
      method: "GET", redirect: "error", signal,
      headers: { Authorization: `Bearer ${a.api_key}`, Accept: "application/json", "X-API-VERSION": "2.0" },
    });
    const raw = await boundedJson(response, a.external_id, signal);
    if (!await current()) throw Error("scope_changed");
    const finished = await ports.serviceRpc("new_dawn_commusoft_job_detail_finish", { p_request: request.requestId, p_raw: raw });
    if (finished.error || !object(finished.data) || finished.data.request_id !== request.requestId ||
      finished.data.job_id !== request.jobId || finished.data.source_version_id !== a.source_version_id ||
      !["commusoft-exact-job-detail/2", "commusoft-exact-job-detail/3"].includes(String(finished.data.version))) {
      ports.onRejectedShape?.(rejectedJobDetailShape(raw, a.external_id));
      throw Error("result_unconfirmed");
    }
    return finished.data;
  } catch (error) {
    const code = error instanceof Error && ["scope_changed", "authentication_required", "provider_unavailable", "rate_limited",
      "response_too_large", "response_invalid", "result_unconfirmed"].includes(error.message)
      ? error.message : "transport_unavailable";
    await Promise.resolve(ports.serviceRpc("new_dawn_commusoft_job_detail_fail", {
      p_request: request.requestId, p_code: code,
      p_retry_at: error instanceof CommusoftThrottle ? new Date(error.retryAt).toISOString() : null,
    })).catch(() => {});
    throw Error(code);
  }
}
