/** Counts-only LIVE breakdown of open Commusoft jobs awaiting source review. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with connection as (
  select id from public.provider_connections
  where tenant_id='${tenant}'::uuid and provider='commusoft' and revoked_at is null
), observations as materialized (
  select v.id,v.connection_id,v.collection,v.external_id,max(p.committed_at) seen
  from public.learn_business_input_versions v
  join connection c on c.id=v.connection_id
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages p on p.id=o.page_id
    and (p.tenant_id,p.connection_id,p.provider,p.collection)=
      (v.tenant_id,v.connection_id,v.provider,v.collection)
  where v.tenant_id='${tenant}'::uuid and v.provider='commusoft'
    and v.collection in ('jobs','properties')
  group by v.id,v.connection_id,v.collection,v.external_id
), ranked as materialized (
  select *,dense_rank() over(partition by connection_id,collection,external_id
    order by seen desc) recency from observations
), latest as materialized (
  select connection_id,collection,external_id,
    case when count(*)=1 then min(id::text)::uuid end version_id
  from ranked where recency=1 group by connection_id,collection,external_id
), sources as materialized (
  select l.*,v.payload from latest l
  left join public.learn_business_input_versions v on v.id=l.version_id
), jobs as materialized (
  select s.*,case when s.payload->>'propertyID' ~ '^[1-9][0-9]{0,15}$'
    then s.payload->>'propertyID' end property_ref
  from sources s where s.collection='jobs'
    and s.payload->>'status' in ('Open','ongoing','pending','on_hold')
), related as materialized (
  select j.*,p.version_id property_version,p.external_id found_property,
    p.payload property_payload,
    case when p.payload->>'type'='customer' then p.external_id
      when p.payload->>'type'='workaddress'
        and p.payload->>'parentPropertyID' ~ '^[1-9][0-9]{0,15}$'
        then p.payload->>'parentPropertyID' end customer_ref,
    case when p.payload->>'type'='customer' then p.version_id
      else parent.version_id end customer_version,
    case when p.payload->>'type'='customer' then p.payload
      else parent.payload end customer_payload,
    parent.external_id found_customer
  from jobs j
  left join sources p on p.connection_id=j.connection_id
    and p.collection='properties' and p.external_id=j.property_ref
  left join sources parent on parent.connection_id=j.connection_id
    and parent.collection='properties'
    and parent.external_id=p.payload->>'parentPropertyID'
), classified as (
  select case when r.version_id is null then 'job_source_conflict'
    when r.property_ref is null then 'property_reference_missing'
    when r.found_property is null then 'property_source_missing'
    when r.property_version is null then 'property_source_conflict'
    when r.property_payload->>'type'='customer' then 'customer_source_retained'
    when r.property_payload->>'type' is distinct from 'workaddress'
      then 'property_type_unresolved'
    when r.customer_ref is null then 'customer_reference_missing'
    when r.found_customer is null then 'customer_source_missing'
    when r.customer_version is null then 'customer_source_conflict'
    when r.customer_payload->>'type' is distinct from 'customer'
      then 'customer_type_unresolved'
    else 'site_customer_source_retained' end relationship_state,
    case when r.customer_version is null
      or r.customer_payload->>'type' is distinct from 'customer' then 'unresolved'
      when cl.id is null then 'unreviewed'
      when cl.source_version_id is distinct from r.customer_version
        then 'review_changed' else 'reviewed' end customer_identity_state,
    (jl.source_version_id=r.version_id
      and j.metadata#>>'{learn_business_input,source_version_id}'=r.version_id::text)
      is true as reviewed_job_linked
  from related r
  left join public.learn_business_input_current_links cl
    on cl.tenant_id='${tenant}'::uuid and cl.connection_id=r.connection_id
    and cl.provider='commusoft' and cl.collection='properties'
    and cl.external_id=r.customer_ref and cl.entity_kind='customer'
  left join public.learn_business_input_current_links jl
    on jl.tenant_id='${tenant}'::uuid and jl.connection_id=r.connection_id
    and jl.provider='commusoft' and jl.collection='jobs'
    and jl.external_id=r.external_id and jl.entity_kind='job'
    and jl.entity_table='jobs'
  left join public.jobs j on j.tenant_id='${tenant}'::uuid and j.id=jl.entity_id
)
select relationship_state,customer_identity_state,reviewed_job_linked,
  count(*)::int jobs from classified group by 1,2,3 order by jobs desc,1,2`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  },
);
if (!response.ok) throw Error(`Open-job reason readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 50 || rows.some(row =>
  !Number.isSafeInteger(row.jobs) || row.jobs < 0 ||
  typeof row.relationship_state !== "string" ||
  typeof row.customer_identity_state !== "string" ||
  typeof row.reviewed_job_linked !== "boolean"))
  throw Error("Open-job reason readback shape changed");
console.log(JSON.stringify({ version: "learn-build01-open-job-review-reasons/1",
  observedAtUtc: new Date().toISOString(), project, tenant,
  totalOpenJobs: rows.reduce((n, row) => n + row.jobs, 0), rows,
  sourceOrCustomerContentReturned: false, productionDataWrites: false }));
