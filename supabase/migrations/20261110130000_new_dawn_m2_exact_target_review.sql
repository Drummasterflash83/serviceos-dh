-- Audit one exact Commusoft work-site candidate for an operator review.
-- Installation does not read Commusoft or create/link any customer, site or job.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';

-- Tighten the existing site classifier so both exact IDs map uniquely before
-- apply/restore; its existing callers get the same hold result.
create or replace function public.new_dawn_commusoft_exact_site_candidate(
 p_tenant uuid,p_connection uuid,p_external text,p_existing uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;
 customer public.learn_business_input_versions%rowtype;
 parent_link public.learn_business_input_links%rowtype;
 existing_link public.learn_business_input_links%rowtype;
 site public.sites%rowtype;parent text;namespace text;field text;
begin
 if p_external is null or p_external!~'^[1-9][0-9]{0,15}$' then
  return jsonb_build_object('state','review','reason','site_identity_invalid');end if;
 v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','properties',p_external);
 if v.id is null then return jsonb_build_object('state','review','reason','site_source_missing_or_ambiguous');end if;
 if v.payload->>'type' is distinct from 'workaddress'
  or jsonb_typeof(v.payload->'id') is distinct from 'number'
  or v.payload->>'id' is distinct from p_external then
  return jsonb_build_object('state','review','reason','site_source_identity_conflict');end if;
 parent:=v.payload->>'parentPropertyID';
 if jsonb_typeof(v.payload->'parentPropertyID') is distinct from 'number'
  or parent!~'^[1-9][0-9]{0,15}$' or parent=p_external then
  return jsonb_build_object('state','review','reason','customer_reference_invalid');end if;
 customer:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','properties',parent);
 if customer.id is null or customer.payload->>'type' is distinct from 'customer'
  or jsonb_typeof(customer.payload->'id') is distinct from 'number'
  or customer.payload->>'id' is distinct from parent then
  return jsonb_build_object('state','review','reason','customer_source_missing_or_ambiguous');end if;
 if (select count(*) from public.learn_business_input_current_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=parent) > 1 then
  return jsonb_build_object('state','review','reason','customer_mapping_missing_or_ambiguous');end if;
 select * into parent_link from public.learn_business_input_current_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=parent;
 if not found or parent_link.entity_kind is distinct from 'customer'
  or parent_link.entity_table not in ('people','companies')
  or parent_link.source_version_id is distinct from customer.id then
  return jsonb_build_object('state','review','reason','customer_mapping_missing_or_stale');end if;
 if not exists(select 1 from public.customer_cards cc where cc.tenant_id=p_tenant
  and cc.id=parent_link.card_id
  and ((parent_link.entity_table='people' and cc.person_id=parent_link.entity_id
    and exists(select 1 from public.people pe where pe.tenant_id=p_tenant
     and pe.id=parent_link.entity_id))
   or (parent_link.entity_table='companies' and cc.company_id=parent_link.entity_id
    and cc.person_id is null and exists(select 1 from public.companies co
     where co.tenant_id=p_tenant and co.id=parent_link.entity_id)))) then
  return jsonb_build_object('state','review','reason','customer_target_conflict');end if;
 if (select count(*) from public.learn_business_input_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=p_external) > 1 then
  return jsonb_build_object('state','review','reason','site_link_conflict');end if;
 select * into existing_link from public.learn_business_input_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=p_external;
 if found and (p_existing is null or existing_link.id<>p_existing
  or existing_link.entity_kind<>'site' or existing_link.entity_table<>'sites'
  or existing_link.source_version_id<>v.id
  or existing_link.card_id is distinct from parent_link.card_id) then
  return jsonb_build_object('state','review','reason','site_identity_already_reviewed');end if;
 namespace:='commusoft:connection:'||p_connection::text;
 if exists(select 1 from public.sites s where s.tenant_id=p_tenant
  and s.source_system in ('commusoft',namespace) and s.external_id=p_external
  and (p_existing is null or s.id<>existing_link.entity_id)) then
  return jsonb_build_object('state','review','reason','site_external_identity_conflict');end if;
 if exists(select 1 from public.import_entity_links i where i.tenant_id=p_tenant
  and i.source_system='commusoft' and i.entity_kind='site'
  and i.external_id=p_external
  and (p_existing is null or i.entity_id<>existing_link.entity_id)) then
  return jsonb_build_object('state','review','reason','legacy_site_identity_conflict');end if;
 if exists(select 1 from public.import_entity_links i where i.tenant_id=p_tenant
  and i.source_system='commusoft' and i.entity_kind='customer'
  and i.external_id=parent and
   (i.entity_id<>parent_link.entity_id or i.entity_table<>parent_link.entity_table)) then
  return jsonb_build_object('state','review','reason','legacy_customer_identity_conflict');end if;
 foreach field in array array['addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
  if v.payload ? field and v.payload->field<>'null'::jsonb
   and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then
   return jsonb_build_object('state','review','reason','site_field_invalid');end if;
 end loop;
 if nullif(btrim(v.payload->>'addressLine1'),'') is null then
  return jsonb_build_object('state','review','reason','site_address_missing');end if;
 if p_existing is not null then
  select * into site from public.sites where tenant_id=p_tenant and id=existing_link.entity_id;
  if not found or site.source_system is distinct from namespace
   or site.external_id is distinct from p_external
   or (parent_link.entity_table='people' and
    (site.person_id is distinct from parent_link.entity_id or site.company_id is not null))
   or (parent_link.entity_table='companies' and
    (site.company_id is distinct from parent_link.entity_id or site.person_id is not null)) then
   return jsonb_build_object('state','review','reason','site_owner_changed');end if;
 end if;
 return jsonb_build_object('state','ready','rule','commusoft_workaddress_parent_id_v1',
  'site_version_id',v.id,'customer_version_id',customer.id,
  'site_external_id',p_external,'customer_external_id',parent,
  'customer_link_id',parent_link.id,'customer_entity_id',parent_link.entity_id,
  'customer_entity_table',parent_link.entity_table,'card_id',parent_link.card_id,
  'site_id',case when p_existing is null then null else existing_link.entity_id end);
end $$;

-- The job classifier must also reject duplicate current site/customer mappings.
create or replace function public.new_dawn_commusoft_exact_link_candidate(
 p_tenant uuid,p_connection uuid,p_external text,p_ignore_link uuid default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;
 property public.learn_business_input_versions%rowtype;
 customer public.learn_business_input_versions%rowtype;
 site_link public.learn_business_input_links%rowtype;
 customer_link public.learn_business_input_links%rowtype;
 site public.sites%rowtype;job public.jobs%rowtype;
 property_ref text;customer_ref text;namespace text;fields jsonb;
begin
 if p_external is null or p_external!~'^[1-9][0-9]{0,15}$' then
  return jsonb_build_object('state','review','reason','job_identity_invalid');end if;
 v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','jobs',p_external);
 if v.id is null then return jsonb_build_object('state','review','reason','job_source_missing_or_ambiguous');end if;
 if jsonb_typeof(v.payload->'id') is distinct from 'number'
  or v.payload->>'id' is distinct from p_external then
  return jsonb_build_object('state','review','reason','job_source_identity_conflict');end if;
 if exists(select 1 from public.learn_business_input_current_links l
  where l.tenant_id=p_tenant and l.connection_id=p_connection
   and l.provider='commusoft' and l.collection='jobs' and l.external_id=p_external
   and l.id is distinct from p_ignore_link) then
  return jsonb_build_object('state','review','reason','job_already_linked');end if;
 property_ref:=v.payload->>'propertyID';
 if jsonb_typeof(v.payload->'propertyID') is distinct from 'number'
  or property_ref!~'^[1-9][0-9]{0,15}$' then
  return jsonb_build_object('state','review','reason','property_reference_invalid');end if;
 property:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','properties',property_ref);
 if property.id is null then return jsonb_build_object('state','review','reason','property_source_missing_or_ambiguous');end if;
 if property.payload->>'type' is distinct from 'workaddress'
  or jsonb_typeof(property.payload->'id') is distinct from 'number'
  or property.payload->>'id' is distinct from property_ref then
  return jsonb_build_object('state','review','reason','property_not_exact_work_site');end if;
 customer_ref:=property.payload->>'parentPropertyID';
 if jsonb_typeof(property.payload->'parentPropertyID') is distinct from 'number'
  or customer_ref!~'^[1-9][0-9]{0,15}$' or customer_ref=property_ref then
  return jsonb_build_object('state','review','reason','customer_reference_invalid');end if;
 customer:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','properties',customer_ref);
 if customer.id is null then return jsonb_build_object('state','review','reason','customer_source_missing_or_ambiguous');end if;
 if customer.payload->>'type' is distinct from 'customer'
  or jsonb_typeof(customer.payload->'id') is distinct from 'number'
  or customer.payload->>'id' is distinct from customer_ref then
  return jsonb_build_object('state','review','reason','customer_source_identity_conflict');end if;
 if (select count(*) from public.learn_business_input_current_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=property_ref) > 1 then
  return jsonb_build_object('state','review','reason','site_mapping_missing_or_ambiguous');end if;
 select * into site_link from public.learn_business_input_current_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=property_ref;
 if not found or site_link.entity_kind is distinct from 'site'
  or site_link.entity_table is distinct from 'sites'
  or site_link.source_version_id is distinct from property.id then
  return jsonb_build_object('state','review','reason','site_mapping_missing_or_stale');end if;
 if (select count(*) from public.learn_business_input_current_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=customer_ref) > 1 then
  return jsonb_build_object('state','review','reason','customer_mapping_missing_or_ambiguous');end if;
 select * into customer_link from public.learn_business_input_current_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=customer_ref;
 if not found or customer_link.entity_kind is distinct from 'customer'
  or customer_link.entity_table not in ('people','companies')
  or customer_link.source_version_id is distinct from customer.id then
  return jsonb_build_object('state','review','reason','customer_mapping_missing_or_stale');end if;
 select * into site from public.sites where tenant_id=p_tenant and id=site_link.entity_id;
 if not found or site_link.card_id is distinct from customer_link.card_id or not (
  (customer_link.entity_table='people' and site.person_id=customer_link.entity_id and site.company_id is null
   and exists(select 1 from public.people where tenant_id=p_tenant and id=customer_link.entity_id))
  or (customer_link.entity_table='companies' and site.company_id=customer_link.entity_id and site.person_id is null
   and exists(select 1 from public.companies where tenant_id=p_tenant and id=customer_link.entity_id)))
  or not exists(select 1 from public.customer_cards cc where cc.tenant_id=p_tenant
   and cc.id=customer_link.card_id and
   ((customer_link.entity_table='people' and cc.person_id=customer_link.entity_id)
    or (customer_link.entity_table='companies' and cc.person_id is null and cc.company_id=customer_link.entity_id))) then
  return jsonb_build_object('state','review','reason','customer_site_conflict');end if;
 namespace:='commusoft:connection:'||p_connection::text;
 if site.source_system in ('commusoft',namespace)
  and site.external_id is distinct from property_ref then
  return jsonb_build_object('state','review','reason','site_source_identity_conflict');end if;
 if exists(select 1 from public.sites s where s.tenant_id=p_tenant
  and s.source_system in ('commusoft',namespace) and s.external_id=property_ref
  and s.id<>site.id) then
  return jsonb_build_object('state','review','reason','site_identity_conflict');end if;
 if exists(select 1 from public.import_entity_links i where i.tenant_id=p_tenant
  and i.source_system='commusoft' and i.entity_kind='site'
  and i.external_id=property_ref and i.entity_id<>site.id)
  or exists(select 1 from public.import_entity_links i where i.tenant_id=p_tenant
   and i.source_system='commusoft' and i.entity_kind='customer'
   and i.external_id=customer_ref and (i.entity_id<>customer_link.entity_id
    or i.entity_table<>customer_link.entity_table)) then
  return jsonb_build_object('state','review','reason','legacy_identity_conflict');end if;
 if exists(select 1 from public.learn_business_input_current_links l
  where l.tenant_id=p_tenant and l.connection_id=p_connection
   and l.provider='commusoft' and l.collection='properties'
   and l.entity_kind='site' and l.entity_id=site.id
   and l.external_id<>property_ref) then
  return jsonb_build_object('state','review','reason','site_mapping_conflict');end if;
 if exists(select 1 from public.jobs j where j.tenant_id=p_tenant
  and j.source_system in ('commusoft',namespace) and j.external_id=p_external
  and (p_ignore_link is null or j.id is distinct from
    (select entity_id from public.learn_business_input_links where id=p_ignore_link and tenant_id=p_tenant))) then
  return jsonb_build_object('state','review','reason','existing_job_needs_review');end if;
 fields:=public.learn_commusoft_job_fields(v.payload,p_external);
 if fields->>'state' is distinct from 'ready' then
  return jsonb_build_object('state','review','reason',coalesce(fields->>'reason','job_fields_invalid'));end if;
 return jsonb_build_object('state','ready','rule','commusoft_exact_dual_id_v1',
  'job_version_id',v.id,'property_version_id',property.id,'customer_version_id',customer.id,
  'property_external_id',property_ref,'customer_external_id',customer_ref,
  'site_link_id',site_link.id,'site_id',site.id,
  'customer_link_id',customer_link.id,'customer_entity_id',customer_link.entity_id,
  'customer_entity_table',customer_link.entity_table,'card_id',customer_link.card_id,
  'fields',fields->'fields','timestamps',fields->'timestamps');
end $$;

create function public.new_dawn_m2_exact_site_target_review(
 p_tenant uuid,p_connection uuid,p_external text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='15s' as $$
declare actor uuid:=auth.uid();candidate jsonb;v public.learn_business_input_versions%rowtype;
 link public.learn_business_input_links%rowtype;link_count integer;latest_action text;
 state text;hold text;parent text;label text;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'authenticated' or p_tenant is null or p_connection is null
  or p_external is null or p_external!~'^[1-9][0-9]{0,15}$'
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'm2_exact_site_target_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb for share;
 if not found then raise exception 'm2_exact_site_target_disabled' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null for share;
 if not found then raise exception 'm2_exact_site_connection_unavailable' using errcode='42501';end if;
 select count(*) into link_count from public.learn_business_input_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=p_external;
 if link_count=1 then
  select * into link from public.learn_business_input_links
   where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
    and collection='properties' and external_id=p_external;
  candidate:=public.new_dawn_commusoft_exact_site_candidate(
   p_tenant,p_connection,p_external,link.id);
  select action into latest_action from public.new_dawn_commusoft_exact_site_events
   where tenant_id=p_tenant and link_id=link.id
   order by created_at desc,id desc limit 1;
 else
  candidate:=public.new_dawn_commusoft_exact_site_candidate(
   p_tenant,p_connection,p_external);
 end if;
 v:=public.learn_business_input_latest(
  p_tenant,p_connection,'commusoft','properties',p_external);
 parent:=case when v.id is not null and
  jsonb_typeof(v.payload->'parentPropertyID')='number' and
  v.payload->>'parentPropertyID'~'^[1-9][0-9]{0,15}$'
  then v.payload->>'parentPropertyID' end;
 label:=case when v.id is not null then
  left(public.learn_business_input_text(v.payload,'addressLine1'),1000) end;
 if link_count>1 then
  state:='review';hold:='site_link_conflict';
 elsif candidate->>'state'='ready' then
  state:=case when link_count=0 then 'ready'
   when latest_action='reversed' then 'reversed_valid'
   when latest_action in ('linked','restored') and exists(
    select 1 from public.learn_business_input_current_links current_link
    where current_link.id=link.id) then 'linked_current'
   when latest_action is null and exists(
    select 1 from public.learn_business_input_current_links current_link
    where current_link.id=link.id) then 'legacy_current'
   else 'review' end;
  if state='review' then hold:='site_event_conflict';end if;
 else
  state:='review';hold:=coalesce(candidate->>'reason','site_source_unavailable');
 end if;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_link_review_queue' and value='true'::jsonb for share;
 if not found then raise exception 'm2_exact_site_target_disabled' using errcode='42501';end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_sites.exact_target_review','sites',p_external,
  jsonb_build_object('connection_id',p_connection,'state',state,'hold_reason',hold,
   'source_version_id',v.id,'link_id',link.id),btrim(p_reason),audit::text,
  false,'new-dawn-exact-site-target');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-exact-site-target/1',
  'tenant_id',p_tenant,'connection_id',p_connection,'actor_id',actor,
  'external_id',p_external,'source_version_id',v.id,'recorded_parent_id',parent,
  'source_address_line',label,'state',state,'reason',hold,
  'link_id',case when state in ('linked_current','reversed_valid','legacy_current')
   then link.id end,'audit_id',audit,'observed_at',clock_timestamp());
end $$;
revoke all on function public.new_dawn_m2_exact_site_target_review(uuid,uuid,text,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_m2_exact_site_target_review(uuid,uuid,text,text)
 to authenticated;
commit;
