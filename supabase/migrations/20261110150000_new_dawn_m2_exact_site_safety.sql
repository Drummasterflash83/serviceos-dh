-- Keep exact work-site creation held when another canonical site has the
-- same address/postcode, and permit dependency-order reversal after every
-- exact job link using that site has been reversed. Installation creates no
-- sites, jobs, customer mappings, links, events or provider reads.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';

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
 -- A canonical address collision is a review question, never permission to
 -- guess that two source IDs refer to the same work site. Require a postcode
 -- before adding a new canonical site so the duplicate screen is meaningful.
 if nullif(btrim(v.payload->>'postcode'),'') is null then
  return jsonb_build_object('state','review','reason','site_postcode_missing');end if;
 if exists(select 1 from public.sites s where s.tenant_id=p_tenant
  and (p_existing is null or s.id is distinct from existing_link.entity_id)
  and lower(btrim(s.label))=lower(btrim(v.payload->>'addressLine1'))
  and upper(regexp_replace(coalesce(s.postcode,''),'[[:space:]]+','','g'))=
      upper(regexp_replace(v.payload->>'postcode','[[:space:]]+','','g'))) then
  return jsonb_build_object('state','review','reason','site_address_collision');end if;
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

create or replace function public.new_dawn_commusoft_exact_site_toggle(
 p_tenant uuid,p_link uuid,p_action text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='15s' as $$
declare actor uuid:=auth.uid();l public.learn_business_input_links%rowtype;
 latest_action text;candidate jsonb;audit uuid:=gen_random_uuid();event_action text;
begin
 if p_tenant is null or p_link is null or p_action not in ('reverse','restore')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'exact_site_toggle_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 select * into l from public.learn_business_input_links where id=p_link and tenant_id=p_tenant
  and provider='commusoft' and collection='properties' and entity_kind='site'
  and entity_table='sites' and request->>'rule'='commusoft_workaddress_parent_id_v1'
 for update;
 if not found then raise exception 'exact_site_link_unavailable' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=l.connection_id
  and provider='commusoft' and status='configured' and revoked_at is null for update;
 if not found then raise exception 'exact_site_connection_unavailable' using errcode='42501';end if;
 select action into latest_action from public.new_dawn_commusoft_exact_site_events
  where tenant_id=p_tenant and link_id=p_link order by created_at desc,id desc limit 1;
 if latest_action is null then raise exception 'exact_site_event_missing' using errcode='PT409';end if;
 if p_action='reverse' then
  if latest_action='reversed' then return jsonb_build_object('state','already_reversed','link_id',p_link);end if;
  -- A canonical job can remain as retained audit evidence after its exact
  -- link is reversed. Reverse the site only if every referencing job has
  -- exactly one matching exact job link, that link's latest event is reversed,
  -- and no other current link exposes that canonical job.
  if exists(select 1 from public.jobs j where j.tenant_id=p_tenant and j.site_id=l.entity_id
   and (not exists(select 1 from public.learn_business_input_links jl
     join lateral(select e.action from public.new_dawn_commusoft_exact_link_events e
       where e.tenant_id=p_tenant and e.link_id=jl.id
       order by e.created_at desc,e.id desc limit 1) je on true
     where jl.tenant_id=p_tenant and jl.connection_id=l.connection_id
       and jl.provider='commusoft' and jl.collection='jobs'
       and jl.entity_kind='job' and jl.entity_table='jobs' and jl.entity_id=j.id
       and jl.request->>'rule'='commusoft_exact_dual_id_v1'
       and jl.request->>'site_link_id'=p_link::text and je.action='reversed')
    or exists(select 1 from public.learn_business_input_current_links current_job
      where current_job.tenant_id=p_tenant and current_job.entity_kind='job'
       and current_job.entity_table='jobs' and current_job.entity_id=j.id)))
   then return jsonb_build_object('state','review','reason','site_in_use_by_job');end if;
  event_action:='reversed';
 else
  if latest_action<>'reversed' then return jsonb_build_object('state','already_active','link_id',p_link);end if;
  candidate:=public.new_dawn_commusoft_exact_site_candidate(
   p_tenant,l.connection_id,l.external_id,l.id);
  if candidate->>'state'<>'ready' then
   return jsonb_build_object('state','review','reason',candidate->>'reason');end if;
  if candidate->>'site_version_id' is distinct from l.source_version_id::text then
   return jsonb_build_object('state','review','reason','site_source_changed');end if;
  event_action:='restored';
 end if;
 insert into public.new_dawn_commusoft_exact_site_events
  (tenant_id,link_id,action,actor_id,source_version_id,rule,reason)
 values(p_tenant,p_link,event_action,actor,l.source_version_id,
  'commusoft_workaddress_parent_id_v1',btrim(p_reason));
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_sites.exact_site_'||event_action,'sites',l.entity_id::text,
  jsonb_build_object('rule','commusoft_workaddress_parent_id_v1',
   'link_id',p_link,'source_version_id',l.source_version_id),
  btrim(p_reason),audit::text,false,'new-dawn-exact-site');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('state',event_action,'link_id',p_link,'audit_id',audit);
end $$;

-- The UI flag is not an authority boundary. Direct RPC callers must also
-- be unable to create canonical rows before the reviewed dry run is approved.
create or replace function public.new_dawn_commusoft_exact_site_apply(
 p_tenant uuid,p_connection uuid,p_external text,p_version uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='15s' as $$
declare actor uuid:=auth.uid();candidate jsonb;v public.learn_business_input_versions%rowtype;
 site_id uuid;link_id uuid;audit uuid:=gen_random_uuid();namespace text;field text;
 address text;person uuid;company uuid;
begin
 if p_tenant is null or p_connection is null or p_version is null or p_external is null
  or p_external!~'^[1-9][0-9]{0,15}$'
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'exact_site_apply_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_exact_apply' and value='true'::jsonb for share;
 if not found then raise exception 'exact_site_apply_disabled' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'exact_site_tenant_unavailable' using errcode='42501';end if;
 foreach field in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=field
   and value='true'::jsonb for share;
  if not found then raise exception 'exact_site_module_unavailable' using errcode='42501';end if;
 end loop;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant
  and provider='commusoft' and connector_id='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'exact_site_connector_unavailable' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null
  and verified_at<=clock_timestamp() for update;
 if not found then raise exception 'exact_site_connection_unavailable' using errcode='42501';end if;
 candidate:=public.new_dawn_commusoft_exact_site_candidate(p_tenant,p_connection,p_external);
 if candidate->>'state'<>'ready' then
  return jsonb_build_object('state','review','reason',candidate->>'reason');end if;
 if candidate->>'site_version_id' is distinct from p_version::text then
  return jsonb_build_object('state','review','reason','site_source_changed');end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant
  and connection_id=p_connection and provider='commusoft' and collection='properties';
 if not found then return jsonb_build_object('state','review','reason','site_source_missing');end if;
 person:=case when candidate->>'customer_entity_table'='people'
  then (candidate->>'customer_entity_id')::uuid end;
 company:=case when candidate->>'customer_entity_table'='companies'
  then (candidate->>'customer_entity_id')::uuid end;
 namespace:='commusoft:connection:'||p_connection::text;
 address:=public.learn_business_customer_summary(v.payload)->>'address';
 insert into public.sites(tenant_id,source_system,external_id,person_id,company_id,
  label,address_text,postcode,created_source,verified,metadata)
 values(p_tenant,namespace,p_external,person,company,btrim(v.payload->>'addressLine1'),
  address,public.learn_business_input_text(v.payload,'postcode'),
  'business_input:commusoft',false,
  jsonb_build_object('new_dawn_exact_site',jsonb_build_object('rule',
   'commusoft_workaddress_parent_id_v1','connection_id',p_connection,
   'source_version_id',v.id,'parent_source_version_id',candidate->>'customer_version_id')))
 returning id into site_id;
 insert into public.learn_business_input_links
  (tenant_id,connection_id,provider,collection,external_id,source_version_id,
   entity_kind,entity_table,entity_id,card_id,request,actor_id)
 values(p_tenant,p_connection,'commusoft','properties',p_external,p_version,
  'site','sites',site_id,(candidate->>'card_id')::uuid,
  jsonb_build_object('rule','commusoft_workaddress_parent_id_v1',
   'site_source_version_id',p_version,'customer_source_version_id',
   candidate->>'customer_version_id','parent_link_id',candidate->>'customer_link_id',
   'reason',btrim(p_reason)),actor) returning id into link_id;
 insert into public.new_dawn_commusoft_exact_site_events
  (tenant_id,link_id,action,actor_id,source_version_id,rule,reason)
 values(p_tenant,link_id,'linked',actor,p_version,
  'commusoft_workaddress_parent_id_v1',btrim(p_reason));
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_sites.exact_site_project','sites',site_id::text,
  jsonb_build_object('rule','commusoft_workaddress_parent_id_v1',
   'link_id',link_id,'source_version_id',p_version,'connection_id',p_connection),
  btrim(p_reason),audit::text,false,'new-dawn-exact-site');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('state','linked','site_id',site_id,'link_id',link_id,
  'source_version_id',p_version,'audit_id',audit);
end $$;

create or replace function public.new_dawn_commusoft_exact_link_apply(
 p_tenant uuid,p_connection uuid,p_external text,p_version uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog set statement_timeout='15s' as $$
declare actor uuid:=auth.uid();candidate jsonb;v public.learn_business_input_versions%rowtype;
 existing public.learn_business_input_links%rowtype;latest_event text;
 job_id uuid;link_id uuid;audit_id uuid:=gen_random_uuid();
 namespace text;meta jsonb;fields jsonb;required_flag text;
begin
 if p_tenant is null or p_connection is null or p_version is null or p_external is null
  or p_external!~'^[1-9][0-9]{0,15}$' or p_reason is null
  or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'exact_link_apply_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_exact_apply' and value='true'::jsonb for share;
 if not found then raise exception 'exact_link_apply_disabled' using errcode='42501';end if;
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'exact_link_tenant_unavailable' using errcode='42501';end if;
 foreach required_flag in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant
   and flag=required_flag and value='true'::jsonb for share;
  if not found then raise exception 'exact_link_module_unavailable' using errcode='42501';end if;
 end loop;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and provider='commusoft'
  and connector_id='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'exact_link_connector_unavailable' using errcode='42501';end if;
 select * into existing from public.learn_business_input_links where tenant_id=p_tenant
  and connection_id=p_connection and provider='commusoft' and collection='jobs'
  and external_id=p_external;
 if found then
  if existing.request->>'rule'='commusoft_exact_dual_id_v1'
   and existing.source_version_id=p_version then
   select action into latest_event from public.new_dawn_commusoft_exact_link_events
    where tenant_id=p_tenant and link_id=existing.id
    order by created_at desc,id desc limit 1;
   if latest_event='reversed' then
    return jsonb_build_object('state','review','reason','prior_auto_link_reversed',
     'link_id',existing.id);end if;
   return jsonb_build_object('state','already_linked','link_id',existing.id,
    'job_id',existing.entity_id,'version_id',p_version);end if;
  return jsonb_build_object('state','review','reason','job_already_linked');end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null
  and verified_at<=clock_timestamp() for update;
 if not found then raise exception 'exact_link_connection_unavailable' using errcode='42501';end if;
 candidate:=public.new_dawn_commusoft_exact_link_candidate(p_tenant,p_connection,p_external);
 if candidate->>'state'<>'ready' then
  return jsonb_build_object('state','review','reason',candidate->>'reason');end if;
 if candidate->>'job_version_id' is distinct from p_version::text then
  return jsonb_build_object('state','review','reason','job_source_changed');end if;
 select * into v from public.learn_business_input_versions where id=p_version
  and tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
  and collection='jobs' and external_id=p_external;
 if not found then raise exception 'exact_link_source_changed' using errcode='PT409';end if;
 fields:=candidate->'fields';namespace:='commusoft:connection:'||p_connection::text;
 meta:=jsonb_build_object('learn_business_input',jsonb_build_object(
  'connection_id',p_connection,'source_version_id',p_version,
  'property_external_id',candidate->>'property_external_id',
  'relationships',jsonb_build_object('person_id',case when candidate->>'customer_entity_table'='people' then candidate->'customer_entity_id' end,
   'company_id',case when candidate->>'customer_entity_table'='companies' then candidate->'customer_entity_id' end,
   'site_id',candidate->'site_id','card_id',candidate->'card_id'),
  'timestamps',coalesce(candidate->'timestamps','{}'::jsonb)),
  'new_dawn_exact_link',jsonb_build_object('rule','commusoft_exact_dual_id_v1',
   'audit_id',audit_id,'customer_source_version_id',candidate->'customer_version_id',
   'property_source_version_id',candidate->'property_version_id'));
 insert into public.jobs(tenant_id,source_system,external_id,job_number,
  customer_person_id,customer_company_id,site_id,title,description,status,
  created_date,completed_date,created_source,verified,metadata)
 values(p_tenant,namespace,p_external,p_external,
  case when candidate->>'customer_entity_table'='people' then (candidate->>'customer_entity_id')::uuid end,
  case when candidate->>'customer_entity_table'='companies' then (candidate->>'customer_entity_id')::uuid end,
  (candidate->>'site_id')::uuid,fields->>'title',fields->>'description',fields->>'status',
  nullif(fields->>'created_date','')::timestamptz,
  nullif(fields->>'completed_date','')::timestamptz,
  'business_input:commusoft',false,meta) returning id into job_id;
 insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,
  external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
 values(p_tenant,p_connection,'commusoft','jobs',p_external,p_version,'job','jobs',job_id,
  (candidate->>'card_id')::uuid,jsonb_build_object('rule','commusoft_exact_dual_id_v1',
   'reason',btrim(p_reason),'job_source_version_id',p_version,
   'customer_source_version_id',candidate->'customer_version_id',
   'property_source_version_id',candidate->'property_version_id',
   'customer_link_id',candidate->'customer_link_id','site_link_id',candidate->'site_link_id',
   'audit_id',audit_id),actor) returning id into link_id;
 insert into public.new_dawn_commusoft_exact_link_events
  (tenant_id,link_id,action,actor_id,source_version_id,rule,reason)
 values(p_tenant,link_id,'linked',actor,p_version,'commusoft_exact_dual_id_v1',btrim(p_reason));
 perform public.learn_operator_input_access(p_tenant,actor,true);
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_jobs.exact_dual_id_auto_link','job',job_id::text,
  jsonb_build_object('rule','commusoft_exact_dual_id_v1','link_id',link_id,
   'job_source_version_id',p_version,
   'customer_source_version_id',candidate->'customer_version_id',
   'property_source_version_id',candidate->'property_version_id',
   'customer_link_id',candidate->'customer_link_id','site_link_id',candidate->'site_link_id'),
  btrim(p_reason),audit_id::text,false,'new-dawn-exact-dual-id');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('state','linked','rule','commusoft_exact_dual_id_v1',
  'job_id',job_id,'link_id',link_id,'audit_id',audit_id,'version_id',p_version);
end $$;

commit;
