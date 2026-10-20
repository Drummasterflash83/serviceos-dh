-- Audited, fail-closed reversal of reviewed Commusoft customer source links.
-- Installation creates no customer, site, job, link, event or provider read.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';

create table public.new_dawn_commusoft_customer_link_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 link_id uuid not null references public.learn_business_input_links(id) on delete restrict,
 action text not null check(action in ('reversed','restored')),
 actor_id uuid not null references public.profiles(id),
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create index new_dawn_commusoft_customer_link_events_latest
 on public.new_dawn_commusoft_customer_link_events(tenant_id,link_id,created_at desc,id desc);
alter table public.new_dawn_commusoft_customer_link_events enable row level security;
revoke all on public.new_dawn_commusoft_customer_link_events
 from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.new_dawn_commusoft_customer_link_events
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_commusoft_customer_link_events
 for each statement execute function public.learn_business_input_retain();

-- The existing view is intentionally private: its grants remain revoked from
-- public/anon/authenticated/service_role. Add only the customer event filter;
-- preserve its refresh, exact job and exact site semantics and column contract.
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
 left join lateral(
  select e.action from public.new_dawn_commusoft_customer_link_events e
  where e.tenant_id=l.tenant_id and e.link_id=l.id
  order by e.created_at desc,e.id desc limit 1
 ) customer_event on true
 where job_event.action is distinct from 'reversed'
  and site_event.action is distinct from 'reversed'
  and customer_event.action is distinct from 'reversed';
revoke all on public.learn_business_input_current_links
 from public,anon,authenticated,service_role;
grant select on public.learn_business_input_current_links to learn_card_communication_reader;

create function public.new_dawn_commusoft_customer_link_toggle(
 p_tenant uuid,p_link uuid,p_action text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='15s' as $$
declare actor uuid:=auth.uid();l public.learn_business_input_links%rowtype;
 latest_action text;source public.learn_business_input_versions%rowtype;
 target_ok boolean;card_ok boolean;audit uuid:=gen_random_uuid();event_action text;
begin
 if p_tenant is null or p_link is null or p_action not in ('reverse','restore')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'customer_link_toggle_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 -- Lock the connection before the link, matching source publication and
 -- reviewed customer creation. Site/job applies lock this connection too.
 select * into l from public.learn_business_input_links where id=p_link and tenant_id=p_tenant
  and provider='commusoft' and collection='properties' and entity_kind='customer'
  and entity_table in ('people','companies');
 if not found then raise exception 'customer_link_unavailable' using errcode='42501';end if;
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=l.connection_id
  and provider='commusoft' for update;
 if not found then raise exception 'customer_connection_unavailable' using errcode='42501';end if;
 select * into l from public.learn_business_input_links where id=p_link and tenant_id=p_tenant
  and provider='commusoft' and collection='properties' and entity_kind='customer'
  and entity_table in ('people','companies') for update;
 if not found then raise exception 'customer_link_unavailable' using errcode='42501';end if;
 select action into latest_action from public.new_dawn_commusoft_customer_link_events
  where tenant_id=p_tenant and link_id=p_link order by created_at desc,id desc limit 1;
 if p_action='reverse' then
  if latest_action='reversed' then
   return jsonb_build_object('state','already_reversed','link_id',p_link);end if;
  -- Never withdraw a parent identity while a current site/job still relies
  -- on the same reviewed card or explicitly records this parent link.
  if exists(select 1 from public.learn_business_input_current_links dependent
   where dependent.tenant_id=p_tenant and dependent.connection_id=l.connection_id
    and dependent.provider='commusoft' and dependent.id<>l.id
    and dependent.entity_kind in ('site','job')
    and (dependent.card_id=l.card_id
     or dependent.request->>'parent_link_id'=l.id::text
     or dependent.request->>'customer_link_id'=l.id::text)) then
   return jsonb_build_object('state','review','reason','customer_link_in_use');end if;
  event_action:='reversed';
 else
  if latest_action is distinct from 'reversed' then
   return jsonb_build_object('state','already_active','link_id',p_link);end if;
  if not exists(select 1 from public.provider_connections where tenant_id=p_tenant
   and id=l.connection_id and provider='commusoft' and status='configured'
   and revoked_at is null and verified_at<=clock_timestamp())
   or not exists(select 1 from public.tenants where id=p_tenant and status='active')
   or not exists(select 1 from public.feature_flags where tenant_id=p_tenant
    and flag='learn.enabled' and value='true'::jsonb)
   or not exists(select 1 from public.feature_flags where tenant_id=p_tenant
    and flag='learn.inputs.commusoft.enabled' and value='true'::jsonb)
   or not exists(select 1 from public.tenant_connectors where tenant_id=p_tenant
    and provider='commusoft' and connector_id='commusoft' and enabled and status='active') then
   return jsonb_build_object('state','review','reason','source_not_ready_for_restore');end if;
  source:=public.learn_business_input_latest(p_tenant,l.connection_id,
   'commusoft','properties',l.external_id);
  if source.id is null or source.id is distinct from l.source_version_id
   or source.payload->>'type' is distinct from 'customer'
   or jsonb_typeof(source.payload->'id') is distinct from 'number'
   or source.payload->>'id' is distinct from l.external_id then
   return jsonb_build_object('state','review','reason','customer_source_changed');end if;
  select exists(select 1 from public.people p where p.tenant_id=p_tenant and p.id=l.entity_id
    and l.entity_table='people') or exists(select 1 from public.companies c
     where c.tenant_id=p_tenant and c.id=l.entity_id and l.entity_table='companies')
   into target_ok;
  select exists(select 1 from public.customer_cards cc where cc.tenant_id=p_tenant
   and cc.id=l.card_id and ((l.entity_table='people' and cc.person_id=l.entity_id)
    or (l.entity_table='companies' and cc.company_id=l.entity_id
     and cc.person_id is null))) into card_ok;
  if not target_ok or not card_ok then
   return jsonb_build_object('state','review','reason','customer_target_changed');end if;
  event_action:='restored';
 end if;
 insert into public.new_dawn_commusoft_customer_link_events
  (tenant_id,link_id,action,actor_id,source_version_id,reason)
 values(p_tenant,p_link,event_action,actor,l.source_version_id,btrim(p_reason));
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_customers.source_link_'||event_action,
  'customer',l.entity_id::text,jsonb_build_object('link_id',l.id,
   'source_version_id',l.source_version_id,'entity_table',l.entity_table),
  btrim(p_reason),audit::text,false,'new-dawn-customer-link');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('state',event_action,'link_id',l.id,'audit_id',audit);
end $$;
revoke all on function public.new_dawn_commusoft_customer_link_toggle(uuid,uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_commusoft_customer_link_toggle(uuid,uuid,text,text)
 to authenticated;
commit;
