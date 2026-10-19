import assert from "node:assert/strict";
import test from "node:test";
import { reportUrl, runReportCapture, validateReportCaptureRequest } from "./report_capture.ts";
const tenantId = "00000000-0000-0000-0000-000000000001";
const connectionId = "00000000-0000-0000-0000-000000000002";
const requestId = "00000000-0000-0000-0000-000000000003";
const auditId = "00000000-0000-0000-0000-000000000004";
const profit = { tenantId, connectionId, requestId, realmId: "123", environment: "production" as const,
  kind: "ProfitAndLoss" as const,
  periodStart: "2026-09-01", periodEnd: "2026-09-30", accountingMethod: "Accrual" as const,
  reportDate: null, agingMethod: null, reason: "Bounded accounts report evidence" };
const aging = { ...profit, kind: "AgedReceivables" as const, periodStart: null, periodEnd: null,
  accountingMethod: null, reportDate: "2026-10-19", agingMethod: "Report_Date" as const };
const claim = (request: typeof profit | typeof aging) => ({ ...request, accessToken: "secret",
  kind: request.kind, periodStart: request.periodStart, periodEnd: request.periodEnd,
  accountingMethod: request.accountingMethod, reportDate: request.reportDate, agingMethod: request.agingMethod });
const finish = (kind: string) => ({ version: "quickbooks-report-capture/1", request_id: requestId, tenant_id: tenantId,
  realm_id: "123", environment: "production", kind, response_sha256: "a".repeat(64), response_bytes: 200,
  report_time: "2026-10-19T10:00:00Z", currency: "GBP", audit_id: auditId,
  validation_state: "verified", validation_code: null });

test("accepts only exact, bounded report parameters", () => {
  assert.equal(validateReportCaptureRequest(profit), true);
  assert.equal(validateReportCaptureRequest(aging), true);
  for (const changed of [{ reportDate: "2026-10-19" }, { periodEnd: "2026-09-31" },
    { accountingMethod: "Default" }, { extra: "arbitrary" }, { reason: " " }])
    assert.equal(validateReportCaptureRequest({ ...profit, ...changed }), false);
  assert.equal(validateReportCaptureRequest({ ...aging, agingMethod: "Current" }), false);
});
test("denied actor never acquires credentials or calls provider", async () => {
  let serviceCalls = 0, fetches = 0;
  await assert.rejects(runReportCapture(profit, {
    userRpc: async () => ({ data: null, error: { code: "42501" } }),
    serviceRpc: async () => { serviceCalls++; return { data: null, error: null }; },
    fetcher: async () => { fetches++; return new Response(); },
  }), /scope_denied/);
  assert.equal(serviceCalls, 0); assert.equal(fetches, 0);
});
test("one report request uses only the bound GET URL and retains raw decimal JSON", async () => {
  for (const request of [profit, aging]) {
    const raws: string[] = []; let fetches = 0;
    const expected = request.kind === "ProfitAndLoss"
      ? "https://quickbooks.api.intuit.com/v3/company/123/reports/ProfitAndLoss?start_date=2026-09-01&end_date=2026-09-30&accounting_method=Accrual"
      : "https://quickbooks.api.intuit.com/v3/company/123/reports/AgedReceivables?report_date=2026-10-19&aging_method=Report_Date";
    assert.equal(reportUrl(claim(request)), expected);
    const raw = `{"Header":{"ReportName":"${request.kind}"},"Rows":{"Row":[{"ColData":[{"value":12345678901234567890.01}]}]}}`;
    const result = await runReportCapture(request, {
      userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
      serviceRpc: async (name, args) => {
        if (name.endsWith("_acquire")) return { data: claim(request), error: null };
        if (name.endsWith("_current")) return { data: true, error: null };
        if (name.endsWith("_finish")) { raws.push(args.p_raw as string); return { data: finish(request.kind), error: null }; }
        throw Error("unexpected RPC");
      },
      fetcher: async (url, init) => {
        fetches++; assert.equal(String(url), expected); assert.equal(init?.method, "GET");
        return new Response(raw, { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.deepEqual(result, finish(request.kind)); assert.equal(fetches, 1);
    assert.equal(raws.length, 1); assert.match(raws[0], /12345678901234567890\.01/);
  }
});
test("changed scope stops before provider call", async () => {
  for (const changed of [{ tenantId: connectionId }, { realmId: "456" }, { periodEnd: "2026-08-31" }]) {
    let fetches = 0;
    await assert.rejects(runReportCapture(profit, {
      userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
      serviceRpc: async (name) => name.endsWith("_acquire")
        ? { data: { ...claim(profit), ...changed }, error: null }
        : { data: true, error: null },
      fetcher: async () => { fetches++; return new Response(); },
    }), /claim_unavailable/);
    assert.equal(fetches, 0);
  }
});
test("provider failure records one bounded failure and no finish", async () => {
  const calls: string[] = [];
  await assert.rejects(runReportCapture(profit, {
    userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
    serviceRpc: async (name) => { calls.push(name);
      if (name.endsWith("_acquire")) return { data: claim(profit), error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      return { data: null, error: null }; },
    fetcher: async () => new Response("", { status: 503 }),
  }), /provider_unavailable/);
  assert.equal(calls.filter(n => n.endsWith("_fail")).length, 1);
  assert.equal(calls.filter(n => n.endsWith("_finish")).length, 0);
});
test("oversize report is not sent to SQL or retried", async () => {
  const calls: string[] = []; let fetches = 0;
  await assert.rejects(runReportCapture(profit, {
    userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
    serviceRpc: async name => { calls.push(name);
      if (name.endsWith("_acquire")) return { data: claim(profit), error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      return { data: null, error: null }; },
    fetcher: async () => { fetches++; return new Response("x".repeat(2097153),
      { status: 200, headers: { "content-type": "application/json" } }); },
  }), /response_too_large/);
  assert.equal(fetches, 1); assert.equal(calls.filter(n => n.endsWith("_finish")).length, 0);
  assert.equal(calls.filter(n => n.endsWith("_fail")).length, 1);
});
test("mismatched report header is retained as held evidence without showing values", async () => {
  const raw = '{"Header":{"ReportName":"BalanceSheet"},"Rows":{"Row":[]}}';
  let captured = "";
  const outcome = await runReportCapture(profit, {
    userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
    serviceRpc: async (name, args) => {
      if (name.endsWith("_acquire")) return { data: claim(profit), error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      if (name.endsWith("_finish")) { captured = args.p_raw as string;
        return { data: { ...finish(profit.kind), validation_state: "held", validation_code: "report_name_mismatch" }, error: null }; }
      throw Error("unexpected RPC");
    },
    fetcher: async () => new Response(raw, { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(captured, raw);
  assert.equal((outcome as { validation_state: string }).validation_state, "held");
  assert.equal(JSON.stringify(outcome).includes("BalanceSheet"), false);
});
