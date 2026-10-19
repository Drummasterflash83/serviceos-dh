-- One audited OpenFolk read of a canonical job's exact reviewed Commusoft source.
-- No source guessing, provider request, client grant or data mutation on install.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.new_dawn_operator_job_source(p_tenant uuid,p_job uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare actor uuid:=auth.uid();j public.jobs%rowtype;link_count integer;
 connection_id uuid;source_version_id uuid;external_id text;source jsonb:=null;
 state text;old_context text;audit_id uuid:=gen_random_uuid();checked timestamptz;
begin
 perform public.learn_operator_input_access(p_tenant,actor,true);
 if p_job is null or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
  raise exception 'new_dawn_job_source_invalid' using errcode='22023';end if;
 select * into j from public.jobs where tenant_id=p_tenant and id=p_job for share;
 if not found then raise exception 'new_dawn_job_source_unavailable' using errcode='42501';end if;
 select count(*)::integer,min(l.connection_id::text)::uuid,min(l.source_version_id::text)::uuid,
  min(l.external_id)
 into link_count,connection_id,source_version_id,external_id
 from public.learn_business_input_current_links l
 join public.learn_business_input_versions v on v.id=l.source_version_id
  and v.tenant_id=l.tenant_id and v.connection_id=l.connection_id
  and v.provider=l.provider and v.collection=l.collection and v.external_id=l.external_id
 where l.tenant_id=p_tenant and l.entity_id=p_job and l.entity_kind='job' and l.entity_table='jobs'
  and l.provider='commusoft' and l.collection='jobs';
 if link_count=0 then state:='unlinked';
 elsif link_count<>1 or j.metadata#>>'{learn_business_input,source_version_id}' is distinct from source_version_id::text
  then state:='review_required';
 else
  old_context:=current_setting('openfolk.business_review',true);
  perform set_config('openfolk.business_review',jsonb_build_object('tenant',p_tenant,
   'actor',actor,'reason',btrim(p_reason))::text,true);
  source:=public.learn_commusoft_job_details(p_tenant,connection_id,source_version_id);
  perform set_config('openfolk.business_review',coalesce(old_context,''),true);
  if source->>'version' is distinct from 'commusoft-job-detail/2'
   or source->>'external_id' is distinct from external_id then
   raise exception 'new_dawn_job_source_contract_changed' using errcode='22023';end if;
  state:='linked';
 end if;
 perform public.learn_operator_input_access(p_tenant,actor,true);
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,'client_jobs.source_detail','jobs',p_job::text,
  jsonb_build_object('state',state,'connection_id',case when state='linked' then connection_id end,
   'source_version_id',case when state='linked' then source_version_id end),
  btrim(p_reason),audit_id::text,false,'new-dawn-job-source');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-operator-job-source/1','tenant_id',p_tenant,
  'actor_id',actor,'job_id',p_job,'audit_id',audit_id,'observed_at',checked,
  'state',state,'source',source);
end $$;
revoke all on function public.new_dawn_operator_job_source(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.new_dawn_operator_job_source(uuid,uuid,text) to authenticated;
commit;
