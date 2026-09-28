import { test } from "node:test";
import assert from "node:assert/strict";
import { costHealth, costMoney, type CostAccount } from "./operating-costs.ts";
const now = Date.parse("2026-09-28T12:00:00Z");
const base: CostAccount = {
  id: "a",
  provider: "vapi",
  name: "Vapi",
  account_ref: "org",
  currency: "USD",
  billing_mode: "prepaid",
  low_balance: 20,
  stale_hours: 24,
  version: 1,
  clients: [],
  latest: {
    observed_at: new Date(now).toISOString(),
    balance: 100,
    period_spend: null,
    period_start: null,
    period_end: null,
    auto_reload: "off",
    payment_status: "okay",
    source: "dashboard",
    evidence: "Checked billing",
  },
};
test("no observation is not healthy", () =>
  assert.equal(costHealth({ ...base, latest: null }, now).tone, "waiting"));
test("fresh funded balance reports a bounded claim", () =>
  assert.equal(costHealth(base, now).label, "No funding issue recorded"));
test("stale and future checks need verification", () => {
  for (const t of [now - 25 * 3600000, now + 1])
    assert.equal(
      costHealth(
        { ...base, latest: { ...base.latest!, observed_at: new Date(t).toISOString() } },
        now,
      ).tone,
      "waiting",
    );
});
test("zero and negative balances are urgent even with auto reload on", () => {
  for (const balance of [0, -1])
    assert.equal(
      costHealth({ ...base, latest: { ...base.latest!, balance, auto_reload: "on" } }, now).label,
      "No credit at last check",
    );
});
test("threshold is inclusive", () =>
  assert.equal(
    costHealth({ ...base, latest: { ...base.latest!, balance: 20 } }, now).label,
    "Credit running low",
  ));
test("staleness cannot hide an observed payment failure", () =>
  assert.equal(
    costHealth(
      { ...base, latest: { ...base.latest!, payment_status: "failed", observed_at: "2020-01-01" } },
      now,
    ).tone,
    "urgent",
  ));
test("unknown and zero spend remain distinct", () => {
  assert.equal(costMoney(null, "USD"), "Awaiting data");
  assert.equal(costMoney(0, "USD"), "US$0.00");
});
test("missing funding data is not healthy", () => {
  for (const latest of [
    { ...base.latest!, balance: null },
    { ...base.latest!, payment_status: "unknown" as const },
  ])
    assert.equal(costHealth({ ...base, latest }, now).tone, "waiting");
});
test("invoiced accounts do not require prepaid balance", () =>
  assert.equal(
    costHealth(
      { ...base, billing_mode: "invoiced", latest: { ...base.latest!, balance: null } },
      now,
    ).tone,
    "clear",
  ));
