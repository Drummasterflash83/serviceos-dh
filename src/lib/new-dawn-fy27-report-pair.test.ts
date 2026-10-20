import assert from "node:assert/strict";
import test from "node:test";
import { approvedFy27PairBodies, approvedFy27RefreshBody, DRUMMONDS_FY27_PAIR } from "./new-dawn-fy27-report-pair.ts";
import type { QuickBooksConnection } from "./learn-quickbooks";

const connection: QuickBooksConnection = {
  id: DRUMMONDS_FY27_PAIR.connectionId, appId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  environment: "production", realmId: DRUMMONDS_FY27_PAIR.realmId,
  companyName: "Drummond Heating", status: "active", revision: 1,
  verifiedAt: "2026-10-20T15:00:00Z", confirmedAt: "2026-10-14T06:59:27Z",
  accessExpiresAt: "2026-10-20T16:40:00Z", refreshExpiresAt: "2027-01-29T00:00:00Z",
  refreshInProgress: false,
};
const ids = { profit: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  receivables: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };

test("approved refresh is bound to the one production company even when access expired", () => {
  const body = approvedFy27RefreshBody({ ...connection, accessExpiresAt: "2026-10-20T14:00:00Z" },
    "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", Date.parse("2026-10-20T17:00:00Z"));
  assert.deepEqual(body, {
    tenantId: DRUMMONDS_FY27_PAIR.tenantId, connectionId: connection.id,
    requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", realmId: DRUMMONDS_FY27_PAIR.realmId,
    environment: "production", reason: DRUMMONDS_FY27_PAIR.reason,
  });
});

test("refresh refuses an unconfirmed, wrong, busy or expired authorization", () => {
  const now = Date.parse("2026-10-20T17:00:00Z");
  for (const invalid of [
    { ...connection, confirmedAt: null },
    { ...connection, environment: "sandbox" as const },
    { ...connection, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { ...connection, realmId: "12345" },
    { ...connection, refreshInProgress: true },
    { ...connection, refreshExpiresAt: "2026-10-20T16:00:00Z" },
  ]) assert.throws(() => approvedFy27RefreshBody(invalid, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", now));
});

test("approved pair fixes the exact production realm, accrual period, A/R date and reason", () => {
  const [profit, receivables] = approvedFy27PairBodies(connection, ids, Date.parse("2026-10-20T15:30:00Z"));
  assert.deepEqual([profit.kind, profit.periodStart, profit.periodEnd, profit.accountingMethod,
    profit.reportDate, profit.environment, profit.realmId],
    ["ProfitAndLoss", "2026-04-01", "2026-10-19", "Accrual", null, "production", "1197397945"]);
  assert.deepEqual([receivables.kind, receivables.periodStart, receivables.periodEnd,
    receivables.accountingMethod, receivables.reportDate, receivables.agingMethod],
    ["AgedReceivables", null, null, null, "2026-10-19", "Report_Date"]);
  assert.equal(profit.reason, DRUMMONDS_FY27_PAIR.reason);
  assert.equal(receivables.reason, DRUMMONDS_FY27_PAIR.reason);
  assert.notEqual(profit.requestId, receivables.requestId);
});

test("unconfirmed, sandbox, wrong realm or near-expired access cannot form the pair", () => {
  const now = Date.parse("2026-10-20T15:30:00Z");
  for (const invalid of [
    { ...connection, confirmedAt: null },
    { ...connection, environment: "sandbox" as const },
    { ...connection, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { ...connection, realmId: "12345" },
    { ...connection, accessExpiresAt: "2026-10-20T15:31:00Z" },
  ]) assert.throws(() => approvedFy27PairBodies(invalid, ids, now));
  assert.throws(() => approvedFy27PairBodies(connection,
    { profit: ids.profit, receivables: ids.profit }, now));
});
