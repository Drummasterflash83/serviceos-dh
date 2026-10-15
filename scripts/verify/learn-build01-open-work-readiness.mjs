/** Aggregate-only LIVE readiness of retained, non-complete Commusoft job sources.
 * A linked property is a review aid, not a verified job or automatic link.
 */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with observed as materialized (
  select s.connection_id,s.external_id,s.id,p.committed_at,
    dense_rank() over(partition by s.connection_id,s.external_id
      order by p.committed_at desc) recency
  from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id
  join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id='${tenant}'::uuid and s.provider='commusoft'
    and s.collection='jobs' and p.tenant_id=s.tenant_id
    and p.connection_id=s.connection_id and p.provider=s.provider
    and p.collection=s.collection
), current as (
  select connection_id,external_id,
    case when count(distinct id)=1 then min(id::text)::uuid end version_id,
    max(committed_at) latest_observation
  from observed where recency=1 group by connection_id,external_id
), scoped as (
  select v.connection_id,v.external_id,v.id,v.payload->>'status' source_status,
    v.payload->>'propertyID' property_reference,c.latest_observation,
    j.id is not null job_linked,
    coalesce(p.entity_kind,'none') property_link_kind,
    exists(select 1 from public.learn_business_input_versions pv
      where pv.tenant_id='${tenant}'::uuid and pv.connection_id=v.connection_id
        and pv.provider='commusoft' and pv.collection='properties'
        and pv.external_id=v.payload->>'propertyID') property_source_observed
  from current c join public.learn_business_input_versions v on v.id=c.version_id
  left join public.learn_business_input_links j on j.tenant_id='${tenant}'::uuid
    and j.connection_id=v.connection_id and j.provider='commusoft'
    and j.collection='jobs' and j.external_id=v.external_id and j.entity_kind='job'
  left join public.learn_business_input_links p on p.tenant_id='${tenant}'::uuid
    and p.connection_id=v.connection_id and p.provider='commusoft'
    and p.collection='properties' and p.external_id=v.payload->>'propertyID'
  where v.payload->>'status' in ('Open','ongoing','pending','on_hold')
) select source_status,job_linked,property_link_kind,property_source_observed,
  count(*)::int retained_jobs,
  count(distinct property_reference)::int distinct_property_references,
  count(*) filter(where property_reference ~ '^[1-9][0-9]{0,15}$')::int valid_property_references,
  count(*) filter(where latest_observation<now()-interval '1 day')::int last_observed_over_day_ago,
  min(latest_observation) oldest_observation,
  max(latest_observation) newest_observation
from scoped group by source_status,job_linked,property_link_kind,property_source_observed
order by source_status,job_linked,property_link_kind,property_source_observed`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!response.ok) throw Error(`Open-work readiness unavailable (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 40 || rows.some(row =>
  typeof row?.source_status !== "string" || typeof row.property_link_kind !== "string" ||
  typeof row.job_linked !== "boolean" || typeof row.property_source_observed !== "boolean" ||
  !Number.isInteger(row.distinct_property_references) || !Number.isInteger(row.retained_jobs)))
  throw Error("Open-work readiness shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, interpretation: "Retained source/property link inventory only; no automatic job review, owner confirmation or provider freshness proof.",
  productionDataWrites: false, customerContentReturned: false }));
