-- Reviewed site/job projection into the existing canonical tables. No backfill,
-- provider request, automatic merge, score or historical ownership inference.
begin;
create table public.learn_business_input_projection_attempts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
 source_version_id uuid not null references public.learn_business_input_versions(id) on delete restrict,
 actor_id uuid not null,request jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_business_input_projection_attempts enable row level security;
revoke all on public.learn_business_input_projection_attempts from public,anon,authenticated,service_role;
create trigger retain_rows before update or delete on public.learn_business_input_projection_attempts
 for each row execute function public.learn_business_input_retain();
create trigger retain_all before truncate on public.learn_business_input_projection_attempts
 for each statement execute function public.learn_business_input_retain();
create index learn_business_input_projection_attempts_source_idx
 on public.learn_business_input_projection_attempts(tenant_id,source_version_id,created_at);

create function public.learn_business_input_latest(p_tenant uuid,p_connection uuid,p_provider text,p_collection text,p_external text)
returns public.learn_business_input_versions language plpgsql set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;t timestamptz;n integer;begin
 select max(p.committed_at) into t from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection;
 select count(distinct s.id) into n from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection and p.committed_at=t;
 if n<>1 then return v;end if;
 select s.* into v from public.learn_business_input_versions s
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider=p_provider and s.collection=p_collection and s.external_id=p_external
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection and p.committed_at=t limit 1;
 return v;
end $$;

-- Called only while the authenticated projector holds connection/roster locks.
-- Resolve each property in its original connection; numeric IDs never become FKs.
create function public.learn_commusoft_property_owner(p_tenant uuid,p_connection uuid,p_external text,p_allow_site boolean default true)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 s public.sites%rowtype;owner jsonb;person uuid;company uuid;parent text;original jsonb;begin
 v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','properties',p_external);
 if v.id is null then return jsonb_build_object('state','held','reason','property_missing_or_ambiguous');end if;
 select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection
  and provider='commusoft' and collection='properties' and external_id=p_external;
 if not found then return jsonb_build_object('state','held','reason','property_identity_unreviewed');end if;
 if v.payload->>'type'='customer' and l.entity_kind='customer' then
  if l.entity_table='people' then
   select id into person from public.people where tenant_id=p_tenant and id=l.entity_id for share;
  elsif l.entity_table='companies' then
   select id into company from public.companies where tenant_id=p_tenant and id=l.entity_id for share;
  end if;
  if person is null and company is null then return jsonb_build_object('state','held','reason','customer_target_missing');end if;
  perform 1 from public.customer_cards where id=l.card_id and tenant_id=p_tenant and
   ((person is not null and person_id=person) or (company is not null and person_id is null and company_id=company)) for share;
  if not found then return jsonb_build_object('state','held','reason','customer_card_changed');end if;
  return jsonb_build_object('state','ready','person_id',person,'company_id',company,'site_id',null,'card_id',l.card_id,'customer_link_id',l.id);
 elsif p_allow_site and v.payload->>'type'='workaddress' and l.entity_kind='site' and l.entity_table='sites' then
  parent:=v.payload->>'parentPropertyID';
  if jsonb_typeof(v.payload->'parentPropertyID') is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$' or parent=p_external then
   return jsonb_build_object('state','held','reason','site_parent_invalid');end if;
  select payload into original from public.learn_business_input_versions where id=l.source_version_id;
  if original->>'parentPropertyID' is distinct from parent then return jsonb_build_object('state','held','reason','site_source_owner_changed');end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,p_connection,parent,false);
  if owner->>'state'<>'ready' then return owner;end if;
  select * into s from public.sites where id=l.entity_id and tenant_id=p_tenant for share;
  if not found or s.person_id is distinct from (owner->>'person_id')::uuid or s.company_id is distinct from (owner->>'company_id')::uuid then
   return jsonb_build_object('state','held','reason','site_canonical_owner_changed');end if;
  return owner||jsonb_build_object('site_id',s.id,'site_link_id',l.id);
 end if;
 return jsonb_build_object('state','held','reason','property_kind_changed');
end $$;

create function public.learn_business_input_projection_result(p_tenant uuid,p_version uuid,p_request jsonb,p_result jsonb)
returns jsonb language plpgsql set search_path=pg_catalog as $$
declare attempt uuid;begin
 insert into public.learn_business_input_projection_attempts(tenant_id,source_version_id,actor_id,request,result)
  values(p_tenant,p_version,auth.uid(),p_request,p_result) returning id into attempt;
 return p_result||jsonb_build_object('attempt_id',attempt);
end $$;

create function public.learn_commusoft_confirm_work_record(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;s public.sites%rowtype;j public.jobs%rowtype;
 owner jsonb;request jsonb;result jsonb;meta jsonb;field text;kind text;parent text;reason text;target uuid;
 person uuid;company uuid;site uuid;namespace text;address text;status text;created timestamptz;completed timestamptz;ts text;
begin
 perform public.learn_business_input_review_access(p_tenant);
 if p_version is null or p_reason is null or length(btrim(p_reason)) not between 3 and 1000 then
  raise exception 'business_input_review_invalid' using errcode='22023';end if;
 select * into v from public.learn_business_input_versions where id=p_version and tenant_id=p_tenant and provider='commusoft';
 if not found or not (v.collection='jobs' or (v.collection='properties' and v.payload->>'type'='workaddress')) then
  raise exception 'business_input_work_source_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,v.connection_id);
 perform 1 from public.provider_connections where tenant_id=p_tenant and id=v.connection_id for update;
 kind:=case when v.collection='jobs' then 'job' else 'site' end;
 request:=jsonb_build_object('target',p_target,'reason',btrim(p_reason),'kind',kind);
 -- The block exits on a held condition; the final attempt records the reason.
 <<project>> begin
  latest:=public.learn_business_input_latest(p_tenant,v.connection_id,v.provider,v.collection,v.external_id);
  if latest.id is distinct from v.id then reason:='source_changed_or_ambiguous';exit project;end if;
  if jsonb_typeof(v.payload->'id') is distinct from 'number' or v.payload->>'id' is distinct from v.external_id then reason:='source_identity_invalid';exit project;end if;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=v.connection_id
   and provider=v.provider and collection=v.collection and external_id=v.external_id;
  if found and (l.source_version_id<>v.id or l.entity_kind<>kind or (p_target is not null and p_target<>l.entity_id)) then
   reason:='existing_identity_needs_review';exit project;end if;
  field:=case when kind='site' then 'parentPropertyID' else 'propertyID' end;parent:=v.payload->>field;
  if jsonb_typeof(v.payload->field) is distinct from 'number' or parent!~'^[1-9][0-9]{0,15}$'
   or (kind='site' and parent=v.external_id) then reason:='property_reference_invalid';exit project;end if;
  if parent::numeric>9007199254740991 then reason:='property_reference_invalid';exit project;end if;
  owner:=public.learn_commusoft_property_owner(p_tenant,v.connection_id,parent,kind='job');
  if owner->>'state'<>'ready' then reason:=owner->>'reason';exit project;end if;
  person:=(owner->>'person_id')::uuid;company:=(owner->>'company_id')::uuid;site:=(owner->>'site_id')::uuid;
  target:=coalesce(l.entity_id,p_target);namespace:='commusoft:connection:'||v.connection_id::text;
  if target is null then
   -- Existing CSV imports are candidates, not proof of the same provider account.
   if kind='site' and exists(select 1 from public.sites where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id)
    or kind='job' and exists(select 1 from public.jobs where tenant_id=p_tenant and source_system in ('commusoft',namespace) and external_id=v.external_id) then
    reason:='existing_external_identity_needs_review';exit project;end if;
   meta:=jsonb_build_object('learn_business_input',jsonb_build_object('connection_id',v.connection_id,'source_version_id',v.id,'property_external_id',parent,'relationships',owner));
   if kind='site' then
    foreach field in array array['addressLine1','addressLine2','addressLine3','town','province','postcode'] loop
     if v.payload ? field and v.payload->field<>'null'::jsonb and (jsonb_typeof(v.payload->field)<>'string' or length(v.payload->>field)>1000) then reason:='site_field_invalid';exit project;end if;
    end loop;
    address:=public.learn_business_customer_summary(v.payload)->>'address';
    insert into public.sites(tenant_id,source_system,external_id,person_id,company_id,label,address_text,postcode,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,person,company,coalesce(public.learn_business_input_text(v.payload,'addressLine1'),'Work site '||v.external_id),address,
      public.learn_business_input_text(v.payload,'postcode'),'business_input:commusoft',false,meta) returning id into target;
   else
    if jsonb_typeof(v.payload->'status') is distinct from 'string' or v.payload->>'status' not in ('Open','Complete','Closed') then reason:='job_status_unrecognised';exit project;end if;
    if v.payload ? 'description' and v.payload->'description'<>'null'::jsonb and (jsonb_typeof(v.payload->'description')<>'string' or length(v.payload->>'description')>1000) then reason:='job_field_invalid';exit project;end if;
    status:=case v.payload->>'status' when 'Open' then 'open' when 'Complete' then 'completed' else 'closed' end;
    if v.payload ? 'completed' and v.payload->'completed'<>'null'::jsonb and jsonb_typeof(v.payload->'completed')<>'object' then reason:='job_timestamp_invalid';exit project;end if;
    -- Only explicit source timestamps with a timezone are eligible. Closed does
    -- not mean completed: outcome, money, staff and reward semantics stay raw.
    foreach field in array array['created','completed'] loop
     ts:=case when field='created' then v.payload->>'createdOnDateTime' else v.payload->'completed'->>'completedOnDateTime' end;
     if ts is not null then
      if ts!~'^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,6})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$' then reason:='job_timestamp_invalid';exit project;end if;
      begin if field='created' then created:=ts::timestamptz;else completed:=ts::timestamptz;end if;
      exception when invalid_datetime_format or datetime_field_overflow then reason:='job_timestamp_invalid';exit project;end;
     end if;
    end loop;
    insert into public.jobs(tenant_id,source_system,external_id,job_number,customer_person_id,customer_company_id,site_id,title,description,status,created_date,completed_date,created_source,verified,metadata)
     values(p_tenant,namespace,v.external_id,v.external_id,person,company,site,coalesce(public.learn_business_input_text(v.payload,'description'),'Job '||v.external_id),
      public.learn_business_input_text(v.payload,'description'),status,created,completed,'business_input:commusoft',false,meta) returning id into target;
   end if;
  else
   if kind='site' then
    select * into s from public.sites where tenant_id=p_tenant and id=target for share;
    if not found or s.person_id is distinct from person or s.company_id is distinct from company then reason:='target_site_owner_mismatch';exit project;end if;
   else
    select * into j from public.jobs where tenant_id=p_tenant and id=target for share;
    if not found or j.customer_person_id is distinct from person or j.customer_company_id is distinct from company or j.site_id is distinct from site then reason:='target_job_owner_mismatch';exit project;end if;
   end if;
  end if;
  if l.id is null then
   insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
    values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,kind,case when kind='site' then 'sites' else 'jobs' end,target,(owner->>'card_id')::uuid,request,auth.uid()) returning * into l;
   result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',false);
  else result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',true);end if;
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
revoke all on function public.learn_business_input_latest(uuid,uuid,text,text,text),public.learn_commusoft_property_owner(uuid,uuid,text,boolean),public.learn_business_input_projection_result(uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text) from public,anon,service_role;
grant execute on function public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text) to authenticated;
commit;
