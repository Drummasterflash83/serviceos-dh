-- Read-only, one-statement snapshot. Replace __TENANT__ with a fixed UUID.
-- Every join keeps the Commusoft connection as well as the tenant boundary.
with connections as materialized (
 select id from public.provider_connections
 where tenant_id='__TENANT__'::uuid and provider='commusoft'
  and status='configured' and revoked_at is null
), observed as materialized (
 select v.id,v.connection_id,v.collection,v.external_id,v.payload,
  max(p.committed_at) committed_at
 from public.learn_business_input_versions v
 join connections c on c.id=v.connection_id
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id
  and (p.tenant_id,p.connection_id,p.provider,p.collection)=
      (v.tenant_id,v.connection_id,v.provider,v.collection)
 where v.tenant_id='__TENANT__'::uuid and v.provider='commusoft'
  and v.collection in ('jobs','properties')
 group by v.id
), ranked as materialized (
 select o.*,row_number() over(partition by connection_id,collection,external_id
  order by committed_at desc,id) row_no,
  count(*) over(partition by connection_id,collection,external_id,committed_at) tied_versions
 from observed o
), latest as materialized (
 select * from ranked where row_no=1 and tied_versions=1
), identities as materialized (
 select distinct connection_id,external_id from observed where collection='jobs'
), unlinked as materialized (
 select i.* from identities i where not exists(
  select 1 from public.learn_business_input_current_links l
  where l.tenant_id='__TENANT__'::uuid and l.connection_id=i.connection_id
   and l.provider='commusoft' and l.collection='jobs'
   and l.external_id=i.external_id)
), jobs as materialized (
 select u.connection_id,u.external_id,j.id source_version_id,
  j.payload->>'propertyID' property_id,
  coalesce(jsonb_typeof(j.payload->'id')='number'
   and j.payload->>'id'=u.external_id
   and u.external_id~'^[1-9][0-9]{0,15}$',false) source_identity_valid,
  coalesce(jsonb_typeof(j.payload->'propertyID')='number'
   and (j.payload->>'propertyID')~'^[1-9][0-9]{0,15}$',false) property_ref_valid
 from unlinked u left join latest j on j.connection_id=u.connection_id
  and j.collection='jobs' and j.external_id=u.external_id
), property_ids as materialized (
 select distinct connection_id,property_id from jobs where property_ref_valid
), properties as materialized (
 select p.connection_id,p.property_id,s.id source_version_id,s.payload,
  s.payload->>'parentPropertyID' parent_id,
  coalesce(jsonb_typeof(s.payload->'id')='number'
   and s.payload->>'id'=p.property_id,false) source_identity_valid,
  coalesce(jsonb_typeof(s.payload->'parentPropertyID')='number'
   and (s.payload->>'parentPropertyID')~'^[1-9][0-9]{0,15}$'
   and s.payload->>'parentPropertyID'<>p.property_id,false) parent_ref_valid
 from property_ids p left join latest s on s.connection_id=p.connection_id
  and s.collection='properties' and s.external_id=p.property_id
), parent_ids as materialized (
 select distinct connection_id,parent_id from properties
 where payload->>'type'='workaddress' and parent_ref_valid
), parents as materialized (
 select p.connection_id,p.parent_id,s.id source_version_id,s.payload,
  coalesce(jsonb_typeof(s.payload->'id')='number'
   and s.payload->>'id'=p.parent_id
   and s.payload->>'type'='customer',false) source_identity_valid
 from parent_ids p left join latest s on s.connection_id=p.connection_id
  and s.collection='properties' and s.external_id=p.parent_id
), parent_checks as materialized (
 select p.connection_id,p.parent_id,p.source_version_id,p.source_identity_valid,
  count(l.id) link_count,
  coalesce(bool_or(l.id is not null and l.entity_kind='customer'
   and l.entity_table in ('people','companies')
   and l.source_version_id=p.source_version_id
   and cc.id is not null
   and ((l.entity_table='people' and cc.person_id=l.entity_id
    and pe.id is not null)
    or (l.entity_table='companies' and cc.company_id=l.entity_id
     and cc.person_id is null and co.id is not null))),false) mapped_target_valid
 from parents p
 left join public.learn_business_input_current_links l
  on l.tenant_id='__TENANT__'::uuid and l.connection_id=p.connection_id
   and l.provider='commusoft' and l.collection='properties'
   and l.external_id=p.parent_id
 left join public.customer_cards cc on cc.tenant_id='__TENANT__'::uuid
  and cc.id=l.card_id
 left join public.people pe on pe.tenant_id='__TENANT__'::uuid
  and pe.id=l.entity_id and l.entity_table='people'
 left join public.companies co on co.tenant_id='__TENANT__'::uuid
  and co.id=l.entity_id and l.entity_table='companies'
 group by p.connection_id,p.parent_id,p.source_version_id,p.source_identity_valid
), property_checks as materialized (
 select p.connection_id,p.property_id,p.source_version_id,p.payload,
  p.source_identity_valid,p.parent_id,p.parent_ref_valid,
  coalesce(pc.source_identity_valid and pc.link_count=1
   and pc.mapped_target_valid,false) parent_ready,
  nullif(upper(regexp_replace(coalesce(p.payload->>'postcode',''),
   '[[:space:]]+','','g')),'') postcode_key,
  coalesce(nullif(btrim(p.payload->>'addressLine1'),'') is not null,false) has_address,
  exists(select 1 from public.learn_business_input_current_links sl
   where sl.tenant_id='__TENANT__'::uuid and sl.connection_id=p.connection_id
    and sl.provider='commusoft' and sl.collection='properties'
    and sl.external_id=p.property_id) site_mapping_present,
  exists(select 1 from public.sites s where s.tenant_id='__TENANT__'::uuid
   and upper(regexp_replace(coalesce(s.postcode,''),'[[:space:]]+','','g'))=
    upper(regexp_replace(coalesce(p.payload->>'postcode',''),'[[:space:]]+','','g'))
   and nullif(btrim(p.payload->>'postcode'),'') is not null) postcode_collision
 from properties p left join parent_checks pc
  on pc.connection_id=p.connection_id and pc.parent_id=p.parent_id
), classified as materialized (
 select j.connection_id,j.external_id,j.property_id,
  case
   when j.source_version_id is null or not j.source_identity_valid
    or not j.property_ref_valid then 'job_source_hold'
   when p.source_version_id is null or not p.source_identity_valid
    or coalesce(p.payload->>'type','') not in ('customer','workaddress')
    then 'property_source_hold'
   when p.payload->>'type'='customer'
    then 'customer_property_outside_dual_id'
   when not p.parent_ref_valid or not p.parent_ready
    then 'customer_identity_unreviewed'
   when p.postcode_collision then 'postcode_collision'
   when p.site_mapping_present then 'site_mapping_review'
   when not p.has_address or p.postcode_key is null
    then 'site_source_other_hold'
   else 'provisional_site_review'
  end first_hold
 from jobs j left join property_checks p
  on p.connection_id=j.connection_id and p.property_id=j.property_id
), counts as (
 select first_hold,count(*)::integer job_count,
  count(distinct (connection_id,property_id)) filter(where property_id is not null)::integer property_count
 from classified group by first_hold
), tie_counts as (
 select collection,count(*)::integer identity_count from ranked
 where row_no=1 and tied_versions>1 group by collection
)
select clock_timestamp() observed_at,
 (select count(*)::integer from connections) configured_connections,
 (select count(*)::integer from identities) observed_job_ids,
 (select count(*)::integer from unlinked) unlinked_job_ids,
 (select count(*)::integer from property_ids) distinct_referenced_property_ids,
 (select coalesce(sum(identity_count),0)::integer from tie_counts
   where collection='jobs') ambiguous_latest_job_ids,
 (select coalesce(sum(identity_count),0)::integer from tie_counts
   where collection='properties') ambiguous_latest_property_ids,
 coalesce((select jsonb_object_agg(first_hold,job_count) from counts),'{}'::jsonb) job_first_holds,
 coalesce((select jsonb_object_agg(first_hold,property_count) from counts),'{}'::jsonb)
  distinct_property_ids_by_first_hold;
