-- Operator-reviewed workaddress projection from exact current Commusoft IDs.
-- Installing this migration creates no sites, customer links, jobs or provider reads.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';

create table public.new_dawn_commusoft_exact_site_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 link_id uuid not null references public.learn_business_input_links(id) on delete restrict,
 action text not null check(action in ('linked','reversed','restored')),
 actor_id uuid not null references public.profiles(id),
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 rule text not null check(rule='commusoft_workaddress_parent_id_v1'),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create index new_dawn_commusoft_exact_site_events_latest
 on public.new_dawn_commusoft_exact_site_events(tenant_id,link_id,created_at desc,id desc);
alter table public.new_dawn_commusoft_exact_site_events enable row level security;
revoke all on public.new_dawn_commusoft_exact_site_events from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.new_dawn_commusoft_exact_site_events
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_commusoft_exact_site_events
 for each statement execute function public.learn_business_input_retain();

-- Existing job reversals remain effective. Site reversal hides the reviewed
-- property link but retains the canonical site and the complete audit chain.
create or replace view public.learn_business_input_current_links as
 select l.id,l.tenant_id,l.connection_id,l.provider,l.collection,l.external_id,
  coalesce(r.source_version_id,l.source_version_id) source_version_id,
  l.entity_kind,l.entity_table,l.entity_id,l.card_id,l.request,l.actor_id,l.created_at
 from public.learn_business_input_links l left join lateral(
  select x.source_version_id from public.learn_business_input_refreshes x
  where x.tenant_id=l.tenant_id and x.link_id=l.id order by x.revision desc limit 1
 )r on true
 left join lateral(
  select e.action from public.new_dawn_commusoft_exact_link_events e
  where e.tenant_id=l.tenant_id and e.link_id=l.id
  order by e.created_at desc,e.id desc limit 1
 ) job_event on true
 left join lateral(
  select e.action from public.new_dawn_commusoft_exact_site_events e
  where e.tenant_id=l.tenant_id and e.link_id=l.id
  order by e.created_at desc,e.id desc limit 1
 ) site_event on true
 where job_event.action is distinct from 'reversed'
  and site_event.action is distinct from 'reversed';

-- Internal classifier. Every reference comes from retained current source in
-- one connection, never from names, address similarity or displayed job codes.
create function public.new_dawn_commusoft_exact_site_candidate(
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
revoke all on function public.new_dawn_commusoft_exact_site_candidate(uuid,uuid,text,uuid)
 from public,anon,authenticated,service_role;

create function public.new_dawn_commusoft_exact_site_review_page(
 p_tenant uuid,p_connection uuid,p_after text default null,p_limit integer default 50,
 p_reason text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='20s' as $$
declare actor uuid:=auth.uid();rows jsonb;cursor text;more boolean;audit uuid:=gen_random_uuid();
begin
 if p_tenant is null or p_connection is null or p_limit is null or p_limit not between 1 and 100
  or (p_after is not null and p_after!~'^[1-9][0-9]{0,15}$')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'exact_site_review_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null for share;
 if not found then raise exception 'exact_site_connection_unavailable' using errcode='42501';end if;
 with identities as materialized(
  select distinct v.external_id collate "C" external_id from public.learn_business_input_versions v
  where v.tenant_id=p_tenant and v.connection_id=p_connection and v.provider='commusoft'
   and v.collection='properties' and v.payload->>'type'='workaddress'
   and (p_after is null or v.external_id collate "C">p_after collate "C")
   and not exists(select 1 from public.learn_business_input_current_links l
    where l.tenant_id=p_tenant and l.connection_id=p_connection
     and l.provider='commusoft' and l.collection='properties' and l.external_id=v.external_id)
 ), page as materialized(
  select external_id from identities order by external_id collate "C" limit p_limit+1
 ), numbered as(
  select external_id,row_number() over(order by external_id collate "C") ordinal from page
 ), classified as(
  select n.external_id,n.ordinal,
   public.new_dawn_commusoft_exact_site_candidate(p_tenant,p_connection,n.external_id) candidate
  from numbered n where n.ordinal<=p_limit
 )
 select coalesce(jsonb_agg(jsonb_build_object('external_id',external_id,
  'state',candidate->>'state','reason',candidate->>'reason',
  'source_version_id',candidate->'site_version_id') order by ordinal),'[]'::jsonb),
  (select count(*)>p_limit from page),max(external_id) filter(where ordinal=p_limit)
 into rows,more,cursor from classified;
 perform public.learn_operator_input_access(p_tenant,actor,false);
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_sites.exact_site_review_page','sites',p_connection::text,
  jsonb_build_object('returned_count',jsonb_array_length(rows),'after',p_after,
   'next_cursor',case when more then cursor end),
  btrim(p_reason),audit::text,false,'new-dawn-exact-site');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-exact-site-review/1','tenant_id',p_tenant,
  'connection_id',p_connection,'audit_id',audit,'rows',rows,
  'next_cursor',case when more then cursor end);
end $$;
revoke all on function public.new_dawn_commusoft_exact_site_review_page(uuid,uuid,text,integer,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_commusoft_exact_site_review_page(uuid,uuid,text,integer,text)
 to authenticated;

create function public.new_dawn_commusoft_exact_site_apply(
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
revoke all on function public.new_dawn_commusoft_exact_site_apply(uuid,uuid,text,uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_commusoft_exact_site_apply(uuid,uuid,text,uuid,text)
 to authenticated;

create function public.new_dawn_commusoft_exact_site_toggle(
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
  -- A canonical job may already rely on this site; review that job first.
  if exists(select 1 from public.jobs j where j.tenant_id=p_tenant and j.site_id=l.entity_id)
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
revoke all on function public.new_dawn_commusoft_exact_site_toggle(uuid,uuid,text,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_commusoft_exact_site_toggle(uuid,uuid,text,text)
 to authenticated;
commit;
