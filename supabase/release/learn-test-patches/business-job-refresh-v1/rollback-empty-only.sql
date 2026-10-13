begin;set local lock_timeout='5s';set local statement_timeout='30s';
do $after_guard$ begin
 if (select md5(pg_get_functiondef(oid))='2adbf3b163734e7a92efff84ae140b94' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,learn_card_communication_reader=X/postgres}' from pg_proc where oid='public.learn_card_slack_job_context(uuid,uuid,uuid)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_card_slack_job_context';end if;
 if (select md5(pg_get_functiondef(oid))='9281951f956bd9c7eec12636d27edaad' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_confirm_work_record(uuid,uuid,uuid,text)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_commusoft_confirm_work_record';end if;
 if (select md5(pg_get_functiondef(oid))='8e2cb43fe4fda4c24926399c3ef8917b' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_work_review_page(uuid,uuid,text,text,integer)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_commusoft_work_review_page';end if;
 if (select md5(pg_get_functiondef(oid))='4385d308eb96da5891d0c59143fa2bd6' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_commusoft_work_review_search';end if;
 if (select md5(pg_get_functiondef(oid))='0176020ae98545133b07c0a841f5862b' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_customer_business_context(uuid,uuid,text,uuid,text)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_customer_business_context';end if;
 if (select md5(pg_get_functiondef(oid))='c623f4b271406811f7e32b96077d07d7' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.openfolk_business_review(uuid,text,text,jsonb)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: openfolk_business_review';end if;
 if (select md5(pg_get_functiondef(oid))='3fe8bdb8623aafa6f71890101c71c97e' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres}' from pg_proc where oid='public.learn_commusoft_job_fields(jsonb,text)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_commusoft_job_fields';end if;
 if (select md5(pg_get_functiondef(oid))='36cb885d292a8b9a80ce467e26027ec4' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_job_refresh_plan(uuid,uuid)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_commusoft_job_refresh_plan';end if;
 if (select md5(pg_get_functiondef(oid))='cd4fdf833ca4c4d6f513307ff158a49a' and pg_get_userbyid(proowner)='postgres' and proacl::text is not distinct from '{postgres=X/postgres,authenticated=X/postgres}' from pg_proc where oid='public.learn_commusoft_job_refresh(uuid,uuid,uuid,uuid,text,text,text)'::regprocedure) is not true then raise exception 'Installed refresh definition/access differs: learn_commusoft_job_refresh';end if;
end $after_guard$;
do $$begin if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then raise exception 'Reviewed rollback target required';end if;if exists(select 1 from public.learn_business_input_refreshes) or exists(select 1 from public.learn_business_input_refresh_cancellations) then raise exception 'Retained refresh history exists; pause execution and preserve readers instead';end if;end$$;
CREATE OR REPLACE FUNCTION public.learn_card_slack_job_context(p_tenant uuid, p_person uuid, p_company uuid)
 RETURNS TABLE(interaction_id uuid, context jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and tenant_id=p_tenant and role in('owner','admin'))
 then raise exception 'Company owner/admin communication access required' using errcode='42501';end if;
 if p_tenant is null or (p_person is null and p_company is null) then return;end if;
 return query
 with owned as materialized(
  select j.*,l.connection_id,l.source_version_id,l.external_id provider_job,l.id job_link_id
  from public.jobs j join public.learn_business_input_links l on l.tenant_id=j.tenant_id and l.entity_id=j.id
   and l.entity_kind='job' and l.entity_table='jobs' and l.provider='commusoft' and l.collection='jobs'
  join public.provider_connections c on c.tenant_id=l.tenant_id and c.id=l.connection_id and c.provider=l.provider
   and c.status='configured' and c.revoked_at is null
  where j.tenant_id=p_tenant and (j.customer_person_id=p_person or j.customer_company_id=p_company)
   and exists (
    select 1 from public.interactions scoped_i
    join public.learn_slack_context_reviews scoped_r on scoped_r.tenant_id=scoped_i.tenant_id
     and scoped_r.interaction_id=scoped_i.id and scoped_r.receipt->>'state'='committed'
    where scoped_i.tenant_id=j.tenant_id and scoped_i.related_job_id=j.id
     and scoped_i.source_table='slack_messages' and scoped_i.source_connector_id='slack'
   )
   and j.source_system='commusoft:connection:'||l.connection_id::text and j.external_id=l.external_id
   and j.metadata#>>'{learn_business_input,connection_id}'=l.connection_id::text
   and j.metadata#>>'{learn_business_input,source_version_id}'=l.source_version_id::text
 ), current_jobs as materialized(
  select j.*,cp.id customer_source_version,cl.id customer_link_id,pl.source_version_id property_source_version
  from owned j
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','jobs',j.provider_job)v
   on v.id=j.source_version_id and v.payload->>'id'=j.provider_job and jsonb_typeof(v.payload->'id')='number'
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','properties',v.payload->>'propertyID')p
   on p.id is not null and jsonb_typeof(v.payload->'propertyID')='number'
   and p.payload->>'id'=v.payload->>'propertyID' and jsonb_typeof(p.payload->'id')='number'
   and j.metadata#>>'{learn_business_input,property_external_id}'=v.payload->>'propertyID'
  join public.learn_business_input_links pl on pl.tenant_id=p_tenant and pl.connection_id=j.connection_id
   and pl.provider='commusoft' and pl.collection='properties' and pl.external_id=p.external_id and pl.source_version_id=p.id
  join lateral public.learn_business_input_latest(p_tenant,j.connection_id,'commusoft','properties',
   case p.payload->>'type' when 'customer' then p.external_id when 'workaddress' then p.payload->>'parentPropertyID' end)cp
   on cp.id is not null and cp.payload->>'type'='customer' and cp.payload->>'id'=cp.external_id and jsonb_typeof(cp.payload->'id')='number'
  join public.learn_business_input_links cl on cl.tenant_id=p_tenant and cl.connection_id=j.connection_id
   and cl.provider='commusoft' and cl.collection='properties' and cl.external_id=cp.external_id and cl.source_version_id=cp.id and cl.entity_kind='customer'
  join public.customer_cards card on card.tenant_id=p_tenant and card.id=cl.card_id
   and ((cl.entity_table='people' and card.person_id=cl.entity_id) or (cl.entity_table='companies' and card.person_id is null and card.company_id=cl.entity_id))
  where j.customer_person_id is not distinct from case when cl.entity_table='people' then cl.entity_id end
   and j.customer_company_id is not distinct from case when cl.entity_table='companies' then cl.entity_id end
   and ((cl.entity_table='people' and exists(select 1 from public.people where tenant_id=p_tenant and id=cl.entity_id))
    or (cl.entity_table='companies' and exists(select 1 from public.companies where tenant_id=p_tenant and id=cl.entity_id)))
   and ((p.payload->>'type'='customer' and j.site_id is null and pl.id=cl.id)
    or (p.payload->>'type'='workaddress' and pl.entity_kind='site' and pl.entity_table='sites' and pl.entity_id=j.site_id
     and jsonb_typeof(p.payload->'parentPropertyID')='number' and p.payload->>'parentPropertyID'=cp.external_id
     and exists(select 1 from public.sites site where site.tenant_id=p_tenant and site.id=j.site_id
      and site.person_id is not distinct from j.customer_person_id and site.company_id is not distinct from j.customer_company_id
      and site.metadata#>>'{learn_business_input,connection_id}'=j.connection_id::text
      and site.metadata#>>'{learn_business_input,source_version_id}'=p.id::text)))
 )
 select i.id,jsonb_build_object('version','learn-customer-job-context/1','kind','reviewed_slack_job',
  'job_id',j.id,'person_id',j.customer_person_id,'company_id',j.customer_company_id,
  'review_request_id',r.request_id,'source_version',s.source_version,'job_source_version_id',j.source_version_id,
  'property_source_version_id',j.property_source_version,'customer_source_version_id',j.customer_source_version)
 from public.interactions i
 join current_jobs j on j.tenant_id=i.tenant_id and j.id=i.related_job_id
 join public.slack_messages s on s.tenant_id=i.tenant_id and s.id=i.source_id and s.source_version=i.metadata->>'source_version'
 join public.learn_slack_context_reviews r on r.tenant_id=i.tenant_id and r.interaction_id=i.id
  and r.request_id::text=i.metadata#>>'{work_context,request_id}' and r.receipt->>'state'='committed'
  and r.receipt->'context'=i.metadata->'work_context' and r.definition->>'job_id'=j.id::text
 where i.tenant_id=p_tenant and i.source_table='slack_messages' and i.source_connector_id='slack'
  and i.interaction_type='slack_message' and i.processing_status='enriched' and coalesce(i.status,'') not in('deleted','removed')
  and i.metadata#>>'{work_context,version}'='learn-slack-work-context/1'
  and i.metadata#>>'{work_context,state}'='reviewed' and i.metadata#>>'{work_context,scope}'='job'
  and i.metadata#>>'{work_context,source_version}'=s.source_version and i.metadata#>>'{work_context,job_id}'=j.id::text
  and public.learn_slack_message_kind(s.provider_payload)='conversation'
  and exists(select 1 from public.slack_message_versions version
   join public.slack_source_visibility_proofs proof on proof.version_id=version.id
   join public.slack_channel_visibility_receipts visibility on visibility.id=proof.receipt_id and visibility.tenant_id=version.tenant_id
   join public.provider_connections slack_connection on slack_connection.id=visibility.connection_id and slack_connection.tenant_id=visibility.tenant_id
    and slack_connection.provider='slack' and slack_connection.status='configured' and slack_connection.revoked_at is null
    and slack_connection.non_secret_config->>'team_id'=visibility.team_id
   where version.tenant_id=s.tenant_id and version.message_id=s.id and version.source_version=s.source_version and version.provider_payload=s.provider_payload
    and visibility.team_id=s.team_id and visibility.channel_id=s.channel_id
    and visibility.evidence->>'version'='slack-capture-visibility/1'
    and visibility.evidence->'is_channel'='true'::jsonb and visibility.evidence->'is_private'='false'::jsonb
    and visibility.evidence->'is_shared'='false'::jsonb and visibility.evidence->'pending_shared'='false'::jsonb
    and not exists(select 1 from unnest(array['is_im','is_mpim','is_ext_shared','is_org_shared','is_pending_ext_shared']) f
     where visibility.evidence->f not in('false'::jsonb,'null'::jsonb)))
 order by i.occurred_at desc nulls last,i.id limit 51;
end$function$
;
CREATE OR REPLACE FUNCTION public.learn_commusoft_confirm_work_record(p_tenant uuid, p_version uuid, p_target uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
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
end $function$
;
CREATE OR REPLACE FUNCTION public.learn_commusoft_work_review_page(p_tenant uuid, p_connection uuid, p_kind text, p_after text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' when p_kind='contact' then 'propertyContacts' else 'jobs' end;
 for r in select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s where s.tenant_id=p_tenant and s.connection_id=p_connection
  and s.provider='commusoft' and s.collection=v_collection and (p_kind in ('job','contact') or s.payload->>'type'='workaddress')
  and (p_after is null or s.external_id collate "C">p_after collate "C") order by s.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  v:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft',v_collection,r.external_id);
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind in ('job','contact')) end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') when p_kind='contact' then nullif(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))),'') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'contact',case when p_kind='contact' then jsonb_build_object('email',public.learn_business_input_text(v.payload,'email'),'position',public.learn_business_input_text(v.payload,'position'),
    'phones',(select coalesce(jsonb_agg(x.number),'[]'::jsonb) from (select left(concat_ws(': ',ph->>'type',ph->>'number'),1000) as number from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph where jsonb_typeof(ph->'number')='string' limit 50) x)) end,
   'selectable',v.id is not null and coalesce(p_kind in ('job','contact') or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'rows',rows,'next_cursor',case when more then last_id end);
end $function$
;
CREATE OR REPLACE FUNCTION public.learn_commusoft_work_review_search(p_tenant uuid, p_connection uuid, p_kind text, p_search text DEFAULT ''::text, p_after text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
declare r record;v public.learn_business_input_versions%rowtype;l public.learn_business_input_links%rowtype;
 rows jsonb:='[]';owner jsonb;attempt jsonb;label text;parent text;customer text;v_collection text;last_id text;counted integer:=0;more boolean:=false;
begin
 if p_search is null or length(btrim(p_search))>150 or p_connection is null or p_kind is null or p_kind not in ('site','job','contact') or p_limit is null or p_limit not between 1 and 50
  or (p_after is not null and p_after!~'^[0-9]{1,16}$') then raise exception 'business_input_page_invalid' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 v_collection:=case when p_kind='site' then 'properties' when p_kind='contact' then 'propertyContacts' else 'jobs' end;
 -- Resolve latest observations together, including ambiguous/missing sources.
 -- Only the bounded matching page needs relationship and projection lookups.
 for r in with identities as materialized (
  select distinct s.external_id collate "C" as external_id from public.learn_business_input_versions s
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider='commusoft' and s.collection=v_collection
   and (p_kind in ('job','contact') or s.payload->>'type'='workaddress')
   and (p_after is null or s.external_id collate "C">p_after collate "C")
 ), observed as (
  select s.external_id,s.id,dense_rank() over(partition by s.external_id order by p.committed_at desc) as recency
  from identities i join public.learn_business_input_versions s on s.external_id=i.external_id
  join public.learn_business_input_observations o on o.version_id=s.id join public.learn_business_input_pages p on p.id=o.page_id
  where s.tenant_id=p_tenant and s.connection_id=p_connection and s.provider='commusoft' and s.collection=v_collection
   and p.tenant_id=s.tenant_id and p.connection_id=s.connection_id and p.provider=s.provider and p.collection=s.collection
 ), latest as (
  select external_id,case when count(distinct id)=1 then min(id::text)::uuid end as version_id from observed where recency=1 group by external_id
 ) select i.external_id,s.id as version_id from identities i left join latest x on x.external_id=i.external_id
  left join public.learn_business_input_versions s on s.id=x.version_id
  where public.learn_commusoft_source_matches(s.payload,i.external_id,p_kind,p_search)
  order by i.external_id collate "C" limit p_limit+1 loop
  counted:=counted+1;if counted>p_limit then more:=true;exit;end if;last_id:=r.external_id;
  select * into v from public.learn_business_input_versions where id=r.version_id;
  select * into l from public.learn_business_input_links where tenant_id=p_tenant and connection_id=p_connection and provider='commusoft'
   and learn_business_input_links.collection=v_collection and external_id=r.external_id;
  parent:=case when p_kind='site' then v.payload->>'parentPropertyID' else v.payload->>'propertyID' end;
  owner:=case when v.id is null then jsonb_build_object('state','held','reason','source_changed_or_ambiguous')
   else public.learn_commusoft_property_owner(p_tenant,p_connection,parent,p_kind in ('job','contact')) end;
  customer:=null;
  if owner->>'state'='ready' then
   if owner->>'person_id' is not null then select display_name into customer from public.people where tenant_id=p_tenant and id=(owner->>'person_id')::uuid;
   else select name into customer from public.companies where tenant_id=p_tenant and id=(owner->>'company_id')::uuid;end if;
  end if;
  select a.result into attempt from public.learn_business_input_projection_attempts a where a.tenant_id=p_tenant and a.source_version_id=v.id order by a.created_at desc,a.id desc limit 1;
  label:=case when p_kind='site' then public.learn_business_input_text(v.payload,'addressLine1') when p_kind='contact' then nullif(btrim(concat_ws(' ',public.learn_business_input_text(v.payload,'firstName'),public.learn_business_input_text(v.payload,'lastName'))),'') else public.learn_business_input_text(v.payload,'description') end;
  rows:=rows||jsonb_build_array(jsonb_build_object('external_id',r.external_id,'version_id',v.id,'title',coalesce(label,initcap(p_kind)||' '||r.external_id),
   'property_reference',case when parent~'^[1-9][0-9]{0,15}$' then parent end,'customer_name',left(customer,1000),'relationship_reason',owner->>'reason',
   'source_status',public.learn_business_input_text(v.payload,'status'),'linked_version_id',l.source_version_id,'last_result',attempt,
   'contact',case when p_kind='contact' then jsonb_build_object('email',public.learn_business_input_text(v.payload,'email'),'position',public.learn_business_input_text(v.payload,'position'),
    'phones',(select coalesce(jsonb_agg(x.number),'[]'::jsonb) from (select left(concat_ws(': ',ph->>'type',ph->>'number'),1000) as number from jsonb_array_elements(case when jsonb_typeof(v.payload->'telephones')='array' then v.payload->'telephones' else '[]'::jsonb end) ph where jsonb_typeof(ph->'number')='string' limit 50) x)) end,
   'selectable',v.id is not null and coalesce(p_kind in ('job','contact') or v.payload->>'type'='workaddress',false)));
 end loop;
 return jsonb_build_object('tenant_id',p_tenant,'connection_id',p_connection,'kind',p_kind,'search',btrim(p_search),'rows',rows,'next_cursor',case when more then last_id end);
end $function$
;
CREATE OR REPLACE FUNCTION public.learn_customer_business_context(p_tenant uuid, p_card uuid, p_collection text, p_after uuid DEFAULT NULL::uuid, p_operator_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=auth.uid(); customer public.customer_cards%rowtype;
 tab text;cols text[];body text;predicate text;entries jsonb;next_id uuid;total bigint;
 audit uuid;checked timestamptz;operator_mode boolean:=p_operator_reason is not null;
begin
 if auth.role() is distinct from 'authenticated' or actor is null then
  raise exception 'customer_context_forbidden' using errcode='42501';end if;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  if length(btrim(p_operator_reason)) not between 3 and 500 then
   raise exception 'customer_context_reason_invalid' using errcode='22023';end if;
 else
  perform public.learn_import_batch_authority(p_tenant,actor);
 end if;
 select * into customer from public.customer_cards where tenant_id=p_tenant and id=p_card;
 if not found then raise exception 'customer_context_unavailable' using errcode='42501';end if;
 case p_collection
 when 'sites' then
  tab:='sites';cols:=array['label','address_text','postcode','verified','source_system','external_id','updated_at'];
  predicate:='(($3 is not null and t.person_id=$3) or ($3 is null and $4 is not null and t.company_id=$4))';
 when 'jobs' then
  tab:='jobs';cols:=array['title','job_number','description','status','priority','site_id','verified','source_system','external_id','created_date','completed_date','updated_at'];
  predicate:='(($3 is not null and t.customer_person_id=$3) or ($3 is null and $4 is not null and t.customer_company_id=$4))';
 when 'contacts' then
  tab:='people';cols:=array['display_name','primary_email','primary_phone','verified','updated_at'];
  predicate:='(t.id=$3 or ($3 is null and $4 is not null and t.company_id=$4) or exists(
   select 1 from public.graph_edges e join public.graph_nodes f on f.id=e.from_node_id and f.tenant_id=e.tenant_id
   join public.graph_nodes dest on dest.id=e.to_node_id and dest.tenant_id=e.tenant_id
   where e.tenant_id=$1 and e.edge_type=''contact_for'' and e.status=''active''
    and f.node_type=''person'' and f.status=''active'' and f.source_table=''people'' and f.source_id=t.id
    and dest.node_type=''customer_card'' and dest.status=''active'' and dest.source_table=''customer_cards'' and dest.source_id=$5))';
 else raise exception 'customer_context_collection_invalid' using errcode='22023';end case;
 select string_agg(format('%L,to_jsonb(t.%I)',c,c),',') into body from unnest(cols)c;
 if p_collection='jobs' then body:=body||',''time_evidence'',(select jsonb_object_agg(k,jsonb_build_object(
  ''state'',left(t.metadata#>>array[''learn_business_input'',''timestamps'',k,''state''],32),
  ''source'',left(t.metadata#>>array[''learn_business_input'',''timestamps'',k,''source''],100),
  ''instant'',left(t.metadata#>>array[''learn_business_input'',''timestamps'',k,''instant''],50)))
  from unnest(array[''created'',''completed''])k)';end if;
 execute format($query$
  with matched as materialized(
   select t.id,jsonb_build_object(%s) fields from public.%I t where t.tenant_id=$1 and %s
  ),page as(select * from matched where $2::uuid is null or id>$2 order by id limit 26),
  shown as(select * from page order by id limit 25),mapped as(
   select s.id,jsonb_build_object('id',s.id,'fields',(
    select jsonb_object_agg(key,case when jsonb_typeof(value)='string' then to_jsonb(left(value#>>'{}',4000)) else value end)
    from jsonb_each(s.fields)),
    'truncated_fields',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from jsonb_each(s.fields)
      where jsonb_typeof(value)='string' and length(value#>>'{}')>4000),
    'sources',(select coalesce(jsonb_agg(x.entry order by x.link_id),'[]'::jsonb) from(
     select l.id link_id,jsonb_build_object('provider',l.provider,'collection',l.collection,'external_id',l.external_id,
      'version_id',v.id,'first_seen_at',v.first_seen_at) entry
     from public.learn_business_input_links l join public.learn_business_input_versions v
      on v.id=l.source_version_id and v.tenant_id=l.tenant_id and v.connection_id=l.connection_id
       and v.provider=l.provider and v.collection=l.collection and v.external_id=l.external_id
     where l.tenant_id=$1 and l.card_id=$5 and l.entity_table=%L and l.entity_id=s.id
     order by l.id limit 5)x)) entry from shown s
  ) select coalesce((select jsonb_agg(entry order by id) from mapped),'[]'::jsonb),
   case when (select count(*) from page)>25 then (select id from shown order by id desc limit 1) end,
   (select count(*) from matched)
 $query$,body,tab,predicate,tab) into entries,next_id,total
 using p_tenant,p_after,customer.person_id,customer.company_id,p_card;
 if operator_mode then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  audit:=gen_random_uuid();
  insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
  values(audit,p_tenant,actor::text,'customer_context.read',p_collection,p_card::text,
   jsonb_build_object('record_ids',(select coalesce(jsonb_agg(x->'id'),'[]'::jsonb) from jsonb_array_elements(entries)x),'after',p_after),
   btrim(p_operator_reason),audit::text,false,'learn-customer-business-context');
 else perform public.learn_import_batch_authority(p_tenant,actor);end if;
 checked:=clock_timestamp();
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','learn-customer-business-context/1','tenant_id',p_tenant,'actor_id',actor,
  'card_id',p_card,'collection',p_collection,'after',p_after,'rows',entries,'next_after',next_id,'total',total,
  'observed_at',checked,'audit_id',audit,'operator_mode',operator_mode);
end$function$
;
CREATE OR REPLACE FUNCTION public.openfolk_business_review(p_tenant uuid, p_action text, p_reason text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare actor uuid:=auth.uid();result jsonb;old_context text;allowed text[];audit uuid:=gen_random_uuid();begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_reason is null or length(btrim(p_reason)) not between 3 and 1000
  or jsonb_typeof(p_args) is distinct from 'object' or octet_length(p_args::text)>65536
  or p_args->>'p_tenant' is distinct from p_tenant::text then
  raise exception 'operator_business_review_invalid' using errcode='22023';end if;
 allowed:=case p_action
  when 'learn_commusoft_review_connections' then array['p_tenant']
  when 'learn_commusoft_review_page' then array['p_tenant','p_connection','p_after','p_limit']
  when 'learn_commusoft_review_search' then array['p_tenant','p_connection','p_after','p_limit','p_search']
  when 'learn_commusoft_customer_candidates' then array['p_tenant','p_version','p_kind','p_search','p_after','p_limit']
  when 'learn_commusoft_contact_candidates' then array['p_tenant','p_version','p_kind','p_search','p_after','p_limit']
  when 'learn_commusoft_confirm_customer' then array['p_tenant','p_version','p_kind','p_target','p_reason']
  when 'learn_commusoft_confirm_customer_identity' then array['p_tenant','p_version','p_kind','p_target','p_reason','p_identity']
  when 'learn_commusoft_work_review_page' then array['p_tenant','p_connection','p_kind','p_after','p_limit']
  when 'learn_commusoft_work_review_search' then array['p_tenant','p_connection','p_kind','p_after','p_limit','p_search']
  when 'learn_commusoft_work_batch_result' then array['p_tenant','p_request']
  when 'learn_commusoft_work_batch' then array['p_tenant','p_request','p_connection','p_kind','p_items','p_reason','p_cancel','p_expected_actor']
  when 'learn_commusoft_job_details' then array['p_tenant','p_connection','p_version']
 end;
 if allowed is null or not p_args ?& allowed
  or exists(select 1 from jsonb_object_keys(p_args)k where not k=any(allowed))
  or (p_args ? 'p_expected_actor' and p_args->>'p_expected_actor' is distinct from actor::text) then
  raise exception 'operator_business_review_action_invalid' using errcode='22023';end if;
 old_context:=current_setting('openfolk.business_review',true);
 perform set_config('openfolk.business_review',jsonb_build_object('tenant',p_tenant,'actor',actor,'reason',btrim(p_reason))::text,true);
 case p_action
  when 'learn_commusoft_review_connections' then result:=public.learn_commusoft_review_connections(p_tenant);
  when 'learn_commusoft_review_page' then result:=public.learn_commusoft_review_page(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_review_search' then result:=public.learn_commusoft_review_search(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_search',p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_customer_candidates' then result:=public.learn_commusoft_customer_candidates(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',p_args->>'p_search',(p_args->>'p_after')::uuid,(p_args->>'p_limit')::integer);
  when 'learn_commusoft_contact_candidates' then result:=public.learn_commusoft_contact_candidates(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',p_args->>'p_search',(p_args->>'p_after')::uuid,(p_args->>'p_limit')::integer);
  when 'learn_commusoft_confirm_customer' then result:=public.learn_commusoft_confirm_customer(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',(p_args->>'p_target')::uuid,p_args->>'p_reason');
  when 'learn_commusoft_confirm_customer_identity' then result:=public.learn_commusoft_confirm_customer_identity(p_tenant,(p_args->>'p_version')::uuid,p_args->>'p_kind',(p_args->>'p_target')::uuid,p_args->>'p_reason',p_args->'p_identity');
  when 'learn_commusoft_work_review_page' then result:=public.learn_commusoft_work_review_page(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_kind',p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_work_review_search' then result:=public.learn_commusoft_work_review_search(p_tenant,(p_args->>'p_connection')::uuid,p_args->>'p_kind',p_args->>'p_search',p_args->>'p_after',(p_args->>'p_limit')::integer);
  when 'learn_commusoft_work_batch_result' then result:=public.learn_commusoft_work_batch_result(p_tenant,(p_args->>'p_request')::uuid);
  when 'learn_commusoft_work_batch' then result:=public.learn_commusoft_work_batch(p_tenant,(p_args->>'p_request')::uuid,(p_args->>'p_connection')::uuid,p_args->>'p_kind',p_args->'p_items',p_args->>'p_reason',(p_args->>'p_cancel')::boolean,(p_args->>'p_expected_actor')::uuid);
  when 'learn_commusoft_job_details' then result:=public.learn_commusoft_job_details(p_tenant,(p_args->>'p_connection')::uuid,(p_args->>'p_version')::uuid);
 end case;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 insert into public.controlplane_change_log(id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'business_review.result',p_action,p_tenant::text,
  jsonb_build_object('version_id',p_args->'p_version','request_id',p_args->'p_request',
   'entity_id',result->'entity_id','card_id',result->'card_id','batch_id',result->'batch_id',
   'row_count',case when jsonb_typeof(result->'rows')='array' then jsonb_array_length(result->'rows') end),
  btrim(p_reason),audit::text,false,'openfolk-business-review');
 perform set_config('openfolk.business_review',coalesce(old_context,''),true);
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','openfolk-business-review/1','tenant_id',p_tenant,'actor_id',actor,
  'action',p_action,'audit_id',audit,'observed_at',clock_timestamp(),'result',result);
end$function$
;
drop function public.learn_commusoft_job_refresh(uuid,uuid,uuid,uuid,text,text,text);drop function public.learn_commusoft_job_refresh_plan(uuid,uuid);drop function public.learn_commusoft_job_fields(jsonb,text);drop view public.learn_business_input_current_links;drop table public.learn_business_input_refresh_cancellations;drop table public.learn_business_input_refreshes;
commit;
