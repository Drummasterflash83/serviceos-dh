/** Counts-only LIVE readback of customer cards that missed the current sweep. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with stale as (
  select c.id,c.person_id,c.company_id,c.context,c.updated_at,
    p.id is not null person_present,
    coalesce(p.primary_email ~* '@example\\.invalid$',false) synthetic_person,
    co.id is not null company_present
  from public.customer_cards c
  left join public.people p on p.id=c.person_id and p.tenant_id=c.tenant_id
  left join public.companies co on co.id=c.company_id and co.tenant_id=c.tenant_id
  where c.tenant_id='${tenant}'::uuid and c.status<>'archived'
    and c.updated_at<clock_timestamp()-interval '1 hour'
    and not c.context?'projection'
) select count(*)::int stale_unprojected,
  count(*) filter(where person_id is not null and not person_present)::int missing_person,
  count(*) filter(where company_id is not null and not company_present)::int missing_company,
  count(*) filter(where synthetic_person)::int synthetic_person,
  count(*) filter(where person_id is null and company_id is null)::int no_identity,
  min(updated_at) oldest_updated_at,max(updated_at) newest_updated_at
from stale`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`LIVE card stale readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
  ["stale_unprojected","missing_person","missing_company","synthetic_person","no_identity"]
    .some((key) => !Number.isInteger(rows[0][key]) || rows[0][key] < 0))
  throw Error("LIVE card stale readback shape changed");
const recentResponse = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query: `select status,error_code,attempt_count,records_processed,
      result is null result_absent,
      coalesce((result->>'cards_projected')::int,0) cards_projected,
      coalesce((result->>'failed')::int,0) cards_failed,
      coalesce((result->>'swept')::int,0) cards_swept,
      updated_at from public.platform_jobs
      where tenant_id='${tenant}'::uuid and job_type='customer_card.sync'
      order by created_at desc,id desc limit 8` }),
  });
if (!recentResponse.ok) throw Error(`LIVE card jobs readback HTTP ${recentResponse.status}`);
const recentJobs = await recentResponse.json();
if (!Array.isArray(recentJobs) || recentJobs.length > 8 || recentJobs.some((job) =>
  !job || typeof job.status !== "string" ||
  !["attempt_count","cards_projected","cards_failed","cards_swept"]
    .every((key) => Number.isInteger(job[key]) && job[key] >= 0)))
  throw Error("LIVE card jobs readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  ...rows[0], recentJobs, cardIdsReturned: false, productionDataWrites: false }));
