import { refreshQuickBooksConnection } from "./oauth_flow.ts";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
export interface ReportRefreshRequest {
  tenantId: string; connectionId: string; requestId: string; realmId: string;
  environment: "production" | "sandbox"; reason: string;
}
export function validReportRefreshRequest(v: unknown): v is ReportRefreshRequest {
  if (!object(v) || Object.keys(v).sort().join(",") !==
    "connectionId,environment,realmId,reason,requestId,tenantId") return false;
  return uuid(v.tenantId) && uuid(v.connectionId) && uuid(v.requestId) &&
    typeof v.realmId === "string" && /^[1-9][0-9]{0,29}$/.test(v.realmId) &&
    (v.environment === "production" || v.environment === "sandbox") &&
    typeof v.reason === "string" && v.reason.trim().length >= 3 && v.reason.trim().length <= 500;
}
/** Explicit operator-only credential maintenance for one selected company.
 * It never starts an import, reads a report, or returns either OAuth token.
 */
export async function runReportRefresh(request: ReportRefreshRequest, ports: {
  userRpc: Rpc; serviceRpc: Rpc; fetcher?: typeof fetch; signal?: AbortSignal; clock?: () => number;
}): Promise<{ version: "quickbooks-report-refresh/1"; requestId: string; state: "current" | "refreshed" | "busy" | "authentication_required" | "unconfirmed" }> {
  if (!validReportRefreshRequest(request)) throw Error("request_invalid");
  const allowed = await ports.userRpc("learn_quickbooks_report_refresh_authorize", {
    p_tenant: request.tenantId, p_connection: request.connectionId,
    p_request: request.requestId, p_realm: request.realmId,
    p_environment: request.environment, p_reason: request.reason.trim(),
  });
  if (allowed.error || !object(allowed.data) || allowed.data.requestId !== request.requestId ||
    allowed.data.tenantId !== request.tenantId || allowed.data.connectionId !== request.connectionId ||
    allowed.data.realmId !== request.realmId || allowed.data.environment !== request.environment)
    throw Error("scope_denied");
  const state = await refreshQuickBooksConnection(request.tenantId, request.connectionId, {
    rpc: ports.serviceRpc, fetcher: ports.fetcher, signal: ports.signal, clock: ports.clock,
  });
  return { version: "quickbooks-report-refresh/1", requestId: request.requestId, state };
}
