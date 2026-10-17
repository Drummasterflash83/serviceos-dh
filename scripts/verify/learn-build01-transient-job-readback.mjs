/** Aggregate-only LIVE check of recent Email and identity job failures/retries. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with recent as materialized (
  select j.job_type,j.job_key,j.status,j.error_code,j.created_at,j.updated_at
  from public.platform_jobs j
  where j.tenant_id='${tenant}'::uuid
    and j.job_type in ('identity.resolve','email.workspace_sync','interactions.sync')
    and j.updated_at >= now()-interval '1 hour'
), grouped as (
  select job_type,status,coalesce(error_code,'none') error_code,
    count(*)::int jobs,max(updated_at) latest_update,
    count(*) filter(where status in ('failed','dead_letter') and exists(
      select 1 from public.platform_jobs later
      where later.tenant_id='${tenant}'::uuid
        and later.job_type=recent.job_type and later.job_key=recent.job_key
        and later.status='succeeded' and later.created_at>=recent.updated_at
    ))::int with_later_same_key_success
  from recent group by job_type,status,coalesce(error_code,'none')
)
select coalesce(jsonb_agg(jsonb_build_object(
  'jobType',job_type,'status',status,'errorCode',error_code,
  'jobs',jobs,'latestUpdate',latest_update,
  'withLaterSameKeySuccess',with_later_same_key_success
) order by job_type,status,error_code),'[]'::jsonb) recent_jobs from grouped`;

const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`Transient job readback HTTP ${response.status}`);
const rows = await response.json();
const groups = rows?.[0]?.recent_jobs;
if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(groups) ||
    !groups.every(row => typeof row.jobType === "string" &&
      typeof row.status === "string" && typeof row.errorCode === "string" &&
      Number.isSafeInteger(row.jobs) && Number.isSafeInteger(row.withLaterSameKeySuccess)))
  throw Error("Transient job readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  recentJobs: groups, jobKeysReturned: false, sourceContentReturned: false,
  productionDataWrites: false }));
