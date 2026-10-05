import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("private number is fetched, never compiled into the browser component", () => {
  const source = read("src/components/app/BuildInvestment.tsx");
  assert.match(source, /rpc\("openfolk_build_investment"\)/);
  assert.doesNotMatch(source, /320|240|400/);
  assert.match(source, /Estimated build time/);
  assert.match(source, /not\s+tracked or billable hours/);
  assert.match(source, /does not automatically count upwards/);
  assert.match(source, /Entire platform investment, not hours charged/);
});
test("customer shell does not include the operator-only estimate", () => {
  assert.doesNotMatch(read("src/components/client-portal/ClientPortal.tsx"), /BuildInvestment|openfolk_build_investment/);
  assert.match(read("src/routes/openfolk.index.tsx"), /<BuildInvestment/);
  assert.match(read("src/components/app/OperatorModules.tsx"), /<BuildInvestment/);
});
test("snapshot labels its assumptions, confidence and cut-off", () => {
  const sql = read("supabase/migrations/20261023190000_serviceos_build_investment.sql");
  assert.match(sql, /coalesce\(public.care_desk_operator\(\), false\)/);
  assert.match(sql, /revoke all.*from public, anon/);
  assert.match(sql, /'confidence', 'Low'/);
  assert.match(sql, /'asOf', '2026-09-29'/);
  assert.match(sql, /judgement, not measured time/);
});
