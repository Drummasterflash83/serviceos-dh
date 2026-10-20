-- An OpenFolk operator may project a saved Commusoft job only when its current
-- customer and work-address IDs independently resolve to one existing customer
-- and site. No provider read, inferred name/address match or automatic backfill.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';

create table public.new_dawn_commusoft_exact_link_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 link_id uuid not null references public.learn_business_input_links(id) on delete restrict,
 action text not null check(action in ('linked','reversed','restored')),
 actor_id uuid not null references public.profiles(id),
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 rule text not null check(rule='commusoft_exact_dual_id_v1'),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create index new_dawn_commusoft_exact_link_events_latest
 on public.new_dawn_commusoft_exact_link_events(tenant_id,link_id,created_at desc,id desc);
alter table public.new_dawn_commusoft_exact_link_events enable row level security;
revoke all on public.new_dawn_commusoft_exact_link_events from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.new_dawn_commusoft_exact_link_events
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_commusoft_exact_link_events
 for each statement execute function public.learn_business_input_retain();

-- A reversal removes this auto-link from the canonical current-links view.
-- The original link, canonical job and evidence remain for audit.
create or replace view public.learn_business_input_current_links as
 select l.id,l.tenant_id,l.connection_id,l.provider,l.collection,l.external_id,
  coalesce(r.source_version_id,l.source_version_id) source_version_id,
  l.entity_kind,l.entity_table,l.entity_id,l.card_id,l.request,l.actor_id,l.created_at
 from public.learn_business_input_links l left join lateral(
  select x.source_version_id from public.learn_business_input_refreshes x
  where x.tenant_id=l.tenant_id and x.link_id=l.id order by x.revision desc limit 1
 )r on true
 left join lateral (
  select e.action from public.new_dawn_commusoft_exact_link_events e
  where e.tenant_id=l.tenant_id and e.link_id=l.id
  order by e.created_at desc,e.id desc limit 1
 ) exact_event on true
 where exact_event.action is distinct from 'reversed';

-- Internal classifier. The public entrypoints below own authentication and
-- tenant selection; no role receives direct EXECUTE on this helper.
create function public.new_dawn_commusoft_exact_link_candidate(
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
 select * into site_link from public.learn_business_input_current_links
  where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and collection='properties' and external_id=property_ref;
 if not found or site_link.entity_kind is distinct from 'site'
  or site_link.entity_table is distinct from 'sites'
  or site_link.source_version_id is distinct from property.id then
  return jsonb_build_object('state','review','reason','site_mapping_missing_or_stale');end if;
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
revoke all on function public.new_dawn_commusoft_exact_link_candidate(uuid,uuid,text,uuid)
 from public,anon,authenticated,service_role;

-- Keyset page is the durable operator review queue. It includes every saved
-- unlinked job, not just the recent 24-hour operator preview.
create function public.new_dawn_commusoft_exact_link_review_page(
 p_tenant uuid,p_connection uuid,p_after text default null,p_limit integer default 50,p_reason text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog set statement_timeout='20s' as $$
declare actor uuid:=auth.uid();entries jsonb;next_cursor text;more boolean;checked timestamptz;
 audit_id uuid:=gen_random_uuid();
begin
 if p_tenant is null or p_connection is null or p_limit is null or p_limit not between 1 and 100
  or (p_after is not null and p_after!~'^[1-9][0-9]{0,15}$')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'exact_link_review_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null for share;
 if not found then raise exception 'exact_link_connection_unavailable' using errcode='42501';end if;
 with identities as materialized (
  select distinct v.external_id collate "C" external_id from public.learn_business_input_versions v
  where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft'
   and v.collection='jobs' and (p_after is null or v.external_id collate "C">p_after collate "C")
   and not exists(select 1 from public.learn_business_input_current_links l
    where l.tenant_id=p_tenant and l.connection_id=p_connection and l.provider='commusoft'
     and l.collection='jobs' and l.external_id=v.external_id)
 ), page as materialized (
  select external_id from identities order by external_id collate "C" limit p_limit+1
 ), ranked as (
  select external_id,row_number() over(order by external_id collate "C") ordinal from page
 ), classified as (
  select r.external_id,r.ordinal,
   public.new_dawn_commusoft_exact_link_candidate(p_tenant,p_connection,r.external_id) candidate
  from ranked r where r.ordinal<=p_limit
 )
 select coalesce(jsonb_agg(jsonb_build_object('external_id',external_id,
   'state',candidate->>'state','reason',candidate->>'reason',
   'source_version_id',candidate->'job_version_id') order by ordinal),'[]'::jsonb),
  (select count(*)>p_limit from page),max(external_id) filter(where ordinal=p_limit)
 into entries,more,next_cursor from classified;
 if more and next_cursor is null then
  select max(external_id) into next_cursor from (select external_id from page
   order by external_id collate "C" limit p_limit) x;end if;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_jobs.exact_link_review_page','jobs',p_connection::text,
  jsonb_build_object('returned_count',jsonb_array_length(entries),'after',p_after,
   'next_cursor',case when more then next_cursor end),btrim(p_reason),audit_id::text,
  false,'new-dawn-exact-dual-id');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-exact-link-review/1',
  'tenant_id',p_tenant,'connection_id',p_connection,'actor_id',actor,
  'audit_id',audit_id,'observed_at',checked,'rows',entries,
  'next_cursor',case when more then next_cursor end);
end $$;
revoke all on function public.new_dawn_commusoft_exact_link_review_page(uuid,uuid,text,integer,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_commusoft_exact_link_review_page(uuid,uuid,text,integer,text)
 to authenticated;

create function public.new_dawn_commusoft_exact_link_apply(
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
revoke all on function public.new_dawn_commusoft_exact_link_apply(uuid,uuid,text,uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_commusoft_exact_link_apply(uuid,uuid,text,uuid,text)
 to authenticated;

create function public.new_dawn_commusoft_exact_link_toggle(
 p_tenant uuid,p_link uuid,p_action text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();link public.learn_business_input_links%rowtype;
 current_action text;candidate jsonb;audit_id uuid:=gen_random_uuid();
begin
 if p_tenant is null or p_link is null or p_action not in ('reverse','restore')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'exact_link_toggle_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 select * into link from public.learn_business_input_links where id=p_link and tenant_id=p_tenant
  and provider='commusoft' and collection='jobs' and entity_kind='job'
  and request->>'rule'='commusoft_exact_dual_id_v1' for share;
 if not found then raise exception 'exact_link_unavailable' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=link.connection_id
  and provider='commusoft' for update;
 if not found then raise exception 'exact_link_connection_unavailable' using errcode='42501';end if;
 if p_action='restore' and not exists(select 1 from public.provider_connections
  where tenant_id=p_tenant and id=link.connection_id and provider='commusoft'
   and status='configured' and revoked_at is null and verified_at<=clock_timestamp()) then
  return jsonb_build_object('state','review','reason','connection_not_ready_for_restore');end if;
 if p_action='restore' and (not exists(select 1 from public.tenants
  where id=p_tenant and status='active')
  or not exists(select 1 from public.feature_flags where tenant_id=p_tenant
   and flag='learn.enabled' and value='true'::jsonb)
  or not exists(select 1 from public.feature_flags where tenant_id=p_tenant
   and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb)
  or not exists(select 1 from public.tenant_connectors where tenant_id=p_tenant
   and provider='commusoft' and connector_id='commusoft'
   and enabled and status='active')) then
  return jsonb_build_object('state','review','reason','tenant_source_not_ready_for_restore');end if;
 select action into current_action from public.new_dawn_commusoft_exact_link_events
  where tenant_id=p_tenant and link_id=p_link order by created_at desc,id desc limit 1;
 if current_action is null then raise exception 'exact_link_event_missing' using errcode='PT409';end if;
 if p_action='reverse' and current_action='reversed'
  or p_action='restore' and current_action in ('linked','restored') then
  return jsonb_build_object('state',current_action,'link_id',p_link,'already',true);end if;
 if p_action='restore' then
  candidate:=public.new_dawn_commusoft_exact_link_candidate(
   p_tenant,link.connection_id,link.external_id,p_link);
  if candidate->>'state'<>'ready'
   or candidate->>'job_version_id' is distinct from link.source_version_id::text
   or candidate->>'customer_link_id' is distinct from link.request->>'customer_link_id'
   or candidate->>'site_link_id' is distinct from link.request->>'site_link_id'
   or not exists(select 1 from public.jobs j where j.tenant_id=p_tenant
    and j.id=link.entity_id and j.site_id=(candidate->>'site_id')::uuid
    and ((candidate->>'customer_entity_table'='people' and
      j.customer_person_id=(candidate->>'customer_entity_id')::uuid and j.customer_company_id is null)
     or (candidate->>'customer_entity_table'='companies' and
      j.customer_company_id=(candidate->>'customer_entity_id')::uuid and j.customer_person_id is null))) then
   return jsonb_build_object('state','review','reason','restore_source_or_identity_changed');end if;
 end if;
 insert into public.new_dawn_commusoft_exact_link_events
  (tenant_id,link_id,action,actor_id,source_version_id,rule,reason)
 values(p_tenant,p_link,case when p_action='reverse' then 'reversed' else 'restored' end,
  actor,link.source_version_id,'commusoft_exact_dual_id_v1',btrim(p_reason));
 perform public.learn_operator_input_access(p_tenant,actor,true);
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,
  case when p_action='reverse' then 'client_jobs.exact_dual_id_link_reversed'
   else 'client_jobs.exact_dual_id_link_restored' end,
  'job',link.entity_id::text,jsonb_build_object('link_id',p_link,
   'job_source_version_id',link.source_version_id,'rule','commusoft_exact_dual_id_v1'),
  btrim(p_reason),audit_id::text,false,'new-dawn-exact-dual-id');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('state',case when p_action='reverse' then 'reversed' else 'restored' end,
  'link_id',p_link,'audit_id',audit_id);
end $$;
revoke all on function public.new_dawn_commusoft_exact_link_toggle(uuid,uuid,text,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_commusoft_exact_link_toggle(uuid,uuid,text,text)
 to authenticated;
commit;
