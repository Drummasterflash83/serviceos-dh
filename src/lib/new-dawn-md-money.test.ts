import assert from "node:assert/strict";
import test from "node:test";
import { accountsNetMargin, newestAccountsPair, netProfitYtdComparison } from "./new-dawn-md-money.ts";
import type { AccountsPair } from "./new-dawn-founder-accounts-preview.ts";

const pair = (periodStart: string, periodEnd: string, received: string): AccountsPair => ({
  profitRequest: "00000000-0000-0000-0000-000000000001",
  receivablesRequest: "00000000-0000-0000-0000-000000000002",
  periodStart, periodEnd, accountingMethod: "Accrual", arAsOf: periodEnd,
  currency: "GBP", realmId: "123456", profitReceivedAt: received,
  receivablesReceivedAt: received, profitSha256: "a".repeat(64),
  receivablesSha256: "b".repeat(64),
});

test("MD picks the newest accounting period even if an older report was re-read later", () => {
  const september = pair("2026-09-01", "2026-09-30", "2026-10-20T09:00:00Z");
  const october = pair("2026-10-01", "2026-10-18", "2026-10-19T09:00:00Z");
  assert.equal(newestAccountsPair([september, october]), october);
  assert.equal(newestAccountsPair([]), null);
});

test("partial-period net profit remains uncomparable with a YTD target", () => {
  assert.equal(netProfitYtdComparison("2026-10-01", "2026-10-18").status, "held");
});

test("MD net margin uses same-report income and handles negative profit", () => {
  assert.equal(accountsNetMargin("122000", "1035000"), "11.79");
  assert.equal(accountsNetMargin("-75.00", "1000.00"), "-7.50");
  assert.equal(accountsNetMargin("50", "0"), null);
  assert.equal(accountsNetMargin("50", "-100"), null);
  assert.equal(accountsNetMargin("not a number", "100"), null);
});
