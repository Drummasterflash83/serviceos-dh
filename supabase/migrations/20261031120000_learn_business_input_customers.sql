-- Explicit reviewed customer projection from retained API evidence. No backfill,
-- provider request, inferred match, or automatic projection from a worker.
begin;
create index learn_business_input_observations_version_idx
 on public.learn_business_input_observations(version_id,page_id);
create table public.learn_business_input_links (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 connection_id uuid not null,
 provider text not null,
 collection text not null,
 external_id text not null,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 entity_kind text not null check(entity_kind in ('customer','site','contact','job')),
 entity_table text not null,
 entity_id uuid not null,
 card_id uuid references public.customer_cards(id) on delete restrict,
 request jsonb not null,
 actor_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,connection_id,provider,collection,external_id),
 check((entity_kind='customer' and entity_table in ('people','companies'))
    or (entity_kind='contact' and entity_table='people')
    or (entity_kind='site' and entity_table='sites')
    or (entity_kind='job' and entity_table='jobs'))
);
alter table public.learn_business_input_links enable row level security;
revoke all on public.learn_business_input_links from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_links
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_links
 for each statement execute function public.learn_business_input_retain();

-- The server must authenticate the caller before supplying p_actor. The current
-- tenant owner/admin and View-As guard are also checked inside this transaction.
-- p_target=NULL is an explicit reviewed CREATE, never an automatic match fallback.
-- p_kind is reviewed classification: configurable customerType IDs, a company
-- name, or a shared mailbox do not independently prove person/company identity.
create function public.learn_commusoft_review_customer(
 p_tenant uuid,p_actor uuid,p_version uuid,p_kind text,p_target uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;
 c public.provider_connections%rowtype;
 request jsonb; contact jsonb; raw jsonb; meta jsonb;
 flag_name text; field_name text; target_table text; label text; address text;
 target uuid; card uuid; latest timestamptz; latest_versions integer; latest_matches integer;
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'business_input_review_forbidden' using errcode='42501';end if;
 perform public.learn_import_batch_authority(p_tenant,p_actor);
 if p_version is null or p_kind is null or p_kind not in ('person','company')
  or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 -- Same lock order as the source writer. The exclusive connection lock below
 -- fences a new page publication until this reviewed snapshot has committed.
 perform 1 from public.tenants where id=p_tenant and status='active' for share;
 if not found then raise exception 'business_input_tenant_unavailable' using errcode='42501';end if;
 foreach flag_name in array array['learn.enabled','learn.inputs.commusoft.enabled'] loop
  perform 1 from public.feature_flags where tenant_id=p_tenant and flag=flag_name and value='true'::jsonb for share;
  if not found then raise exception 'business_input_module_unavailable' using errcode='42501';end if;
 end loop;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant;
 if not found or v.provider<>'commusoft' or v.collection<>'properties' then
  raise exception 'business_input_source_unavailable' using errcode='22023';end if;
 perform 1 from public.tenant_connectors where tenant_id=p_tenant and connector_id='commusoft'
  and provider='commusoft' and enabled and status='active' for share;
 if not found then raise exception 'business_input_connector_unavailable' using errcode='42501';end if;
 select * into c from public.provider_connections where id=v.connection_id and tenant_id=p_tenant for update;
 if not found or c.provider is distinct from 'commusoft' or c.status is distinct from 'configured' or c.revoked_at is not null
  or c.verified_at is null or c.verified_at>clock_timestamp() then
  raise exception 'business_input_connection_unavailable' using errcode='42501';end if;
 target_table:=case when p_kind='person' then 'people' else 'companies' end;
 request:=jsonb_build_object('version',p_version,'kind',p_kind,'target',p_target,'actor',p_actor,'reason',btrim(p_reason));
 select * into l from public.learn_business_input_links where tenant_id=p_tenant
  and connection_id=v.connection_id and provider=v.provider and collection=v.collection and external_id=v.external_id;
 if found then
  if l.request is distinct from request then raise exception 'business_input_identity_already_reviewed' using errcode='PT409';end if;
  -- Exact lost-response recovery. Never changes the original target or card.
  execute format('select id from public.%I where tenant_id=$1 and id=$2 for share',l.entity_table)
   into target using p_tenant,l.entity_id;
  perform 1 from public.customer_cards where id=l.card_id and tenant_id=p_tenant
    and ((l.entity_table='people' and person_id=l.entity_id)
      or (l.entity_table='companies' and person_id is null and company_id=l.entity_id)) for share;
  if target is null or not found then
   raise exception 'business_input_target_unavailable' using errcode='PT409';end if;
  return jsonb_build_object('link_id',l.id,'entity_table',l.entity_table,'entity_id',l.entity_id,'card_id',l.card_id,'already',true);
 end if;
 -- Only an observed source version can be approved. Equal-time differing
 -- observations are ambiguous, not UUID-ordered into an invented winner.
 select max(p.committed_at) into latest from public.learn_business_input_observations o
  join public.learn_business_input_pages p on p.id=o.page_id
  join public.learn_business_input_versions s on s.id=o.version_id
  where s.tenant_id=p_tenant and s.connection_id=v.connection_id and s.provider=v.provider
   and s.collection=v.collection and s.external_id=v.external_id
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 select count(distinct s.id),count(distinct s.id) filter(where s.id=v.id) into latest_versions,latest_matches
  from public.learn_business_input_observations o join public.learn_business_input_pages p on p.id=o.page_id
  join public.learn_business_input_versions s on s.id=o.version_id
  where s.tenant_id=p_tenant and s.connection_id=v.connection_id and s.provider=v.provider
   and s.collection=v.collection and s.external_id=v.external_id and p.committed_at=latest
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 if latest_versions<>1 or latest_matches<>1 then raise exception 'business_input_review_stale' using errcode='PT409';end if;
 raw:=v.payload;
 if raw->>'type' is distinct from 'customer' or jsonb_typeof(raw->'id') is distinct from 'number'
  or raw->>'id' is distinct from v.external_id then
  raise exception 'business_input_customer_required' using errcode='22023';end if;
 if p_target is not null then
  execute format('select id from public.%I where tenant_id=$1 and id=$2 for share',target_table)
   into target using p_tenant,p_target;
  if target is null then raise exception 'business_input_target_unavailable' using errcode='22023';end if;
 else
  -- Copy only typed source fields. No invented email, consent, historical
  -- timestamps, performance score, or "verified" status is created.
  contact:=coalesce(nullif(raw->'contact','null'::jsonb),'{}'::jsonb);
  if jsonb_typeof(contact)<>'object' then raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  foreach field_name in array array['firstName','lastName','telephone','mobile','email'] loop
   if contact ? field_name and contact->field_name<>'null'::jsonb and
    (jsonb_typeof(contact->field_name)<>'string' or length(contact->>field_name)>1000) then
    raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  end loop;
  foreach field_name in array array['companyName','addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
   if raw ? field_name and raw->field_name<>'null'::jsonb and
    (jsonb_typeof(raw->field_name)<>'string' or length(raw->>field_name)>1000) then
    raise exception 'business_input_customer_invalid' using errcode='22023';end if;
  end loop;
  address:=nullif(concat_ws(', ',nullif(btrim(raw->>'addressLine1'),''),nullif(btrim(raw->>'addressLine2'),''),
   nullif(btrim(raw->>'addressLine3'),''),nullif(btrim(raw->>'town'),''),nullif(btrim(raw->>'province'),'')),'');
  meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,
   'provider',v.provider,'collection',v.collection,'external_id',v.external_id,'source_version_id',v.id));
  if p_kind='person' then
   label:=nullif(btrim(concat_ws(' ',nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''))),'');
   if label is null then raise exception 'business_input_customer_name_required' using errcode='22023';end if;
   insert into public.people(tenant_id,display_name,first_name,last_name,primary_email,primary_phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,nullif(btrim(contact->>'firstName'),''),nullif(btrim(contact->>'lastName'),''),
     nullif(btrim(contact->>'email'),''),coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')),
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;
  else
   label:=nullif(btrim(raw->>'companyName'),'');
   if label is null then raise exception 'business_input_customer_name_required' using errcode='22023';end if;
   insert into public.companies(tenant_id,name,phone,address_text,postcode,verified,created_source,metadata)
    values(p_tenant,label,coalesce(nullif(btrim(contact->>'telephone'),''),nullif(btrim(contact->>'mobile'),'')),
     address,nullif(btrim(raw->>'postcode'),''),false,'business_input:commusoft',meta) returning id into target;
  end if;
 end if;
 -- Reuse exactly the customer-card identity indexes used by governed imports.
 -- Existing titles, summaries, ownership, activity, assessments and metadata stay.
 if p_kind='person' then
  select display_name into label from public.people where id=target and tenant_id=p_tenant;
  insert into public.customer_cards(tenant_id,person_id,title,metadata)
   values(p_tenant,target,coalesce(nullif(btrim(label),''),'Imported customer'),jsonb_build_object('learn_source_version_id',v.id))
   on conflict(tenant_id,person_id) where person_id is not null do nothing returning id into card;
  if card is null then select id into card from public.customer_cards where tenant_id=p_tenant and person_id=target;end if;
 else
  select name into label from public.companies where id=target and tenant_id=p_tenant;
  insert into public.customer_cards(tenant_id,company_id,title,metadata)
   values(p_tenant,target,coalesce(nullif(btrim(label),''),'Imported customer'),jsonb_build_object('learn_source_version_id',v.id))
   on conflict(tenant_id,company_id) where person_id is null and company_id is not null do nothing returning id into card;
  if card is null then select id into card from public.customer_cards where tenant_id=p_tenant and company_id=target and person_id is null;end if;
 end if;
 perform 1 from public.customer_cards where id=card and tenant_id=p_tenant
  and ((p_kind='person' and person_id=target) or (p_kind='company' and person_id is null and company_id=target)) for share;
 if card is null or not found then raise exception 'business_input_card_changed' using errcode='40001';end if;
 insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,
  entity_kind,entity_table,entity_id,card_id,request,actor_id)
  values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,'customer',target_table,target,card,request,p_actor)
  returning * into l;
 return jsonb_build_object('link_id',l.id,'entity_table',target_table,'entity_id',target,'card_id',card,'already',false);
end $$;
revoke all on function public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.learn_commusoft_review_customer(uuid,uuid,uuid,text,uuid,text) to service_role;
commit;
