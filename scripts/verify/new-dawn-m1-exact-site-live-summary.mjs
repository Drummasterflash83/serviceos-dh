/** Aggregate-only LIVE readback of workaddress site-projection prerequisites. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with observed as materialized (
 select distinct v.id,v.connection_id,v.collection,v.external_id,v.payload,p.committed_at
 from public.learn_business_input_versions v
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id
  and (p.tenant_id,p.connection_id,p.provider,p.collection)=
      (v.tenant_id,v.connection_id,v.provider,v.collection)
 where v.tenant_id='${tenant}' and v.provider='commusoft'
  and v.collection in ('jobs','properties')
), ranked as materialized (
 select o.*,row_number() over(partition by connection_id,collection,external_id
  order by committed_at desc,id) row_no,
  count(*) over(partition by connection_id,collection,external_id,committed_at) tied_versions
 from observed o
), latest as materialized (
 select * from ranked where row_no=1 and tied_versions=1
), unlinked as materialized (
 select distinct v.connection_id,v.external_id from observed v
 where v.collection='jobs'
 and not exists(select 1 from public.learn_business_input_current_links l
  where l.tenant_id='${tenant}' and l.connection_id=v.connection_id
   and l.provider='commusoft' and l.collection=v.collection and l.external_id=v.external_id)
), job_source as materialized (
 select u.connection_id,u.external_id,j.payload->>'propertyID' property_id
 from unlinked u join latest j on j.connection_id=u.connection_id
  and j.collection='jobs' and j.external_id=u.external_id
), property_ids as materialized (
 select distinct j.connection_id,j.property_id from job_source j
 where j.property_id~'^[1-9][0-9]{0,15}$'
), properties as materialized (
 select p.connection_id,p.property_id,l.id version_id,l.payload
 from property_ids p join latest l on l.connection_id=p.connection_id
  and l.collection='properties' and l.external_id=p.property_id
), workaddresses as materialized (
 select p.connection_id,p.property_id,p.version_id,
  p.payload->>'parentPropertyID' customer_id,
  p.payload->>'addressLine1' address1
 from properties p where p.payload->>'type'='workaddress'
), parents as materialized (
 select w.*,l.id customer_version_id,l.payload customer_payload
 from workaddresses w join latest l on l.connection_id=w.connection_id
  and l.collection='properties' and l.external_id=w.customer_id
 where w.customer_id~'^[1-9][0-9]{0,15}$'
), ready_parent as materialized (
 select p.* from parents p
 join public.learn_business_input_current_links l on l.tenant_id='${tenant}'
  and l.connection_id=p.connection_id and l.provider='commusoft'
  and l.collection='properties' and l.external_id=p.customer_id
  and l.entity_kind='customer' and l.source_version_id=p.customer_version_id
 join public.customer_cards cc on cc.id=l.card_id and cc.tenant_id=l.tenant_id
 where p.customer_payload->>'type'='customer'
  and ((l.entity_table='people' and cc.person_id=l.entity_id)
   or (l.entity_table='companies' and cc.company_id=l.entity_id and cc.person_id is null))
), unlinked_site as materialized (
 select p.* from ready_parent p where not exists(
  select 1 from public.learn_business_input_current_links l
  where l.tenant_id='${tenant}' and l.connection_id=p.connection_id
   and l.provider='commusoft' and l.collection='properties' and l.external_id=p.property_id)
), no_identity_conflict as materialized (
 select p.* from unlinked_site p where not exists(
  select 1 from public.sites s where s.tenant_id='${tenant}'
   and s.source_system in ('commusoft','commusoft:connection:'||p.connection_id::text)
   and s.external_id=p.property_id)
 and not exists(select 1 from public.import_entity_links i where i.tenant_id='${tenant}'
  and i.source_system='commusoft' and i.entity_kind='site' and i.external_id=p.property_id)
)
select clock_timestamp() observed_at,
 (select count(*)::int from unlinked) unlinked_job_ids,
 (select count(*)::int from property_ids) distinct_property_ids,
 (select count(*)::int from workaddresses) workaddress_property_ids,
 (select count(*)::int from ready_parent) current_customer_mapped_property_ids,
 (select count(*)::int from unlinked_site) without_site_link,
 (select count(*)::int from no_identity_conflict) no_external_identity_conflict,
 (select count(*)::int from no_identity_conflict where nullif(btrim(address1),'') is not null) with_address_line,
 (select count(*)::int from job_source j join no_identity_conflict p
  on p.connection_id=j.connection_id and p.property_id=j.property_id) affected_job_ids`;

const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST",
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(90000),
});
if (!response.ok) {
  const error = await response.json().catch(() => ({}));
  throw Error(`LIVE site summary failed (HTTP ${response.status}): ${String(error?.message ?? error?.code ?? 'unknown').slice(0,300)}`);
}
const row = (await response.json())?.[0];
if (!row || !Number.isInteger(row.unlinked_job_ids) ||
    !Number.isInteger(row.no_external_identity_conflict)) throw Error("Summary contract changed");
console.log(JSON.stringify({ project, tenant, ...row,
  limitation: "Counts are projection prerequisites, not approved site creations or job links. Each source version and conflict is rechecked at apply time." }));
