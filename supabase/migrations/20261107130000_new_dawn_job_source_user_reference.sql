-- Held, operator-only cross-reference of one exact job receipt to retained
-- Commusoft /users versions. Install enables no flag, login or provider call.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_job_source_user_reference(
 p_tenant uuid,p_job uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();j public.jobs%rowtype;r public.new_dawn_commusoft_job_detail_reads%rowtype;
 v public.learn_business_input_versions%rowtype;u public.learn_business_input_versions%rowtype;
 cid uuid;vid uuid;external text;links integer;people jsonb;person jsonb;rows jsonb:='[]'::jsonb;
 uid text;seen text[]:='{}';captured timestamptz;audit uuid:=gen_random_uuid();
begin
 if auth.role() is distinct from 'authenticated' or p_job is null or p_reason is null
  or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'source_user_reference_invalid' using errcode='22023';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_source_user_reference' and value='true'::jsonb for share;
 if not found then raise exception 'source_user_reference_off' using errcode='42501';end if;
 select * into j from public.jobs where tenant_id=p_tenant and id=p_job for share;
 if not found then raise exception 'source_user_reference_unavailable' using errcode='42501';end if;
 select count(*)::integer,min(l.connection_id::text)::uuid,
  min(l.source_version_id::text)::uuid,min(l.external_id)
 into links,cid,vid,external from public.learn_business_input_current_links l
 where l.tenant_id=p_tenant and l.entity_kind='job' and l.entity_table='jobs'
  and l.entity_id=p_job and l.provider='commusoft' and l.collection='jobs';
 if links<>1 or external !~ '^[1-9][0-9]{0,15}$'
  or j.source_system is distinct from 'commusoft:connection:'||cid::text
  or j.external_id is distinct from external
  or j.metadata#>>'{learn_business_input,connection_id}' is distinct from cid::text
  or j.metadata#>>'{learn_business_input,source_version_id}' is distinct from vid::text then
  raise exception 'source_user_reference_link_changed' using errcode='42501';end if;
 v:=public.learn_business_input_latest(p_tenant,cid,'commusoft','jobs',external);
 if v.id is distinct from vid then
  raise exception 'source_user_reference_source_changed' using errcode='42501';end if;
 select * into r from public.new_dawn_commusoft_job_detail_reads
 where tenant_id=p_tenant and job_id=p_job and connection_id=cid
  and source_version_id=vid and external_id=external and state='complete'
 order by checked_at desc,id desc limit 1;
 if not found then raise exception 'source_user_reference_detail_missing' using errcode='42501';end if;
 if coalesce(r.result->>'version','') not in ('commusoft-exact-job-detail/1',
  'commusoft-exact-job-detail/2','commusoft-exact-job-detail/3',
  'commusoft-exact-job-detail/4','commusoft-exact-job-detail/5')
  or r.result->>'tenant_id' is distinct from p_tenant::text
  or r.result->>'job_id' is distinct from p_job::text
  or r.result->>'source_version_id' is distinct from vid::text
  or r.result->>'external_id' is distinct from external
  or jsonb_typeof(r.result->'source_assigned_users') is distinct from 'array'
  or jsonb_array_length(r.result->'source_assigned_users')>20 then
  raise exception 'source_user_reference_detail_invalid' using errcode='22023';end if;
 people:=r.result->'source_assigned_users';
 for person in select value from jsonb_array_elements(people) loop
  uid:=person->>'source_user_id';
  if jsonb_typeof(person) is distinct from 'object' or uid is null
   or uid !~ '^(0|[1-9][0-9]{0,15})$' or uid=any(seen)
   or jsonb_typeof(person->'name') is distinct from 'string'
   or length(person->>'name')>200 then
   raise exception 'source_user_reference_detail_invalid' using errcode='22023';end if;
  seen:=array_append(seen,uid);
  u:=public.learn_business_input_latest(p_tenant,cid,'commusoft','users',uid);
  if u.id is not null and (jsonb_typeof(u.payload->'id') is distinct from 'number'
   or u.payload->>'id' is distinct from uid) then
   raise exception 'source_user_reference_user_invalid' using errcode='22023';end if;
  captured:=null;
  if u.id is not null then
   select max(p.committed_at) into captured from public.learn_business_input_observations o
   join public.learn_business_input_pages p on p.id=o.page_id
   where o.version_id=u.id and p.tenant_id=p_tenant and p.connection_id=cid
    and p.provider='commusoft' and p.collection='users';
   if captured is null then raise exception 'source_user_reference_user_invalid' using errcode='22023';end if;
  end if;
  rows:=rows||jsonb_build_array(jsonb_build_object(
   'source_user_id',uid,'name_on_job_receipt',person->>'name',
   'state',case when u.id is null then 'source_record_not_captured' else 'source_record_retained' end,
   'source_user_version_id',u.id,'source_user_captured_at',captured,
   'identity','unverified','appointment','unverified'));
 end loop;
 -- A saved reference is valid only while this exact reviewed job link remains
 -- current. Do not return a newly stale source under a still-live operator JWT.
 perform 1 from public.jobs j2
 join public.learn_business_input_current_links l on l.tenant_id=j2.tenant_id
  and l.entity_id=j2.id and l.entity_kind='job' and l.entity_table='jobs'
  and l.provider='commusoft' and l.collection='jobs'
 where j2.tenant_id=p_tenant and j2.id=p_job and l.connection_id=cid
  and l.source_version_id=vid and l.external_id=external
  and j2.metadata#>>'{learn_business_input,source_version_id}'=vid::text;
 if not found or (select count(*) from public.learn_business_input_current_links
  where tenant_id=p_tenant and entity_id=p_job and entity_kind='job'
   and entity_table='jobs' and provider='commusoft' and collection='jobs')<>1 then
  raise exception 'source_user_reference_link_changed' using errcode='42501';end if;
 v:=public.learn_business_input_latest(p_tenant,cid,'commusoft','jobs',external);
 if v.id is distinct from vid then
  raise exception 'source_user_reference_source_changed' using errcode='42501';end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 perform public.new_dawn_commusoft_job_actor_access(p_tenant,actor);
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag='new_dawn.m2_source_user_reference' and value='true'::jsonb for share;
 if not found then raise exception 'source_user_reference_off' using errcode='42501';end if;
 insert into public.controlplane_change_log
 (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,'client_jobs.source_user_reference','jobs',p_job::text,
  jsonb_build_object('job_detail_request_id',r.id,'job_source_version_id',vid,
   'source_users_on_job',jsonb_array_length(rows)),btrim(p_reason),audit::text,false,
  'new-dawn-job-source-user-reference');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-job-source-user-reference/1',
  'tenant_id',p_tenant,'job_id',p_job,'actor_id',actor,'connection_id',cid,
  'job_source_version_id',vid,'job_detail_request_id',r.id,
  'job_detail_checked_at',r.checked_at,'users',rows,'audit_id',audit,
  'scope','source_identity_only');
end $$;
revoke all on function public.new_dawn_job_source_user_reference(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.new_dawn_job_source_user_reference(uuid,uuid,text)
 to authenticated;
commit;
