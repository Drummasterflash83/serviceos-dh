/** Read-only aggregate coverage for Drummonds job-card business review. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with linked as (
  select related_job_id job_id, count(*)::int interactions
  from public.interactions
  where tenant_id='${tenant}'::uuid and related_job_id is not null
    and status not in ('deleted','removed')
  group by related_job_id
), scoped as (
  select j.id,j.verified,j.customer_person_id,j.customer_company_id,j.site_id,
    j.engineer_person_id,j.completed_date,coalesce(l.interactions,0) interactions,
    case when j.source_system like 'commusoft%' then 'commusoft'
         when j.source_system like 'quickbooks%' then 'quickbooks'
         when j.source_system is null then 'unlabelled'
         else 'other' end source_class,
    case when lower(coalesce(j.status,'')) in ('completed','complete','done') then 'completed'
         when lower(coalesce(j.status,'')) in ('open','in progress','in_progress') then 'open'
         when lower(coalesce(j.status,'')) in ('pending','on hold','on_hold','closed','cancelled')
           then lower(j.status)
         else 'other_or_unconfirmed' end status_class
  from public.jobs j left join linked l on l.job_id=j.id
  where j.tenant_id='${tenant}'::uuid
)
select source_class,status_class,count(*)::int jobs,
  count(*) filter(where verified)::int verified,
  count(*) filter(where customer_person_id is not null or customer_company_id is not null)::int customer_linked,
  count(*) filter(where site_id is not null)::int site_linked,
  count(*) filter(where engineer_person_id is not null)::int engineer_linked,
  count(*) filter(where completed_date is not null)::int completion_instant,
  count(*) filter(where interactions>0)::int communication_linked,
  coalesce(sum(interactions),0)::bigint::text linked_communications
from scoped group by source_class,status_class order by source_class,status_class`;
const token = savedCliToken();
async function read(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      redirect: "error",
      signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`Read-only job-card coverage failed (HTTP ${response.status})`);
  }
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 30) throw Error("Unexpected coverage response");
  return rows;
}
const [rows, sourceCoverage] = await Promise.all([
  read(query),
  read(`select
    (select count(distinct (connection_id,external_id))::int
     from public.learn_business_input_versions where tenant_id='${tenant}'::uuid
       and provider='commusoft' and collection='jobs') observed_job_identities,
    (select count(*)::int from public.learn_business_input_links
     where tenant_id='${tenant}'::uuid and provider='commusoft'
       and collection='jobs' and entity_kind='job') reviewed_job_links`),
]);
if (sourceCoverage.length !== 1) throw Error("Unexpected source-coverage response");
console.log(
  JSON.stringify({
    version: "learn-build01-job-card-coverage/1",
    observedAtUtc: new Date().toISOString(),
    environment: "LIVE",
    readOnly: true,
    project,
    rows,
    sourceCoverage: sourceCoverage[0],
  }),
);
