-- Publish useful job identity/status with explicit timing limitations.
-- Valid unzoned timestamps remain raw evidence, never invented UTC instants.
-- Malformed dates and unresolved ownership still hold the record. No backfill.
begin;
create or replace function public.learn_commusoft_confirm_work_record(p_tenant uuid,p_version uuid,p_target uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare
 v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 l public.learn_business_input_links%rowtype;s public.sites%rowtype;j public.jobs%rowtype;
 owner jsonb;request jsonb;result jsonb;meta jsonb;field text;kind text;parent text;reason text;target uuid;
 person uuid;company uuid;site uuid;namespace text;address text;status text;created timestamptz;completed timestamptz;time_detail jsonb;times jsonb:='{}';
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
    if jsonb_typeof(v.payload->'status') is distinct from 'string' or v.payload->>'status' not in ('Open','Complete','Closed','ongoing','completed','on_hold','pending') then reason:='job_status_unrecognised';exit project;end if;
    if v.payload ? 'description' and v.payload->'description'<>'null'::jsonb and (jsonb_typeof(v.payload->'description')<>'string' or length(v.payload->>'description')>1000) then reason:='job_field_invalid';exit project;end if;
    status:=case v.payload->>'status' when 'Open' then 'open' when 'ongoing' then 'open' when 'Complete' then 'completed' when 'completed' then 'completed' when 'Closed' then 'closed' else v.payload->>'status' end;
    if v.payload ? 'completed' and v.payload->'completed'<>'null'::jsonb and jsonb_typeof(v.payload->'completed')<>'object' then reason:='job_timestamp_invalid';exit project;end if;
    -- The source classifier validates calendar/time fields without assuming a zone.
    -- A usable job can be linked while an uncertain instant remains unavailable.
    foreach field in array array['created','completed'] loop
     time_detail:=public.learn_business_input_time_detail(case when field='created'
      then v.payload->'createdOnDateTime' else v.payload->'completed'->'completedOnDateTime' end);
     if time_detail->>'state'='invalid' then reason:='job_timestamp_invalid';exit project;end if;
     if time_detail->>'state'='zoned' then
      if field='created' then created:=(time_detail->>'instant')::timestamptz;
      else completed:=(time_detail->>'instant')::timestamptz;end if;
     end if;
     times:=times||jsonb_build_object(field,time_detail);
    end loop;
    meta:=jsonb_set(meta,'{learn_business_input,timestamps}',times);
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
    times:=case when jsonb_typeof(j.metadata->'learn_business_input'->'timestamps')='object' then j.metadata->'learn_business_input'->'timestamps' else '{}'::jsonb end;
   end if;
  end if;
  if l.id is null then
   insert into public.learn_business_input_links(tenant_id,connection_id,provider,collection,external_id,source_version_id,entity_kind,entity_table,entity_id,card_id,request,actor_id)
    values(p_tenant,v.connection_id,v.provider,v.collection,v.external_id,v.id,kind,case when kind='site' then 'sites' else 'jobs' end,target,(owner->>'card_id')::uuid,request,auth.uid()) returning * into l;
   result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',false);
  else result:=jsonb_build_object('state','linked','entity_id',target,'entity_kind',kind,'link_id',l.id,'already',true);end if;
  if kind='job' then
   result:=result||jsonb_build_object('timing_limitations',coalesce((select jsonb_agg(key order by key)
    from jsonb_each(times) where key in ('created','completed') and value->>'state'='timezone_required'),'[]'::jsonb));
  end if;
 end project;
 if reason is not null then result:=jsonb_build_object('state','held','reason',reason);end if;
 return public.learn_business_input_projection_result(p_tenant,v.id,request,result);
end $$;
-- CREATE OR REPLACE retains ownership and existing authenticated-only grants.
commit;
