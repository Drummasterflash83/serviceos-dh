import assert from "node:assert/strict";
import test from "node:test";
import { accountsNetMargin, agedReceivablesBucketKind, fy27LastCompletedUkDate,
  moneyReportFreshness, newestAccountsPair, netProfitYtdComparison } from "./new-dawn-md-money.ts";
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
  const partial = netProfitYtdComparison("2026-10-01", "2026-10-18");
  assert.equal(partial.status, "held");
  assert.match(partial.reason, /not the full period/);
  const full = netProfitYtdComparison("2026-04-01", "2026-10-19");
  assert.equal(full.status, "held");
  assert.match(full.reason, /current target and its phasing/);
});

test("FY27 scope uses the last completed UK day across a clock change", () => {
  assert.equal(fy27LastCompletedUkDate(new Date("2026-10-20T08:00:00Z")), "2026-10-19");
  assert.equal(fy27LastCompletedUkDate(new Date("2026-10-24T23:30:00Z")), "2026-10-24");
  assert.equal(fy27LastCompletedUkDate(new Date("2026-10-26T00:30:00Z")), "2026-10-25");
  assert.equal(fy27LastCompletedUkDate(new Date("2026-04-01T08:00:00Z")), null);
});

test("MD money labels saved coverage without claiming a scheduled report ran", () => {
  const now = new Date("2026-10-21T08:30:00Z");
  assert.equal(moneyReportFreshness("2026-10-19", "2026-10-19", now).state, "older");
  assert.match(moneyReportFreshness("2026-10-19", "2026-10-19", now).message,
    /More recent company accounts have not been verified/);
  assert.equal(moneyReportFreshness("2026-10-20", "2026-10-20", now).state, "current");
  assert.equal(moneyReportFreshness("2026-10-21", "2026-10-21", now).state, "partial");
  assert.equal(moneyReportFreshness("2026-10-20", "2026-10-19", now).state, "unverified");
  assert.equal(moneyReportFreshness("2026-02-30", "2026-02-30", now).state, "unverified");
});

test("MD net margin uses same-report income and handles negative profit", () => {
  assert.equal(accountsNetMargin("122000", "1035000"), "11.79");
  assert.equal(accountsNetMargin("-75.00", "1000.00"), "-7.50");
  assert.equal(accountsNetMargin("50", "0"), null);
  assert.equal(accountsNetMargin("50", "-100"), null);
  assert.equal(accountsNetMargin("not a number", "100"), null);
});

test("91+ net credits are never classified as overdue debt", () => {
  assert.equal(agedReceivablesBucketKind("-5.25"), "credit");
  assert.equal(agedReceivablesBucketKind("-0.00"), "zero");
  assert.equal(agedReceivablesBucketKind("0.00"), "zero");
  assert.equal(agedReceivablesBucketKind("10.01"), "positive");
  assert.equal(agedReceivablesBucketKind("unverified"), "unknown");
});
