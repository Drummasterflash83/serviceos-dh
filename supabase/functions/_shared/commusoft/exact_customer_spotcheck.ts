/** One of ten operator-registered, read-only Commusoft customer detail checks. */
import { CommusoftThrottle } from "./retry_after.ts";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const uuid = (v: unknown): v is string => typeof v === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

export type SpotcheckRequest =
  | { action: "register"; tenantId: string; batchId: string; reason: string;
      items: { external_id: string; source_version_id: string }[] }
  | { action: "check"; batchId: string; ordinal: number };

export function validateSpotcheckRequest(v: unknown): v is SpotcheckRequest {
  if (!object(v)) return false;
  if (v.action === "register") {
    if (Object.keys(v).sort().join(",") !== "action,batchId,items,reason,tenantId" ||
      !uuid(v.tenantId) || !uuid(v.batchId) ||
      typeof v.reason !== "string" || v.reason.trim().length < 3 || v.reason.trim().length > 500 ||
      !Array.isArray(v.items) || v.items.length !== 10) return false;
    const keys = new Set<string>();
    return v.items.every((item) => {
      if (!object(item) || Object.keys(item).sort().join(",") !== "external_id,source_version_id" ||
        typeof item.external_id !== "string" || !/^[1-9][0-9]{0,15}$/.test(item.external_id) ||
        Number(item.external_id) > Number.MAX_SAFE_INTEGER || !uuid(item.source_version_id) ||
        keys.has(item.external_id)) return false;
      keys.add(item.external_id); return true;
    });
  }
  return v.action === "check" && Object.keys(v).sort().join(",") === "action,batchId,ordinal" &&
    uuid(v.batchId) && Number.isInteger(v.ordinal) && Number(v.ordinal) >= 0 && Number(v.ordinal) <= 10;
}

type Ready = { state: "ready"; batch_id: string; ordinal: number; external_id: string | null;
  source_version_id: string | null; resource: "customer" | "customer_types";
  region: "uk" | "us"; api_key: string };
function ready(value: unknown, req: Extract<SpotcheckRequest, { action: "check" }>): value is Ready {
  return object(value) && value.state === "ready" && value.batch_id === req.batchId &&
    value.ordinal === req.ordinal &&
    (req.ordinal === 0
      ? value.resource === "customer_types" && value.external_id === null && value.source_version_id === null
      : value.resource === "customer" && typeof value.external_id === "string" &&
        /^[1-9][0-9]{0,15}$/.test(value.external_id) &&
        Number(value.external_id) <= Number.MAX_SAFE_INTEGER && uuid(value.source_version_id)) &&
    (value.region === "uk" || value.region === "us") &&
    typeof value.api_key === "string" && /^[\x21-\x7e]{1,4096}$/.test(value.api_key);
}
function wait(v: unknown): v is { state: "wait"; retry_at: number } {
  return object(v) && v.state === "wait" && Number.isSafeInteger(v.retry_at) &&
    Number(v.retry_at) > Date.now() && Number(v.retry_at) <= Date.now() + 90000;
}
async function boundedJson(response: Response, external: string | null, signal: AbortSignal): Promise<string> {
  if (!response.ok || !response.body ||
      response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel().catch(() => {});
    if (response.status === 429) throw new CommusoftThrottle(response.headers.get("retry-after"));
    throw Error(response.status === 401 ? "authentication_required" :
      response.status === 403 ? "access_denied" : "provider_unavailable");
  }
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 131072) throw Error("response_too_large");
      parts.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const body: unknown = JSON.parse(raw);
  if (external === null) {
    if (!(Array.isArray(body) || (object(body) && Array.isArray(body.data) && body.error === undefined)))
      throw Error("response_invalid");
  } else if (!object(body) || body.error !== undefined || body.type !== "customer" ||
    typeof body.id !== "number" || !Number.isSafeInteger(body.id) || String(body.id) !== external ||
    typeof body.customerType !== "number" || !Number.isSafeInteger(body.customerType) || body.customerType < 1)
    throw Error("response_invalid");
  return raw;
}

export async function runCustomerSpotcheck(req: SpotcheckRequest, ports: {
  userRpc: Rpc; serviceRpc: Rpc; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<unknown> {
  if (!validateSpotcheckRequest(req)) throw Error("request_invalid");
  if (req.action === "register") {
    const result = await ports.userRpc("new_dawn_commusoft_customer_spotcheck_register", {
      p_tenant: req.tenantId, p_batch: req.batchId, p_items: req.items, p_reason: req.reason });
    if (result.error || !object(result.data) || result.data.batch_id !== req.batchId ||
      result.data.state !== "prepared" || result.data.count !== 10) throw Error("scope_denied");
    return result.data;
  }
  const authorized = await ports.userRpc("new_dawn_commusoft_customer_spotcheck_authorize", {
    p_batch: req.batchId, p_ordinal: req.ordinal });
  if (authorized.error || !object(authorized.data) || authorized.data.batch_id !== req.batchId ||
    authorized.data.ordinal !== req.ordinal) throw Error("scope_denied");
  if (authorized.data.state === "complete" || authorized.data.state === "failed") return authorized.data;
  if (authorized.data.state !== "prepared") throw Error("scope_changed");
  let claimed = false;
  try {
    const acquired = await ports.serviceRpc("new_dawn_commusoft_customer_spotcheck_acquire", {
      p_batch: req.batchId, p_ordinal: req.ordinal });
    if (acquired.error) throw Error("scope_changed");
    if (wait(acquired.data)) return { state: "waiting", batch_id: req.batchId,
      ordinal: req.ordinal, retry_at: acquired.data.retry_at };
    if (!ready(acquired.data, req)) throw Error("scope_changed");
    claimed = true;
    const current = async () => {
      const r = await ports.serviceRpc("new_dawn_commusoft_customer_spotcheck_current", {
        p_batch: req.batchId, p_ordinal: req.ordinal });
      return !r.error && r.data === true;
    };
    if (!await current()) throw Error("scope_changed");
    const signal = ports.signal ? AbortSignal.any([ports.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const origin = acquired.data.region === "uk" ? "https://app.commusoft.co.uk" : "https://app.commusoft.us";
    const path = req.ordinal === 0 ? "/api/v2/settings/customerTypes" :
      `/api/v2/properties/${acquired.data.external_id}`;
    const response = await (ports.fetcher ?? fetch)(`${origin}${path}`, {
      method: "GET", redirect: "error", signal,
      headers: { Authorization: `Bearer ${acquired.data.api_key}`, Accept: "application/json",
        "User-Agent": "OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)" },
    });
    const raw = await boundedJson(response, acquired.data.external_id, signal);
    if (!await current()) throw Error("scope_changed");
    const finished = await ports.serviceRpc("new_dawn_commusoft_customer_spotcheck_finish", {
      p_batch: req.batchId, p_ordinal: req.ordinal, p_raw: raw });
    if (finished.error || !object(finished.data) || finished.data.state !== "complete" ||
      finished.data.batch_id !== req.batchId || finished.data.ordinal !== req.ordinal ||
      (req.ordinal !== 0 && finished.data.source_version_id !== acquired.data.source_version_id))
      throw Error("result_unconfirmed");
    return finished.data;
  } catch (error) {
    const code = error instanceof CommusoftThrottle ? "rate_limited" :
      error instanceof Error && ["scope_changed", "authentication_required", "access_denied", "provider_unavailable",
      "response_too_large", "response_invalid", "result_unconfirmed"].includes(error.message)
      ? error.message : "transport_unavailable";
    if (claimed) await Promise.resolve(ports.serviceRpc("new_dawn_commusoft_customer_spotcheck_fail", {
      p_batch: req.batchId, p_ordinal: req.ordinal, p_code: code,
    })).catch(() => {});
    throw Error(code);
  }
}
