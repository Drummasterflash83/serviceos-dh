type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uuid = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
const date = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parsed = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(s);
};
export interface ReportCaptureRequest {
  tenantId: string; connectionId: string; requestId: string; realmId: string;
  environment: "production" | "sandbox"; kind: "ProfitAndLoss" | "AgedReceivables";
  periodStart: string | null; periodEnd: string | null; accountingMethod: "Cash" | "Accrual" | null;
  reportDate: string | null; agingMethod: "Report_Date" | null; reason: string;
}
export function validateReportCaptureRequest(value: unknown): value is ReportCaptureRequest {
  if (!object(value) || Object.keys(value).sort().join(",") !==
    "accountingMethod,agingMethod,connectionId,environment,kind,periodEnd,periodStart,realmId,reason,reportDate,requestId,tenantId") return false;
  if (!uuid(value.tenantId) || !uuid(value.connectionId) || !uuid(value.requestId) ||
    !/^[1-9][0-9]{0,29}$/.test(String(value.realmId)) || !["production", "sandbox"].includes(String(value.environment)) ||
    typeof value.reason !== "string" || value.reason.trim().length < 3 || value.reason.trim().length > 500) return false;
  return (value.kind === "ProfitAndLoss" && date(value.periodStart) && date(value.periodEnd) &&
    value.periodStart <= value.periodEnd && ["Cash", "Accrual"].includes(String(value.accountingMethod)) &&
    value.reportDate === null && value.agingMethod === null) ||
    (value.kind === "AgedReceivables" && value.periodStart === null && value.periodEnd === null &&
    value.accountingMethod === null && date(value.reportDate) && value.agingMethod === "Report_Date");
}
interface Acquired {
  requestId: string; tenantId: string; connectionId: string; realmId: string;
  environment: "sandbox" | "production"; accessToken: string;
  kind: ReportCaptureRequest["kind"]; periodStart: string | null; periodEnd: string | null;
  accountingMethod: ReportCaptureRequest["accountingMethod"];
  reportDate: string | null; agingMethod: ReportCaptureRequest["agingMethod"];
}
function acquired(value: unknown, request: ReportCaptureRequest): value is Acquired {
  return object(value) && value.requestId === request.requestId && value.tenantId === request.tenantId &&
    value.connectionId === request.connectionId && value.realmId === request.realmId &&
    value.environment === request.environment && typeof value.accessToken === "string" &&
    /^[\x21-\x7e]{1,8192}$/.test(value.accessToken) && value.kind === request.kind &&
    value.periodStart === request.periodStart && value.periodEnd === request.periodEnd &&
    value.accountingMethod === request.accountingMethod && value.reportDate === request.reportDate &&
    value.agingMethod === request.agingMethod;
}
export function reportUrl(a: Acquired): string {
  const origin = a.environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
  const params = new URLSearchParams();
  if (a.kind === "ProfitAndLoss") {
    params.set("start_date", a.periodStart!); params.set("end_date", a.periodEnd!);
    params.set("accounting_method", a.accountingMethod!);
  } else { params.set("report_date", a.reportDate!); params.set("aging_method", "Report_Date"); }
  return `${origin}/v3/company/${a.realmId}/reports/${a.kind}?${params}`;
}
async function readReport(a: Acquired, ports: { fetcher?: typeof fetch; stillAuthorized: () => Promise<boolean>; signal?: AbortSignal }): Promise<string> {
  if (!await ports.stillAuthorized()) throw Error("scope_changed");
  const signal = ports.signal ? AbortSignal.any([ports.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
  const response = await (ports.fetcher ?? fetch)(reportUrl(a), { method: "GET", redirect: "error", signal,
    headers: { Authorization: `Bearer ${a.accessToken}`, Accept: "application/json" } });
  if (!response.ok || !response.body || response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    await response.body?.cancel();
    throw Error(response.status === 401 ? "authentication_required" : "provider_unavailable");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > 2097152) throw Error("response_too_large"); chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes), body: unknown = JSON.parse(raw);
  // The SQL receipt classifies a structurally surprising 200 JSON response as
  // held evidence. The browser never receives its raw rows or money values.
  if (!object(body)) throw Error("response_invalid");
  if (!await ports.stillAuthorized()) throw Error("scope_changed");
  return raw;
}
export async function runReportCapture(request: ReportCaptureRequest, ports: {
  userRpc: Rpc; serviceRpc: Rpc; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<unknown> {
  if (!validateReportCaptureRequest(request)) throw Error("request_invalid");
  const started = await ports.userRpc("learn_quickbooks_report_start", {
    p_tenant: request.tenantId, p_connection: request.connectionId, p_request: request.requestId,
    p_realm: request.realmId, p_environment: request.environment,
    p_kind: request.kind, p_period_start: request.periodStart, p_period_end: request.periodEnd,
    p_accounting_method: request.accountingMethod, p_report_date: request.reportDate,
    p_aging_method: request.agingMethod, p_reason: request.reason,
  });
  if (started.error || !object(started.data) || started.data.requestId !== request.requestId || started.data.state !== "prepared")
    throw Error("scope_denied");
  return capturePreparedReport(request, ports);
}
/** For a service-only scheduled request already prepared by the audited SQL
 * policy. The caller cannot create or broaden a request through this path. */
export async function capturePreparedReport(request: ReportCaptureRequest, ports: {
  serviceRpc: Rpc; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<unknown> {
  if (!validateReportCaptureRequest(request)) throw Error("request_invalid");
  const claim = await ports.serviceRpc("learn_quickbooks_report_acquire", { p_request: request.requestId });
  if (claim.error || !acquired(claim.data, request)) throw Error("claim_unavailable");
  const a = claim.data;
  const stillAuthorized = async () => {
    const current = await ports.serviceRpc("learn_quickbooks_report_current", { p_request: request.requestId });
    return !current.error && current.data === true;
  };
  try {
    const raw = await readReport(a, { ...ports, stillAuthorized });
    const finished = await ports.serviceRpc("learn_quickbooks_report_finish", { p_request: request.requestId, p_raw: raw });
    if (finished.error || !object(finished.data) || finished.data.request_id !== request.requestId ||
      finished.data.tenant_id !== request.tenantId || finished.data.kind !== request.kind ||
      typeof finished.data.response_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(finished.data.response_sha256) ||
      !uuid(finished.data.audit_id) || !["verified", "held"].includes(String(finished.data.validation_state)) ||
      (finished.data.validation_state === "verified" && finished.data.validation_code !== null) ||
      (finished.data.validation_state === "held" && !["format_invalid", "report_name_mismatch", "scope_mismatch"].includes(String(finished.data.validation_code))))
      throw Error("result_unconfirmed");
    return finished.data;
  } catch (error) {
    const code = error instanceof Error && ["scope_changed", "authentication_required", "provider_unavailable",
      "response_too_large", "response_invalid", "result_unconfirmed"].includes(error.message)
      ? error.message : "transport_unavailable";
    await Promise.resolve(ports.serviceRpc("learn_quickbooks_report_fail", { p_request: request.requestId, p_code: code })).catch(() => {});
    throw Error(code);
  }
}
