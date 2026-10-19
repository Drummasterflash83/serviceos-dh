type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const uuid = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const object = (s: unknown): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s);
export interface InvoiceCheckRequest {
  tenantId: string;
  connectionId: string;
  requestId: string;
  versionIds: string[];
  reason: string;
}
export function validateInvoiceCheckRequest(value: unknown): value is InvoiceCheckRequest {
  if (!object(value) || Object.keys(value).sort().join(",") !== "connectionId,reason,requestId,tenantId,versionIds") return false;
  const ids = value.versionIds;
  return uuid(value.tenantId) && uuid(value.connectionId) && uuid(value.requestId) &&
    Array.isArray(ids) && ids.length >= 2 && ids.length <= 3 && ids.every(uuid) &&
    new Set(ids).size === ids.length && typeof value.reason === "string" &&
    value.reason.trim().length >= 3 && value.reason.trim().length <= 500;
}
interface Acquired {
  requestId: string;
  realmId: string;
  environment: "sandbox" | "production";
  accessToken: string;
  items: { versionId: string; invoiceId: string }[];
}
function acquired(value: unknown, request: InvoiceCheckRequest): value is Acquired {
  if (!object(value) || value.requestId !== request.requestId ||
    value.tenantId !== request.tenantId || value.connectionId !== request.connectionId ||
    !/^[1-9][0-9]{0,29}$/.test(String(value.realmId)) ||
    !["sandbox", "production"].includes(String(value.environment)) ||
    typeof value.accessToken !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(value.accessToken) ||
    !Array.isArray(value.items) || value.items.length !== request.versionIds.length) return false;
  return value.items.every((item: unknown, i: number) => object(item) && item.versionId === request.versionIds[i] &&
    typeof item.invoiceId === "string" && /^[A-Za-z0-9-]{1,128}$/.test(item.invoiceId));
}
async function readInvoice(
  a: Acquired, invoiceId: string,
  ports: { fetcher?: typeof fetch; stillAuthorized: () => Promise<boolean>; signal?: AbortSignal },
): Promise<string> {
  const origin = a.environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
  const url = `${origin}/v3/company/${a.realmId}/invoice/${invoiceId}`;
  const signal = ports.signal ? AbortSignal.any([ports.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  if (!await ports.stillAuthorized()) throw Error("scope_changed");
  const response = await (ports.fetcher ?? fetch)(url, {
    method: "GET", redirect: "error", signal,
    headers: { Authorization: `Bearer ${a.accessToken}`, Accept: "application/json" },
  });
  if (!response.ok || !response.body || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel();
    throw Error(response.status === 401 ? "authentication_required" : "provider_unavailable");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 131072) throw Error("response_too_large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const body: unknown = JSON.parse(raw);
  if (!object(body) || !object(body.Invoice) || body.Invoice.Id !== invoiceId || body.Fault !== undefined) throw Error("response_invalid");
  if (!await ports.stillAuthorized()) throw Error("scope_changed");
  return raw;
}
export async function runInvoiceCheck(request: InvoiceCheckRequest, ports: {
  userRpc: Rpc;
  serviceRpc: Rpc;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<unknown> {
  if (!validateInvoiceCheckRequest(request)) throw Error("request_invalid");
  const started = await ports.userRpc("learn_quickbooks_invoice_check_start", {
    p_tenant: request.tenantId, p_connection: request.connectionId,
    p_request: request.requestId, p_versions: request.versionIds, p_reason: request.reason,
  });
  if (started.error || !object(started.data) || started.data.requestId !== request.requestId || started.data.state !== "prepared")
    throw Error("scope_denied");
  const claim = await ports.serviceRpc("learn_quickbooks_invoice_check_acquire", { p_request: request.requestId });
  if (claim.error || !acquired(claim.data, request)) throw Error("claim_unavailable");
  const a = claim.data;
  const stillAuthorized = async () => {
    const status = await ports.serviceRpc("learn_quickbooks_invoice_check_current", { p_request: request.requestId });
    return !status.error && status.data === true;
  };
  try {
    const raws: string[] = [];
    for (const item of a.items) raws.push(await readInvoice(a, item.invoiceId, { ...ports, stillAuthorized }));
    if (!await stillAuthorized()) throw Error("scope_changed");
    const finished = await ports.serviceRpc("learn_quickbooks_invoice_check_finish", { p_request: request.requestId, p_raw: raws });
    if (finished.error || !object(finished.data) || finished.data.request_id !== request.requestId ||
      !Array.isArray(finished.data.rows) || finished.data.rows.length !== request.versionIds.length) throw Error("result_unconfirmed");
    return finished.data;
  } catch (error) {
    const code = error instanceof Error && ["scope_changed", "authentication_required", "provider_unavailable",
      "response_too_large", "response_invalid", "result_unconfirmed"].includes(error.message)
      ? error.message : "transport_unavailable";
    await Promise.resolve(ports.serviceRpc("learn_quickbooks_invoice_check_fail", { p_request: request.requestId, p_code: code })).catch(() => {});
    throw Error(code);
  }
}
