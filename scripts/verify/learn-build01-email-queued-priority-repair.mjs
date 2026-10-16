/** Promote the one first Email projection job created before the priority fix. */
import { existsSync, writeFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const key = `interactions.sync:${tenant}:email`;
const prefix = ".verification-results/projection-email-queued-priority-repair";
if (process.argv.slice(2).join(" ") !== "--repair-live" ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error("Exact LIVE queued Email repair required");
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior priority repair requires inspection");
const release = JSON.parse(await (await import("node:fs/promises")).readFile(
  ".verification-results/projection-scheduler-priority-live-result.json", "utf8"));
if (release.state !== "deployed_needs_scheduled_acceptance" ||
    release.afterVersion !== 50 || release.afterWireSha !==
      "5390cc34dfa7231217e7ab5f082d4dfa8622afdc5816bd95310f7f5c5d67d042")
  throw Error("Priority-corrected LIVE scheduler required");
const token = savedCliToken();
async function query(sql, readOnly) {
  const endpoint = readOnly ? "database/query/read-only" : "database/query";
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(45000), redirect: "error",
  });
  if (!response.ok) throw Error(`Priority ${readOnly ? "readback" : "repair"} HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Priority query response invalid");
  return rows;
}
const select = `select id,status,priority,attempt_count,created_at from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type='interactions.sync'
    and job_key='${key}' and payload->>'source'='email'
    and status in('queued','running','retrying')`;
const before = await query(select, true);
if (before.length !== 1 || before[0].status !== "queued" ||
    before[0].priority !== 100 || before[0].attempt_count !== 0 ||
    !/^2026-10-16 05:15:02\./.test(before[0].created_at))
  throw Error("Exact first Email queue row no longer requires repair");
writeFileSync(prefix + "-journal.json", JSON.stringify({
  version: "learn-build01-email-queued-priority-repair/1", project, tenant,
  observedAt: new Date().toISOString(), jobId: before[0].id,
  before: { status: before[0].status, priority: before[0].priority,
    attemptCount: before[0].attempt_count, createdAt: before[0].created_at },
  targetPriority: 50, affectedRowsMaximum: 1,
}) + "\n", { flag: "wx", mode: 0o600 });
const sql = `begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $$
declare v_id uuid; v_count integer;
begin
 select id into strict v_id from public.platform_jobs
  where tenant_id='${tenant}'::uuid and id='${before[0].id}'::uuid
    and job_type='interactions.sync' and job_key='${key}'
    and payload->>'source'='email' and status='queued'
    and priority=100 and attempt_count=0 for update;
 update public.platform_jobs set priority=50,updated_at=clock_timestamp()
  where id=v_id and tenant_id='${tenant}'::uuid;
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception 'email_priority_repair_count';end if;
end $$;
select count(*)::int repaired from public.platform_jobs
 where tenant_id='${tenant}'::uuid and id='${before[0].id}'::uuid
   and job_key='${key}' and payload->>'source'='email' and priority=50;
commit;`;
let writeState = "unconfirmed";
try {
  const rows = await query(sql, false);
  writeState = rows.some(row => row?.repaired === 1) ? "submitted" : "requires_inspection";
} catch {
  writeState = "requires_inspection";
}
const after = await query(`select id,status,priority,attempt_count from public.platform_jobs
  where tenant_id='${tenant}'::uuid and id='${before[0].id}'::uuid
    and job_type='interactions.sync' and job_key='${key}'
    and payload->>'source'='email'`, true);
const confirmed = after.length === 1 && after[0].id === before[0].id &&
  after[0].priority === 50 && ["queued", "running", "retrying", "succeeded", "dead_letter"].includes(after[0].status);
const result = { state: confirmed ? "priority_repaired" : "requires_inspection",
  writeState, afterStatus: after[0]?.status ?? null, afterPriority: after[0]?.priority ?? null,
  scope: "One existing queued Email projection job; no source or customer record changed." };
writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
if (!confirmed) process.exitCode = 1;
