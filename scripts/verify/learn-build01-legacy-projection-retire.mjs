/** Retire one retrying pre-release combined job after source lanes are live. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const key = `interactions.sync:${tenant}:all`;
const prefix = ".verification-results/projection-legacy-all-retire";
if (process.argv.slice(2).join(" ") !== "--retire-live" ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error("Exact LIVE combined-job retirement required");
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior retirement attempt requires inspection");
const release = JSON.parse(readFileSync(
  ".verification-results/projection-scheduler-priority-live-result.json", "utf8"));
if (release.state !== "deployed_needs_scheduled_acceptance" ||
    release.afterVersion !== 50 || release.afterWireSha !==
      "5390cc34dfa7231217e7ab5f082d4dfa8622afdc5816bd95310f7f5c5d67d042")
  throw Error("Exact split-source LIVE scheduler required");
const token = savedCliToken();
async function query(sql, readOnly) {
  const endpoint = readOnly ? "database/query/read-only" : "database/query";
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/${endpoint}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(45000), redirect: "error",
  });
  if (!response.ok) throw Error(`Combined-job ${readOnly ? "readback" : "retirement"} HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Combined-job response invalid");
  return rows;
}
const state = await query(`select payload->>'source' source,status,count(*)::int jobs,
  max(created_at) latest_created_at from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type='interactions.sync'
    and status in('queued','running','retrying') group by payload->>'source',status`, true);
if (state.some(row => !["all", "phone", "email"].includes(row.source) ||
    !Number.isSafeInteger(row.jobs) || row.jobs < 1) ||
    !state.some(row => row.source === "all" && row.status === "retrying" && row.jobs === 1) ||
    !state.some(row => row.source === "email" && row.jobs === 1))
  throw Error("Split-source queue or single legacy job not confirmed");
const before = await query(`select id,status,attempt_count,created_at,available_at,
  lease_expires_at from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='interactions.sync' and job_key='${key}'
    and payload->>'source'='all' and status in('queued','running','retrying')`, true);
if (before.length !== 1 || before[0].status !== "retrying" ||
    !/^2026-10-16 05:14:20\./.test(before[0].created_at) ||
    before[0].attempt_count < 1 || before[0].attempt_count > 4 ||
    before[0].lease_expires_at !== null)
  throw Error("Legacy combined job is no longer safely idle");
writeFileSync(prefix + "-journal.json", JSON.stringify({
  version: "learn-build01-legacy-projection-retire/1", observedAt: new Date().toISOString(),
  project, tenant, jobId: before[0].id, stateBefore: before[0].status,
  attemptBefore: before[0].attempt_count, sourceLaneState: state,
  scope: "One retrying combined projection job; retained source and published rows are untouched.",
}) + "\n", { flag: "wx", mode: 0o600 });
const sql = `begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $$
declare v_job public.platform_jobs%rowtype; v_count integer;
begin
 select * into strict v_job from public.platform_jobs where
   tenant_id='${tenant}'::uuid and id='${before[0].id}'::uuid
   and job_type='interactions.sync' and job_key='${key}'
   and payload->>'source'='all' and status='retrying'
   and attempt_count=${before[0].attempt_count} and lease_expires_at is null
   for update;
 if not exists(select 1 from public.platform_jobs where tenant_id='${tenant}'::uuid
   and job_type='interactions.sync' and payload->>'source'='email'
   and status in('queued','running','retrying'))
 then raise exception 'email_source_lane_absent';end if;
 update public.platform_jobs set status='cancelled',cancelled_at=clock_timestamp(),
   updated_at=clock_timestamp(),metadata=coalesce(metadata,'{}'::jsonb)||
     jsonb_build_object('projection_source_lanes_superseded_at',clock_timestamp())
   where id=v_job.id and tenant_id='${tenant}'::uuid;
 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception 'legacy_retire_count';end if;
end $$;
commit;`;
let submitted = false;
try { await query(sql, false); submitted = true; } catch { /* Read back unknown outcome. */ }
const after = await query(`select id,status,cancelled_at,attempt_count from public.platform_jobs
  where tenant_id='${tenant}'::uuid and id='${before[0].id}'::uuid
    and job_type='interactions.sync' and job_key='${key}'`, true);
const confirmed = after.length === 1 && after[0].id === before[0].id &&
  after[0].status === "cancelled" && Number.isFinite(Date.parse(after[0].cancelled_at)) &&
  after[0].attempt_count === before[0].attempt_count;
const result = { state: confirmed ? "legacy_job_retired" : "requires_inspection",
  submitted, afterStatus: after[0]?.status ?? null, afterAttempt: after[0]?.attempt_count ?? null,
  sourceOrPublishedDataChanged: false };
writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
if (!confirmed) process.exitCode = 1;
