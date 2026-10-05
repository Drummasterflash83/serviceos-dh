import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../../migrations/20261028171000_emma_one_approved_retest.sql", import.meta.url), "utf8");
const original = readFileSync(new URL("../../migrations/20261028161000_receptionist_launch_test_allowance.sql", import.meta.url), "utf8");
const normal = readFileSync(new URL("../../migrations/20261023200000_receptionist_testing.sql", import.meta.url), "utf8");
const endpoint = readFileSync(new URL("../receptionist-testing/index.ts", import.meta.url), "utf8");
const tenant = "00000000-0000-0000-0000-000000000001";
const candidate = "dcfc2e66-a438-43ab-b863-467f5a5089df";
const start = "2026-10-01T23:00:00Z", end = "2026-10-02T23:00:00Z";

test("approval is an append-only exact2→3 grant, not a reset or a new general allowance", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration.trim(), /commit;$/);
  for (const required of [
    "max_runs=2 or (", "max_runs=3", `tenant_id='${tenant}'`, `assistant_id='${candidate}'`,
    `starts_at='${start}' and ends_at='${end}'`, "cardinality(used_run_ids)<=max_runs",
    "additional_approval_at is not null and additional_approval_reason is not null",
    "a.max_runs<>2 or cardinality(a.used_run_ids)<>2", "a.additional_approval_at is not null",
    "where tenant_id=a.tenant_id and max_runs=2 and used_run_ids=a.used_run_ids",
  ]) assert.ok(migration.includes(required), required);
  const update = migration.match(/update public\.receptionist_test_launch_allowances set([\s\S]*?)\n\s*where /)![1];
  const assigned = [...update.matchAll(/(?:^|,)\s*([a-z_]+)\s*=/g)].map(match => match[1]);
  assert.deepEqual(assigned, ["max_runs", "additional_approval_at", "additional_approval_reason"]);
  assert.match(update, /max_runs=3, additional_approval_at=now\(\)/);
  assert.doesNotMatch(update, /used_run_ids\s*=|actor_id\s*=|assistant_id\s*=|starts_at\s*=|ends_at\s*=|created_at\s*=/);
  assert.doesNotMatch(migration, /\b(?:delete|truncate)\b|(?:update|insert into)\s+public\.receptionist_test_runs\b/i);
  assert.doesNotMatch(migration, /insert into public\.receptionist_test_launch_allowances|on conflict/i);
  assert.match(original, /check\(max_runs=2\)/, "Historical migration retains the original two-slot approval");
  assert.match(original, /check\(cardinality\(used_run_ids\)<=2\)/);
});

test("the dated grant locks the original Chris/DH/candidate binding and fails unexpected state", () => {
  for (const required of [
    "select id into strict chris", "lower(email)='chris@openfolk.ai'", "perform public.care_release_actor(chris)",
    `where tenant_id='${tenant}' for update`, "a.actor_id<>chris", `a.assistant_id<>'${candidate}'`,
    `a.starts_at<>'${start}' or a.ends_at<>'${end}'`, "now()<a.starts_at or now()>=a.ends_at",
    "raise exception 'Original two consumed launch slots", "if not found then raise exception 'Allowance changed",
  ]) assert.ok(migration.includes(required), required);
  assert.match(migration, /before_state,after_state,reason/);
  assert.match(migration, /'maximum',a\.max_runs,'usedRunIds',a\.used_run_ids,'expiresAt',a\.ends_at/);
  assert.match(migration, /'maximum',3,'usedRunIds',a\.used_run_ids,'expiresAt',a\.ends_at,'additionalRuns',1/);
});

test("ordinary8-per-rolling24h, active-run lock, cooldown and slot append remain the same SQL function", () => {
  assert.doesNotMatch(migration, /create\s+(?:or replace\s+)?function|drop\s+function/i);
  for (const required of [
    "receptionist_test_settings where tenant_id=p_tenant for update",
    "receptionist_test_launch_allowances where tenant_id=p_tenant for update",
    "('preparing','running','uncertain')", "interval '2 minutes'", "interval '24 hours')<8",
    "return public.receptionist_test_reserve(p_tenant,p_actor,p_hash)",
    "cardinality(a.used_run_ids)>=a.max_runs", "array_append(used_run_ids,n)",
  ]) assert.ok(original.includes(required), required);
  assert.match(normal, /interval '24 hours'\)>=8/);
  assert.ok(original.indexOf("('preparing','running','uncertain')") < original.indexOf("array_append(used_run_ids,n)"));
  assert.ok(original.indexOf("cardinality(a.used_run_ids)>=a.max_runs") < original.indexOf("array_append(used_run_ids,n)"));
  assert.match(endpoint, /normalRunsPerRolling24Hours: 8/);
  assert.match(endpoint, /remainingExtraRuns: Math.max\(0, grant.max_runs - list\(grant.used_run_ids\).length\)/);
  assert.doesNotMatch(endpoint, /dated two-run launch allowance/);
});

test("read-only privilege evidence confirms no browser/table/RPC access is added", () => {
  assert.match(original, /enable row level security/);
  assert.match(original, /revoke all on public.receptionist_test_launch_allowances from public,anon,authenticated/);
  assert.match(original, /revoke all on function public.receptionist_test_reserve_launch\(uuid,uuid,text\) from public,anon,authenticated/);
  assert.match(original, /grant execute on function public.receptionist_test_reserve_launch\(uuid,uuid,text\) to service_role/);
  assert.doesNotMatch(migration, /\bgrant\s+(?:all|select|insert|update|delete|execute)|disable row level security|create policy/i);
  assert.match(endpoint, /body.useLaunchAllowance === true && \(!service \|\| scheduled\)/);
});

test("grant records approval only; it cannot reserve a paid run or call a provider", () => {
  const insertedTables = [...migration.matchAll(/insert into\s+([a-z_.]+)/gi)].map(match => match[1]);
  assert.deepEqual(insertedTables, ["public.phone_operations_audit"]);
  assert.doesNotMatch(migration, /(?:select|perform)\s+(?:public\.)?receptionist_test_reserve(?:_launch)?\s*\(/i);
  assert.doesNotMatch(migration, /api\.vapi\.ai|eval\/simulation\/run|net\.http|http_post|cron\.schedule/);
  assert.match(migration, /'one_additional_launch_test_approved'/);
  assert.match(migration, /'additionalRuns',1/);
});

test("reservation boundary model derived from the unchanged cap guard permits only one extra appended ID", () => {
  // This is a deterministic boundary model, NOT an assertion that Postgres has
  // executed the RPC. The actual SQL guard/append/locks are pinned above; an
  // integration proof must run third/fourth reservations inside ROLLBACK only.
  const approvedMaximum = Number(migration.match(/set\s+max_runs=(\d+)/)![1]);
  const requiredUsedCount = Number(migration.match(/cardinality\(a\.used_run_ids\)<>(\d+)/)![1]);
  assert.equal(approvedMaximum - requiredUsedCount, 1);
  const originalIds = ["first-consumed-run", "second-consumed-run"];
  const grant = { maximum: approvedMaximum, ids: [...originalIds] };
  const reserve = (id: string) => {
    if (grant.ids.length >= grant.maximum) throw Error("Allowance exhausted");
    grant.ids = [...grant.ids, id];
  };
  reserve("third-authorised-run");
  assert.deepEqual(grant.ids, [...originalIds, "third-authorised-run"]);
  assert.throws(() => reserve("fourth-not-authorised"), /exhausted/);
  assert.deepEqual(grant.ids, [...originalIds, "third-authorised-run"]);
  assert.equal(grant.maximum - grant.ids.length, 0);
  assert.deepEqual(originalIds, ["first-consumed-run", "second-consumed-run"]);
});
