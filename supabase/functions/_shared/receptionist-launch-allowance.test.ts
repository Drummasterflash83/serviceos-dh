import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../../migrations/20261028161000_receptionist_launch_test_allowance.sql", import.meta.url), "utf8");
const endpoint = readFileSync(new URL("../receptionist-testing/index.ts", import.meta.url), "utf8");
test("allowance is private, fixed to two, Chris, DH candidate and 2 October London only", () => {
  for (const text of ["check(max_runs=2)", "cardinality(used_run_ids)<=2", "chris@openfolk.ai", "dcfc2e66-a438-43ab-b863-467f5a5089df", "2026-10-01T23:00:00Z", "2026-10-02T23:00:00Z", "care_release_actor(p_actor)", "now()>=a.ends_at"])
    assert.ok(sql.includes(text), text);
  assert.match(sql, /revoke all on public.receptionist_test_launch_allowances from public,anon,authenticated/);
  assert.match(sql, /revoke all on function public.receptionist_test_reserve_launch\(uuid,uuid,text\) from public,anon,authenticated/);
  assert.doesNotMatch(sql, /create (or replace )?function public.receptionist_test_reserve\(/);
});
test("special reservation shares the normal lock, concurrency, cooldown and records each consumed slot", () => {
  for (const text of ["receptionist_test_settings where tenant_id=p_tenant for update", "('preparing','running','uncertain')", "interval '2 minutes'", "interval '24 hours')<8", "return public.receptionist_test_reserve", "cardinality(a.used_run_ids)>=a.max_runs", "array_append(used_run_ids,n)"])
    assert.ok(sql.includes(text), text);
  assert.match(endpoint, /body.useLaunchAllowance === true && \(!service \|\| scheduled\)/);
  assert.match(endpoint, /body.useLaunchAllowance === true \? "receptionist_test_reserve_launch" : "receptionist_test_reserve"/);
  assert.match(endpoint, /normalRunsPerRolling24Hours: 8/);
  assert.match(endpoint, /remainingExtraRuns: Math.max\(0, grant.max_runs - list\(grant.used_run_ids\).length\)/);
});
