import assert from "node:assert/strict";
import test from "node:test";
import { readReportCaptureReceipt } from "./learn-quickbooks-report-capture.ts";
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
