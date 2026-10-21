import assert from "node:assert/strict";
import test from "node:test";
import { runDailyQuickBooksReports } from "./daily_reports.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const connectionId = "00000000-0000-0000-0000-000000000002";
const runId = "00000000-0000-0000-0000-000000000003";
const pnlRequestId = "00000000-0000-0000-0000-000000000004";
const arRequestId = "00000000-0000-0000-0000-000000000005";
const auditId = "00000000-0000-0000-0000-000000000006";
const claim = { runId, tenantId, connectionId, reportDate: "2026-10-20",
  periodStart: "2026-04-01", realmId: "123", environment: "production" };
const prep = { ...claim, pnlRequestId, arRequestId, reason: "Approved daily FY27 reports" };
const answer = (data: unknown) => ({ data, error: null });

test("no due standing policy makes no refresh or provider request", async () => {
  const calls: string[] = [];
  const result = await runDailyQuickBooksReports({
    rpc: async name => { calls.push(name); return answer(null); },
    fetcher: async () => { throw Error("provider_called"); },
  });
  assert.deepEqual(result, { checked: 0, state: "not_due" });
  assert.deepEqual(calls, ["learn_quickbooks_daily_report_claim"]);
});

test("revoked standing authority stops before credential acquisition", async () => {
  const calls: string[] = [];
  const result = await runDailyQuickBooksReports({
    rpc: async name => { calls.push(name);
      if (name.endsWith("_claim")) return answer(claim);
      if (name.endsWith("_current")) return answer(false);
      if (name.endsWith("_finish")) return answer({ state: "held" });
      throw Error("unexpected_rpc"); },
    fetcher: async () => { throw Error("provider_called"); },
  });
  assert.deepEqual(result, { checked: 1, state: "held" });
  assert.equal(calls.some(x => x.includes("refresh")), false);
});

test("withdrawn authority after refresh lease stops before token exchange", async () => {
  let checks = 0, fetches = 0;
  const result = await runDailyQuickBooksReports({
    rpc: async name => {
      if (name.endsWith("_claim")) return answer(claim);
      if (name.endsWith("_current")) return answer(++checks === 1);
      if (name === "learn_quickbooks_daily_refresh_acquire") return answer({
        state: "ready", leaseId: auditId,
        leaseUntil: new Date(Date.now() + 120000).toISOString(),
        revision: 4, generation: 2, clientId: "synthetic-client",
        clientSecret: "synthetic-secret", refreshToken: "synthetic-old",
      });
      if (name === "learn_quickbooks_daily_report_finish") return answer({ state: "held" });
      throw Error(`unexpected_rpc:${name}`);
    },
    fetcher: async () => { fetches++; throw Error("provider_called"); },
  });
  assert.deepEqual(result, { checked: 1, state: "held" });
  assert.equal(fetches, 0);
});

test("current credential captures exactly two scoped GETs and closes one verified pair", async () => {
  const calls: string[] = [], urls: string[] = [];
  const result = await runDailyQuickBooksReports({
    rpc: async (name, args) => {
      calls.push(name);
      if (name.endsWith("_claim")) return answer(claim);
      if (name.endsWith("_current")) return answer(true);
      if (name === "learn_quickbooks_daily_refresh_acquire") return answer({ state: "current" });
      if (name.endsWith("_prepare")) return answer(prep);
      if (name === "learn_quickbooks_report_acquire") {
        const pnl = args.p_request === pnlRequestId;
        return answer({ requestId: args.p_request, tenantId, connectionId, realmId: "123",
          environment: "production", accessToken: "synthetic-token", kind: pnl ? "ProfitAndLoss" : "AgedReceivables",
          periodStart: pnl ? "2026-04-01" : null, periodEnd: pnl ? "2026-10-20" : null,
          accountingMethod: pnl ? "Accrual" : null, reportDate: pnl ? null : "2026-10-20",
          agingMethod: pnl ? null : "Report_Date" });
      }
      if (name === "learn_quickbooks_report_finish") {
        assert.equal(typeof args.p_raw, "string");
        return answer({ request_id: args.p_request, tenant_id: tenantId,
          kind: args.p_request === pnlRequestId ? "ProfitAndLoss" : "AgedReceivables",
          response_sha256: "a".repeat(64), audit_id: auditId,
          validation_state: "verified", validation_code: null });
      }
      if (name === "learn_quickbooks_daily_report_finish") return answer({ state: "complete" });
      throw Error(`unexpected_rpc:${name}`);
    },
    fetcher: async (url, init) => {
      urls.push(String(url)); assert.equal(init?.method, "GET");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-token");
      const kind = String(url).includes("/ProfitAndLoss?") ? "ProfitAndLoss" : "AgedReceivables";
      return new Response(JSON.stringify({ Header: { ReportName: kind }, Rows: { Row: [] } }),
        { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(result, { checked: 1, state: "complete" });
  assert.deepEqual(urls, [
    "https://quickbooks.api.intuit.com/v3/company/123/reports/ProfitAndLoss?start_date=2026-04-01&end_date=2026-10-20&accounting_method=Accrual",
    "https://quickbooks.api.intuit.com/v3/company/123/reports/AgedReceivables?report_date=2026-10-20&aging_method=Report_Date",
  ]);
  assert.equal(calls.includes("learn_quickbooks_report_start"), false);
  assert.equal(calls.filter(x => x === "learn_quickbooks_report_acquire").length, 2);
});

test("failed first report is held, never retried and never asks for A/R", async () => {
  let fetches = 0, held = false;
  const result = await runDailyQuickBooksReports({
    rpc: async (name, args) => {
      if (name.endsWith("_claim")) return answer(claim);
      if (name.endsWith("_current")) return answer(true);
      if (name === "learn_quickbooks_daily_refresh_acquire") return answer({ state: "current" });
      if (name.endsWith("_prepare")) return answer(prep);
      if (name === "learn_quickbooks_report_acquire") return answer({ requestId: args.p_request,
        tenantId, connectionId, realmId: "123", environment: "production", accessToken: "synthetic-token",
        kind: "ProfitAndLoss", periodStart: "2026-04-01", periodEnd: "2026-10-20",
        accountingMethod: "Accrual", reportDate: null, agingMethod: null });
      if (name === "learn_quickbooks_report_fail") return answer(null);
      if (name === "learn_quickbooks_daily_report_finish") {
        assert.equal(args.p_code, "provider_unavailable"); held = true; return answer({ state: "held" });
      }
      throw Error(`unexpected_rpc:${name}`);
    },
    fetcher: async () => { fetches++; return new Response("", { status: 503 }); },
  });
  assert.deepEqual(result, { checked: 1, state: "held" });
  assert.equal(fetches, 1); assert.equal(held, true);
});

test("policy revoked after first receipt prevents the second provider GET", async () => {
  let revoked = false; const urls: string[] = [];
  const result = await runDailyQuickBooksReports({
    rpc: async (name, args) => {
      if (name.endsWith("_claim")) return answer(claim);
      if (name === "learn_quickbooks_daily_report_current" || name === "learn_quickbooks_report_current")
        return answer(!revoked);
      if (name === "learn_quickbooks_daily_refresh_acquire") return answer({ state: "current" });
      if (name.endsWith("_prepare")) return answer(prep);
      if (name === "learn_quickbooks_report_acquire") return answer({ requestId: args.p_request,
        tenantId, connectionId, realmId: "123", environment: "production", accessToken: "synthetic-token",
        kind: "ProfitAndLoss", periodStart: "2026-04-01", periodEnd: "2026-10-20",
        accountingMethod: "Accrual", reportDate: null, agingMethod: null });
      if (name === "learn_quickbooks_report_finish") {
        revoked = true;
        return answer({ request_id: pnlRequestId, tenant_id: tenantId, kind: "ProfitAndLoss",
          response_sha256: "a".repeat(64), audit_id: auditId,
          validation_state: "verified", validation_code: null });
      }
      if (name === "learn_quickbooks_daily_report_finish") {
        assert.equal(args.p_code, "scope_changed"); return answer({ state: "held" });
      }
      throw Error(`unexpected_rpc:${name}`);
    },
    fetcher: async url => { urls.push(String(url)); return new Response(
      JSON.stringify({ Header: { ReportName: "ProfitAndLoss" }, Rows: { Row: [] } }),
      { status: 200, headers: { "content-type": "application/json" } }); },
  });
  assert.deepEqual(result, { checked: 1, state: "held" });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/ProfitAndLoss\?/);
});
