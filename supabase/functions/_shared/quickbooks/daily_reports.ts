import { refreshQuickBooksConnection } from "./oauth_flow.ts";
import { capturePreparedReport, type ReportCaptureRequest } from "./report_capture.ts";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const day = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
interface Claimed {
  runId: string; tenantId: string; connectionId: string; reportDate: string;
  periodStart: string; realmId: string; environment: "production";
}
interface Prepared extends Claimed { pnlRequestId: string; arRequestId: string; reason: string }
function claimed(v: unknown): v is Claimed {
  return object(v) && uuid(v.runId) && uuid(v.tenantId) && uuid(v.connectionId) &&
    day(v.reportDate) && day(v.periodStart) && v.periodStart <= v.reportDate &&
    typeof v.realmId === "string" && /^[1-9][0-9]{0,29}$/.test(v.realmId) && v.environment === "production";
}
function prepared(v: unknown, c: Claimed): v is Prepared {
  return claimed(v) && v.runId === c.runId && v.tenantId === c.tenantId &&
    v.connectionId === c.connectionId && v.reportDate === c.reportDate &&
    v.periodStart === c.periodStart && v.realmId === c.realmId &&
    uuid(v.pnlRequestId) && uuid(v.arRequestId) && v.pnlRequestId !== v.arRequestId &&
    typeof v.reason === "string" && v.reason.trim().length >= 10 && v.reason.length <= 500;
}
/** One run can produce at most two provider GETs. SQL holds a partial pair for
 * review instead of retrying or silently treating one receipt as a full day. */
export async function runDailyQuickBooksReports(ports: {
  rpc: Rpc; fetcher?: typeof fetch; signal?: AbortSignal;
}): Promise<{ checked: number; state: "not_due" | "complete" | "held" }> {
  const result = await ports.rpc("learn_quickbooks_daily_report_claim", {});
  if (result.error) throw Error("claim_unconfirmed");
  if (result.data === null) return { checked: 0, state: "not_due" };
  if (!claimed(result.data)) throw Error("claim_unconfirmed");
  const c = result.data;
  const current = async () => {
    const x = await ports.rpc("learn_quickbooks_daily_report_current", { p_run: c.runId });
    return !x.error && x.data === true;
  };
  try {
    if (!await current()) throw Error("scope_changed");
    const scopedRpc: Rpc = (name, args) => {
      if (name === "learn_quickbooks_refresh_acquire")
        return ports.rpc("learn_quickbooks_daily_refresh_acquire", { p_run: c.runId });
      if (name === "learn_quickbooks_refresh_finish")
        return ports.rpc("learn_quickbooks_daily_refresh_finish", {
          p_run: c.runId, p_lease: args.p_lease, p_generation: args.p_generation,
          p_revision: args.p_revision, p_pair: args.p_pair,
        });
      throw Error("refresh_rpc_invalid");
    };
    const refresh = await refreshQuickBooksConnection(c.tenantId, c.connectionId, {
      rpc: scopedRpc, fetcher: ports.fetcher, signal: ports.signal, stillAuthorized: current,
    });
    if (refresh !== "current" && refresh !== "refreshed")
      throw Error(refresh === "authentication_required" ? "authentication_required" : "capture_unconfirmed");
    if (!await current()) throw Error("scope_changed");
    const p = await ports.rpc("learn_quickbooks_daily_report_prepare", { p_run: c.runId });
    if (p.error || !prepared(p.data, c)) throw Error("capture_unconfirmed");
    const input = (kind: ReportCaptureRequest["kind"], requestId: string): ReportCaptureRequest => ({
      tenantId: c.tenantId, connectionId: c.connectionId, requestId,
      realmId: c.realmId, environment: c.environment, kind,
      periodStart: kind === "ProfitAndLoss" ? c.periodStart : null,
      periodEnd: kind === "ProfitAndLoss" ? c.reportDate : null,
      accountingMethod: kind === "ProfitAndLoss" ? "Accrual" : null,
      reportDate: kind === "AgedReceivables" ? c.reportDate : null,
      agingMethod: kind === "AgedReceivables" ? "Report_Date" : null,
      reason: p.data.reason,
    });
    const pnl = await capturePreparedReport(input("ProfitAndLoss", p.data.pnlRequestId), {
      serviceRpc: ports.rpc, fetcher: ports.fetcher, signal: ports.signal,
    });
    if (!object(pnl) || pnl.validation_state !== "verified") throw Error("response_invalid");
    if (!await current()) throw Error("scope_changed");
    const ar = await capturePreparedReport(input("AgedReceivables", p.data.arRequestId), {
      serviceRpc: ports.rpc, fetcher: ports.fetcher, signal: ports.signal,
    });
    if (!object(ar) || ar.validation_state !== "verified") throw Error("response_invalid");
    const finish = await ports.rpc("learn_quickbooks_daily_report_finish", { p_run: c.runId, p_code: null });
    if (finish.error || !object(finish.data) || finish.data.state !== "complete")
      throw Error("capture_unconfirmed");
    return { checked: 1, state: "complete" };
  } catch (error) {
    const code = error instanceof Error &&
      ["scope_changed", "authentication_required", "provider_unavailable", "response_invalid"].includes(error.message)
      ? error.message : "capture_unconfirmed";
    const held = await ports.rpc("learn_quickbooks_daily_report_finish", { p_run: c.runId, p_code: code });
    if (held.error || !object(held.data) || held.data.state !== "held") throw Error("outcome_unconfirmed");
    return { checked: 1, state: "held" };
  }
}
