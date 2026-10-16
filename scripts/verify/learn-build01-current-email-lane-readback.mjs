/** Aggregate-only LIVE readback of the unattended current-Email projection lane. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const jobKey = `interactions.sync:${tenant}:email:current`;
const query = `select count(*)::int jobs,
  count(*) filter(where status='succeeded')::int succeeded,
  count(*) filter(where status in ('failed','dead_letter'))::int failed_or_dead,
  count(*) filter(where status in ('queued','running','retrying'))::int active,
  sum(coalesce(records_processed,0))::int records_processed,
  min(created_at) first_queued_at,max(created_at) latest_queued_at,
  max(completed_at) filter(where status='succeeded') last_success_at,
  jsonb_object_agg(coalesce(error_code,'none'), failures) filter(where failures>0) failure_codes
from (
  select j.*,
    count(*) filter(where j.status in ('failed','dead_letter'))
      over(partition by j.error_code)::int failures
  from public.platform_jobs j
  where j.tenant_id='${tenant}'::uuid
    and j.job_type='interactions.sync'
    and j.job_key='${jobKey}'
) x`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`Current Email lane readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
    !["jobs", "succeeded", "failed_or_dead", "active"]
      .every(key => Number.isSafeInteger(rows[0][key]) && rows[0][key] >= 0))
  throw Error("Current Email lane readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  ...rows[0], productionDataWrites: false }));
