import assert from "node:assert/strict";
import test from "node:test";
import { buildReportCaptureBody, readReportCaptureReceipt, reportCaptureConnectionReady } from "./learn-quickbooks-report-capture.ts";
import type { QuickBooksConnection } from "./learn-quickbooks.ts";
import { validateReportCaptureRequest } from "../../supabase/functions/_shared/quickbooks/report_capture.ts";
const scope = { requestId: "00000000-0000-0000-0000-000000000001", tenantId: "00000000-0000-0000-0000-000000000002",
  realmId: "123", environment: "production" as const, kind: "ProfitAndLoss" as const };
const receipt = { version: "quickbooks-report-capture/1", request_id: scope.requestId, tenant_id: scope.tenantId,
  realm_id: scope.realmId, environment: scope.environment, kind: scope.kind, response_sha256: "a".repeat(64),
  response_bytes: 200, report_time: "2026-10-19T10:00:00Z", currency: "GBP",
  audit_id: "00000000-0000-0000-0000-000000000003", validation_state: "verified", validation_code: null };
test("operator receipt exposes only bound source metadata", () => {
  const read = readReportCaptureReceipt(receipt, scope);
  assert.equal(read.kind, "ProfitAndLoss"); assert.equal(read.sha256, "a".repeat(64));
  assert.equal("raw_response" in read, false);
  assert.equal(read.validationState, "verified");
  assert.equal(readReportCaptureReceipt({ ...receipt, validation_state:"held", validation_code:"scope_mismatch" }, scope).validationState, "held");
  for (const change of [{ tenant_id: scope.requestId }, { realm_id: "456" }, { kind: "AgedReceivables" },
    { response_sha256: "invalid" }, { response_bytes: 2097153 }])
    assert.throws(() => readReportCaptureReceipt({ ...receipt, ...change }, scope));
});
test("operator UI body satisfies the exact Edge request contract for both reports", () => {
  const common = { tenantId:scope.tenantId, connectionId:"00000000-0000-0000-0000-000000000004",
    requestId:scope.requestId, realmId:scope.realmId, environment:scope.environment,
    periodStart:"2026-09-01", periodEnd:"2026-09-30", accountingMethod:"Accrual" as const,
    reportDate:"2026-10-19", reason:"Operator report evidence" };
  const profit = buildReportCaptureBody({ ...common, kind:"ProfitAndLoss" });
  const aging = buildReportCaptureBody({ ...common, kind:"AgedReceivables" });
  assert.equal(validateReportCaptureRequest(profit), true);
  assert.equal(validateReportCaptureRequest(aging), true);
  assert.equal(Object.keys(profit).sort().join(","),
    "accountingMethod,agingMethod,connectionId,environment,kind,periodEnd,periodStart,realmId,reason,reportDate,requestId,tenantId");
});
test("report capture waits for a valid access token rather than opening an unclaimable request", () => {
  const now = Date.parse("2026-10-19T20:42:00Z");
  const connection: QuickBooksConnection = {
    id: "00000000-0000-0000-0000-000000000004", appId: "00000000-0000-0000-0000-000000000005",
    environment: "production", realmId: "123", companyName: "Test company", status: "paused",
    revision: 1, verifiedAt: null, confirmedAt: "2026-10-19T10:00:00Z",
    accessExpiresAt: "2026-10-19T20:45:00Z", refreshExpiresAt: "2026-11-01T00:00:00Z",
    refreshInProgress: false,
  };
  assert.equal(reportCaptureConnectionReady(connection, now), true);
  assert.equal(reportCaptureConnectionReady({ ...connection, accessExpiresAt: "2026-10-19T20:44:00Z" }, now), false);
  assert.equal(reportCaptureConnectionReady({ ...connection, accessExpiresAt: "2026-10-19T16:39:04Z" }, now), false);
  assert.equal(reportCaptureConnectionReady({ ...connection, accessExpiresAt: null }, now), false);
  assert.equal(reportCaptureConnectionReady({ ...connection, status: "authentication_required" }, now), false);
});
