import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { usageRows } from "./provider-usage.ts";
import { normalizeCall } from "./receptionist-data.ts";
const call = (id: string, date: string, cost?: number) =>
  normalizeCall({ id, startedAt: date, createdAt: date, endedAt: date, cost });
test("daily costs are USD call values, deduplicated across pages", () => {
  const a = call("a", "2026-09-29T12:00:00Z", 0.12);
  const { rows } = usageRows([a, a, call("b", "2026-09-29T13:00:00Z", 0.25)], "day");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calls, 2);
  assert.equal(rows[0].cost, 0.37);
});
test("missing and invalid cost remain missing, while zero is a measured value", () => {
  const { rows } = usageRows(
    [
      call("a", "2026-09-29", 0),
      call("b", "2026-09-29"),
      call("c", "2026-09-29", -1),
      call("d", "2026-09-29", Infinity),
    ],
    "day",
  );
  assert.equal(rows[0].priced, 1);
  assert.equal(rows[0].cost, 0);
  assert.equal(rows[0].calls, 4);
});
test("weekly groups start Monday in UTC across year boundaries", () => {
  const { rows } = usageRows(
    [call("a", "2027-01-03T23:59:00Z", 1), call("b", "2027-01-04T00:00:00Z", 2)],
    "week",
  );
  assert.deepEqual(
    rows.map((r) => r.date),
    ["2027-01-04", "2026-12-28"],
  );
});
test("monthly groups are ordered newest first", () => {
  assert.deepEqual(
    usageRows([call("a", "2026-08-31", 1), call("b", "2026-09-29", 2)], "month").rows.map(
      (r) => r.date,
    ),
    ["2026-09-01", "2026-08-01"],
  );
});
test("undated calls are disclosed and never assigned to today", () => {
  const result = usageRows([call("a", "bad", 5)], "day");
  assert.equal(result.undated, 1);
  assert.deepEqual(result.rows, []);
});
test("duration coverage preserves missing evidence", () => {
  const a = call("a", "2026-09-29", 1);
  a.duration = null;
  const b = call("b", "2026-09-29", 1);
  b.duration = 120;
  assert.equal(usageRows([a, b], "day").rows[0].timed, 1);
  assert.equal(usageRows([a, b], "day").rows[0].seconds, 120);
});
test("billing surface uses existing authorised feeds without undeployed cost RPCs", () => {
  const source = readFileSync(new URL("../routes/openfolk.apis.tsx", import.meta.url), "utf8");
  assert.match(source, /listTenantDirectory/);
  assert.match(source, /directory.isSuccess && !directory.isError/);
  assert.match(source, /useReceptionistCalls\(userId, tenant\)/);
  assert.match(source, /key=\{tenant.tenant_id\}/);
  assert.match(source, /Partial history/);
  assert.match(source, /Load older calls/);
  assert.match(source, /https:\/\/dashboard.vapi.ai\/settings\/billing/);
  assert.doesNotMatch(
    source,
    /costs_overview|costs_record_check|8\.26|service_role|OPENAI_API_KEY/,
  );
});
