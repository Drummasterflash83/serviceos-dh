-- Add bounded, source-attributed job facts to the existing reviewed record.
-- This remains an operator review read; it neither publishes a canonical job
-- nor implies provider coverage for appointments, estimates or invoices.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.learn_commusoft_job_details(p_tenant uuid,p_connection uuid,p_version uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare v public.learn_business_input_versions%rowtype;latest public.learn_business_input_versions%rowtype;
 fields jsonb:='{}';dates jsonb;field text;value text;observed timestamptz;
begin
 if p_tenant is null or p_connection is null or p_version is null then raise exception 'business_input_job_scope_required' using errcode='22023';end if;
 perform public.learn_business_input_review_access(p_tenant,p_connection);
 select * into v from public.learn_business_input_versions where tenant_id=p_tenant and connection_id=p_connection
  and id=p_version and provider='commusoft' and collection='jobs';
 if not found then raise exception 'business_input_job_unavailable' using errcode='22023';end if;
 select max(p.committed_at) into observed from public.learn_business_input_observations o join public.learn_business_input_pages p on p.id=o.page_id
  where o.version_id=v.id and p.tenant_id=v.tenant_id and p.connection_id=v.connection_id and p.provider=v.provider and p.collection=v.collection;
 if observed is null then raise exception 'business_input_job_unavailable' using errcode='22023';end if;
 latest:=public.learn_business_input_latest(p_tenant,p_connection,'commusoft','jobs',v.external_id);
 foreach field in array array['description','status','priority','customerReference','businessUnit','userGroup','quotedAmount'] loop
  value:=case when jsonb_typeof(v.payload->field)='string' then v.payload->>field end;
  fields:=fields||jsonb_build_object(field,jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 end loop;
 value:=case when jsonb_typeof(v.payload->'closed'->'closedOutcome')='string' then v.payload->'closed'->>'closedOutcome' end;
 fields:=fields||jsonb_build_object('closedOutcome',jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 value:=case when jsonb_typeof(v.payload->'customerContact'->'fullName')='string' then v.payload->'customerContact'->>'fullName' end;
 fields:=fields||jsonb_build_object('customerContactName',jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 value:=case when jsonb_typeof(v.payload->'siteContact'->'fullName')='string' then v.payload->'siteContact'->>'fullName' end;
 fields:=fields||jsonb_build_object('siteContactName',jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 value:=case when jsonb_typeof(v.payload->'completed'->'completedByUser')='string' then v.payload->'completed'->>'completedByUser' end;
 fields:=fields||jsonb_build_object('completedBySourceUser',jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 value:=case when jsonb_typeof(v.payload->'closed'->'closedByUser')='string' then v.payload->'closed'->>'closedByUser' end;
 fields:=fields||jsonb_build_object('closedBySourceUser',jsonb_build_object('value',left(value,4000),'shortened',coalesce(length(value)>4000,false)));
 dates:=jsonb_build_object('created',public.learn_business_input_time_detail(v.payload->'createdOnDateTime'),
  'reported',public.learn_business_input_time_detail(v.payload->'jobReportedDateTime'),
  'completed',public.learn_business_input_time_detail(case when v.payload->'completed' is null or v.payload->'completed'='null'::jsonb or jsonb_typeof(v.payload->'completed')='object' then v.payload->'completed'->'completedOnDateTime' else '{}'::jsonb end),
  'closed',public.learn_business_input_time_detail(case when v.payload->'closed' is null or v.payload->'closed'='null'::jsonb or jsonb_typeof(v.payload->'closed')='object' then v.payload->'closed'->'closedOnDateTime' else '{}'::jsonb end));
 return jsonb_build_object('version','commusoft-job-detail/2','tenant_id',p_tenant,'connection_id',p_connection,'version_id',v.id,
  'external_id',v.external_id,'observed_at',observed,'current',latest.id is not distinct from v.id,
  'property_reference',case when jsonb_typeof(v.payload->'propertyID')='number' and v.payload->>'propertyID'~'^[1-9][0-9]{0,15}$' and (v.payload->>'propertyID')::numeric<=9007199254740991 then v.payload->>'propertyID' end,
  'fields',fields,'dates',dates);
end $$;
revoke all on function public.learn_commusoft_job_details(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_commusoft_job_details(uuid,uuid,uuid) to authenticated;
commit;
