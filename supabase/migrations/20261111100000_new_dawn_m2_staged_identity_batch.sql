-- Private, exact-source staged projection. Installation creates no canonical
-- customer, site, job or source link and enables no batch or provider call.
begin;
set local lock_timeout='3s';
set local statement_timeout='90s';

create table public.new_dawn_m2_identity_batches (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 actor_id uuid not null references public.profiles(id),
 manifest_sha256 text not null check(manifest_sha256~'^[0-9a-f]{64}$'),
 kind_map jsonb not null check(jsonb_typeof(kind_map)='object'),
 kind_evidence_sha256 text not null check(kind_evidence_sha256~'^[0-9a-f]{64}$'),
 item_count integer not null check(item_count between 1 and 2000),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 unique(tenant_id,connection_id,manifest_sha256)
);
alter table public.new_dawn_m2_identity_batches enable row level security;
revoke all on public.new_dawn_m2_identity_batches from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.new_dawn_m2_identity_batches
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_m2_identity_batches
 for each statement execute function public.learn_business_input_retain();

create table public.new_dawn_m2_identity_items (
 batch_id uuid not null references public.new_dawn_m2_identity_batches(id),
 ordinal integer not null check(ordinal between 1 and 2000),
 tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('customer','site','job')),
 shape text not null check(shape in ('customer','direct','workaddress')),
 external_id text not null check(external_id~'^[1-9][0-9]{0,15}$'),
 source_version_id uuid not null references public.learn_business_input_versions(id),
 customer_external_id text check(customer_external_id is null or
  customer_external_id~'^[1-9][0-9]{0,15}$'),
 property_external_id text check(property_external_id is null or
  property_external_id~'^[1-9][0-9]{0,15}$'),
 customer_kind text check(customer_kind is null or customer_kind in ('person','company')),
 state text not null default 'prepared' check(state in ('prepared','linked','held','reversed')),
 hold_reason text,
 entity_id uuid,
 link_id uuid,
 audit_id uuid,
 applied_at timestamptz,
 primary key(batch_id,ordinal),
 unique(batch_id,kind,external_id),
 check((kind='customer' and shape='customer' and customer_kind is not null
   and customer_external_id is null and property_external_id is null)
  or (kind='site' and shape in ('direct','workaddress')
   and customer_kind is null and customer_external_id is not null
   and property_external_id is null)
  or (kind='job' and shape in ('direct','workaddress')
   and customer_kind is null and customer_external_id is not null
   and property_external_id is not null))
);
create index new_dawn_m2_identity_items_state
 on public.new_dawn_m2_identity_items(batch_id,state,ordinal);
alter table public.new_dawn_m2_identity_items enable row level security;
revoke all on public.new_dawn_m2_identity_items from public,anon,authenticated,service_role;
create trigger retain_rows before delete on public.new_dawn_m2_identity_items
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_m2_identity_items
 for each statement execute function public.learn_business_input_retain();

-- The canonical property link remains unique. A direct customer property has
-- one customer link there; its own site identity lives only in this mapping.
create table public.new_dawn_m2_direct_sites (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 connection_id uuid not null references public.provider_connections(id),
 property_external_id text not null check(property_external_id~'^[1-9][0-9]{0,15}$'),
 source_version_id uuid not null references public.learn_business_input_versions(id),
 customer_link_id uuid not null references public.learn_business_input_links(id),
 site_id uuid not null references public.sites(id),
 card_id uuid not null references public.customer_cards(id),
 batch_id uuid not null references public.new_dawn_m2_identity_batches(id),
 item_ordinal integer not null,
 actor_id uuid not null references public.profiles(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,connection_id,property_external_id),
 unique(tenant_id,site_id),
 foreign key(batch_id,item_ordinal)
  references public.new_dawn_m2_identity_items(batch_id,ordinal)
);
alter table public.new_dawn_m2_direct_sites enable row level security;
revoke all on public.new_dawn_m2_direct_sites from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.new_dawn_m2_direct_sites
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_m2_direct_sites
 for each statement execute function public.learn_business_input_retain();

create table public.new_dawn_m2_direct_site_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 mapping_id uuid not null references public.new_dawn_m2_direct_sites(id),
 action text not null check(action in ('linked','reversed','restored')),
 actor_id uuid not null references public.profiles(id),
 source_version_id uuid not null references public.learn_business_input_versions(id),
 batch_id uuid not null references public.new_dawn_m2_identity_batches(id),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create index new_dawn_m2_direct_site_events_latest
 on public.new_dawn_m2_direct_site_events(tenant_id,mapping_id,created_at desc,id desc);
alter table public.new_dawn_m2_direct_site_events enable row level security;
revoke all on public.new_dawn_m2_direct_site_events from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.new_dawn_m2_direct_site_events
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_m2_direct_site_events
 for each statement execute function public.learn_business_input_retain();

create view public.new_dawn_m2_current_direct_sites as
 select m.* from public.new_dawn_m2_direct_sites m
 join lateral(select e.action from public.new_dawn_m2_direct_site_events e
   where e.tenant_id=m.tenant_id and e.mapping_id=m.id
   order by e.created_at desc,e.id desc limit 1) latest on latest.action<>'reversed';
revoke all on public.new_dawn_m2_current_direct_sites
 from public,anon,authenticated,service_role;

create table public.new_dawn_m2_direct_job_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 link_id uuid not null references public.learn_business_input_links(id),
 action text not null check(action in ('linked','reversed','restored')),
 actor_id uuid not null references public.profiles(id),
 source_version_id uuid not null references public.learn_business_input_versions(id),
 batch_id uuid not null references public.new_dawn_m2_identity_batches(id),
 reason text not null check(length(btrim(reason)) between 3 and 500),
 created_at timestamptz not null default clock_timestamp()
);
create index new_dawn_m2_direct_job_events_latest
 on public.new_dawn_m2_direct_job_events(tenant_id,link_id,created_at desc,id desc);
alter table public.new_dawn_m2_direct_job_events enable row level security;
revoke all on public.new_dawn_m2_direct_job_events from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.new_dawn_m2_direct_job_events
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.new_dawn_m2_direct_job_events
 for each statement execute function public.learn_business_input_retain();

-- Preserve every existing reversal filter and the private view's column/grant
-- contract while adding the direct-property job event.
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
 ) job_event on true
 left join lateral (
  select e.action from public.new_dawn_commusoft_exact_site_events e
  where e.tenant_id=l.tenant_id and e.link_id=l.id
  order by e.created_at desc,e.id desc limit 1
 ) site_event on true
 left join lateral (
  select e.action from public.new_dawn_commusoft_customer_link_events e
  where e.tenant_id=l.tenant_id and e.link_id=l.id
  order by e.created_at desc,e.id desc limit 1
 ) customer_event on true
 left join lateral (
  select e.action from public.new_dawn_m2_direct_job_events e
  where e.tenant_id=l.tenant_id and e.link_id=l.id
  order by e.created_at desc,e.id desc limit 1
 ) direct_event on true
 where job_event.action is distinct from 'reversed'
  and site_event.action is distinct from 'reversed'
  and customer_event.action is distinct from 'reversed'
  and direct_event.action is distinct from 'reversed';
revoke all on public.learn_business_input_current_links
 from public,anon,authenticated,service_role;
grant select on public.learn_business_input_current_links to learn_card_communication_reader;

-- Registration pins a private manifest before the service-role runner can
-- act. Only an authenticated, authorised OpenFolk operator can register it.
-- The category mapping is separately reviewed evidence, not an inference
-- from a numeric ID, company name or the old export alone.
create function public.new_dawn_m2_identity_batch_register(
 p_batch uuid,p_tenant uuid,p_connection uuid,p_items jsonb,
 p_kind_map jsonb,p_kind_evidence_sha256 text,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
 set statement_timeout='90s' as $$
declare actor uuid:=auth.uid();item jsonb;v public.learn_business_input_versions%rowtype;
 n integer;ordinal integer:=0;rank integer;last_rank integer:=0;
 kind text;shape text;external text;source_version uuid;customer_external text;
 property_external text;customer_kind text;category text;digest text;
 existing public.new_dawn_m2_identity_batches%rowtype;
 audit uuid:=gen_random_uuid();map_key text;map_value jsonb;
begin
 if p_batch is null or p_tenant is null or p_connection is null
  or p_items is null or jsonb_typeof(p_items) is distinct from 'array'
  or p_kind_map is null or jsonb_typeof(p_kind_map) is distinct from 'object'
  or p_kind_evidence_sha256 is null or p_kind_evidence_sha256!~'^[0-9a-f]{64}$'
  or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'staged_batch_invalid' using errcode='22023';end if;
 n:=jsonb_array_length(p_items);
 if n not between 1 and 2000 then
  raise exception 'staged_batch_count_invalid' using errcode='22023';end if;
 if (select count(*) from jsonb_object_keys(p_kind_map)) not between 1 and 50 then
  raise exception 'staged_kind_map_invalid' using errcode='22023';end if;
 for map_key,map_value in select key,value from jsonb_each(p_kind_map) loop
  if map_key!~'^[1-9][0-9]{0,8}$' or jsonb_typeof(map_value)<>'string'
   or map_value #>> '{}' not in ('person','company') then
   raise exception 'staged_kind_map_invalid' using errcode='22023';end if;
 end loop;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=p_connection
  and provider='commusoft' and status='configured' and revoked_at is null for share;
 if not found then raise exception 'staged_connection_unavailable' using errcode='42501';end if;
 digest:=encode(sha256(convert_to(jsonb_build_object('items',p_items,
  'kind_map',p_kind_map,'kind_evidence_sha256',p_kind_evidence_sha256)::text,'UTF8')),'hex');
 select * into existing from public.new_dawn_m2_identity_batches where id=p_batch;
 if found then
  if existing.tenant_id=p_tenant and existing.connection_id=p_connection
   and existing.actor_id=actor and existing.manifest_sha256=digest
   and existing.item_count=n then
   return jsonb_build_object('state','already_prepared','batch_id',p_batch,
    'manifest_sha256',digest,'item_count',n);end if;
  raise exception 'staged_batch_identity_conflict' using errcode='PT409';end if;
 insert into public.new_dawn_m2_identity_batches
  (id,tenant_id,connection_id,actor_id,manifest_sha256,kind_map,
   kind_evidence_sha256,item_count,reason,expires_at)
 values(p_batch,p_tenant,p_connection,actor,digest,p_kind_map,
  p_kind_evidence_sha256,n,btrim(p_reason),clock_timestamp()+interval '48 hours');
 for item in select value from jsonb_array_elements(p_items) loop
  ordinal:=ordinal+1;
  if jsonb_typeof(item) is distinct from 'object'
   or (select count(*) from jsonb_object_keys(item))<>7
   or not(item ?& array['kind','shape','external_id','source_version_id',
    'customer_external_id','property_external_id','customer_kind']) then
   raise exception 'staged_item_shape_invalid' using errcode='22023';end if;
  kind:=item->>'kind';shape:=item->>'shape';external:=item->>'external_id';
  customer_external:=item->>'customer_external_id';
  property_external:=item->>'property_external_id';
  customer_kind:=item->>'customer_kind';
  if kind not in ('customer','site','job')
   or external is null or external!~'^[1-9][0-9]{0,15}$'
   or item->>'source_version_id' is null
   or item->>'source_version_id'!~'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   or (customer_external is not null and customer_external!~'^[1-9][0-9]{0,15}$')
   or (property_external is not null and property_external!~'^[1-9][0-9]{0,15}$') then
   raise exception 'staged_item_identity_invalid' using errcode='22023';end if;
  rank:=case kind when 'customer' then 1 when 'site' then 2 else 3 end;
  if rank<last_rank then
   raise exception 'staged_item_order_invalid' using errcode='22023';end if;
  last_rank:=rank;
  if (kind='customer' and (shape<>'customer' or customer_kind not in('person','company')
    or customer_external is not null or property_external is not null))
   or (kind='site' and (shape not in('direct','workaddress')
    or customer_kind is not null or customer_external is null
    or property_external is not null or (shape='direct' and customer_external<>external)))
   or (kind='job' and (shape not in('direct','workaddress')
    or customer_kind is not null or customer_external is null
    or property_external is null)) then
   raise exception 'staged_item_relationship_invalid' using errcode='22023';end if;
  source_version:=(item->>'source_version_id')::uuid;
  select * into v from public.learn_business_input_versions
   where id=source_version and tenant_id=p_tenant and connection_id=p_connection
    and provider='commusoft' and collection=case when kind='job' then 'jobs' else 'properties' end
    and external_id=external;
  if not found or jsonb_typeof(v.payload->'id') is distinct from 'number'
   or v.payload->>'id' is distinct from external then
   raise exception 'staged_item_source_invalid' using errcode='22023';end if;
  if kind='customer' then
   category:=v.payload->>'customerType';
   if v.payload->>'type' is distinct from 'customer'
    or category is null or p_kind_map->>category is distinct from customer_kind
    or (customer_kind='company' and nullif(btrim(v.payload->>'companyName'),'') is null)
    or (customer_kind='person' and
      (nullif(btrim(v.payload->>'companyName'),'') is not null
       or nullif(btrim(concat_ws(' ',v.payload->'contact'->>'firstName',
        v.payload->'contact'->>'lastName')),'') is null)) then
    raise exception 'staged_customer_kind_unreviewed' using errcode='PT409';end if;
  elsif kind='site' and ((shape='direct' and v.payload->>'type'<>'customer')
   or (shape='workaddress' and
    (v.payload->>'type'<>'workaddress'
     or v.payload->>'parentPropertyID' is distinct from customer_external))) then
   raise exception 'staged_site_relationship_invalid' using errcode='PT409';
  elsif kind='job' and v.payload->>'propertyID' is distinct from property_external then
   raise exception 'staged_job_relationship_invalid' using errcode='PT409';
  end if;
  insert into public.new_dawn_m2_identity_items
   (batch_id,ordinal,tenant_id,kind,shape,external_id,source_version_id,
    customer_external_id,property_external_id,customer_kind)
  values(p_batch,ordinal,p_tenant,kind,shape,external,source_version,
   customer_external,property_external,customer_kind);
 end loop;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_identity.staged_batch_registered',
  'commusoft_identity_batch',p_batch::text,
  jsonb_build_object('connection_id',p_connection,'manifest_sha256',digest,
   'kind_evidence_sha256',p_kind_evidence_sha256,'item_count',n),
  btrim(p_reason),p_batch::text,false,'new-dawn-staged-identity');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('state','prepared','batch_id',p_batch,
  'manifest_sha256',digest,'item_count',n,'audit_id',audit);
end $$;
revoke all on function public.new_dawn_m2_identity_batch_register(
 uuid,uuid,uuid,jsonb,jsonb,text,text) from public,anon,service_role;
grant execute on function public.new_dawn_m2_identity_batch_register(
 uuid,uuid,uuid,jsonb,jsonb,text,text) to authenticated;

commit;
