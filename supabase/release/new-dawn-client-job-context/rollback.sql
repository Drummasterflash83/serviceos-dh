-- Restore the previous audited job-detail read response after a frontend rollback.
-- Read one selected, uniquely retained Commusoft job from the existing
-- client/MD job home. Exact-detail facts appear only for an unchanged reviewed
-- canonical link and the same source version. No provider call or flag change.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.new_dawn_client_job_record(
 p_tenant uuid,p_connection uuid,p_external text,p_version uuid,p_reason text default null
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='10s' as $$
declare
 actor uuid:=auth.uid(); operator_read boolean:=p_reason is not null;
 flag_name text; source_time timestamptz; version_count integer; latest_id uuid;
 source_row public.learn_business_input_versions%rowtype;
 canonical_count integer; canonical_id uuid; canonical_valid boolean;
 receipt public.new_dawn_commusoft_job_detail_reads%rowtype;
 exact jsonb:=null; audit uuid:=gen_random_uuid(); checked timestamptz;
begin
 if actor is null or p_tenant is null or p_connection is null or p_version is null
  or p_external is null or p_external !~ '^[1-9][0-9]{0,15}$'
  or (p_reason is not null and length(btrim(p_reason)) not between 3 and 500)
 then raise exception 'client_job_record_invalid' using errcode='22023';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=clock_timestamp()) for share;
 if not found then raise exception 'client_job_record_forbidden' using errcode='42501';end if;
 if operator_read then
  perform public.learn_operator_input_access(p_tenant,actor,true);
  flag_name:='new_dawn.open_job_page.operator_preview';
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in ('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
   where v.actor_user_id=actor and v.ended_at is null
    and (v.expires_at is null or v.expires_at>clock_timestamp()))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor
     and g.permission in ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp())
  then raise exception 'client_job_record_forbidden' using errcode='42501';end if;
  flag_name:='new_dawn.open_job_page';
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=flag_name and value='true'::jsonb for share;
 if not found then raise exception 'client_job_record_disabled' using errcode='42501';end if;

 select max(pg.committed_at) into source_time
 from public.learn_business_input_versions v
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages pg on pg.id=o.page_id
  and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
  and pg.provider=v.provider and pg.collection=v.collection
 where v.tenant_id=p_tenant and v.connection_id=p_connection
  and v.provider='commusoft' and v.collection='jobs'
  and v.external_id=p_external;
 if source_time is null then raise exception 'client_job_record_unavailable' using errcode='42501';end if;
 select count(distinct v.id)::integer,min(v.id::text)::uuid into version_count,latest_id
 from public.learn_business_input_versions v
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages pg on pg.id=o.page_id
  and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
  and pg.provider=v.provider and pg.collection=v.collection
 where v.tenant_id=p_tenant and v.connection_id=p_connection
  and v.provider='commusoft' and v.collection='jobs'
  and v.external_id=p_external and pg.committed_at=source_time;
 if version_count<>1 or latest_id is distinct from p_version then
  raise exception 'client_job_record_changed' using errcode='42501';end if;
 select * into source_row from public.learn_business_input_versions v
 where v.id=p_version and v.tenant_id=p_tenant and v.connection_id=p_connection
  and v.provider='commusoft' and v.collection='jobs'
  and v.external_id=p_external for share;
 if not found or jsonb_typeof(source_row.payload->'id') is distinct from 'number'
  or source_row.payload->>'id' is distinct from p_external
 then raise exception 'client_job_record_unavailable' using errcode='42501';end if;

 -- A source user is named only on an exact, immutable provider receipt tied to
 -- the currently reviewed canonical job; it is not an OpenFolk assignment.
 select count(*)::integer,min(j.id::text)::uuid,
  bool_and(j.id is not null
   and j.source_system='commusoft:connection:'||p_connection::text
   and j.external_id=p_external
   and j.metadata#>>'{learn_business_input,source_version_id}'=p_version::text
   and l.source_version_id=p_version)
 into canonical_count,canonical_id,canonical_valid
 from public.learn_business_input_current_links l
 left join public.jobs j on j.id=l.entity_id and j.tenant_id=p_tenant
 where l.tenant_id=p_tenant and l.connection_id=p_connection
  and l.provider='commusoft' and l.collection='jobs'
  and l.external_id=p_external
  and l.entity_kind='job' and l.entity_table='jobs';
 if canonical_count=1 and canonical_valid then
  select * into receipt from public.new_dawn_commusoft_job_detail_reads r
  where r.tenant_id=p_tenant and r.connection_id=p_connection
   and r.external_id=p_external and r.source_version_id=p_version
   and r.job_id=canonical_id and r.state='complete'
   and r.result->>'tenant_id'=p_tenant::text
   and r.result->>'job_id'=canonical_id::text
   and r.result->>'source_version_id'=p_version::text
   and r.result->>'external_id'=p_external
   and r.result->>'version' in (
    'commusoft-exact-job-detail/1','commusoft-exact-job-detail/2',
    'commusoft-exact-job-detail/3','commusoft-exact-job-detail/4',
    'commusoft-exact-job-detail/5')
  order by r.checked_at desc,r.id desc limit 1;
  if found then
   exact:=jsonb_build_object(
    'checked_at',receipt.checked_at,
    'stage',left(nullif(btrim(receipt.result->>'stage'),''),200),
    'pipeline',left(nullif(btrim(receipt.result->>'pipeline'),''),200),
    'source_users',coalesce(receipt.result->'source_assigned_users','[]'::jsonb),
    'hold_reason',case when receipt.result#>>'{source_operational_facts,onHoldReasonDescription,state}'='present'
      then left(nullif(btrim(receipt.result#>>'{source_operational_facts,onHoldReasonDescription,value}'),''),200) end,
    'provider_updated_at',left(receipt.result->>'provider_updated_at',80));
  end if;
 end if;
 if operator_read then perform public.learn_operator_input_access(p_tenant,actor,true);end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=flag_name and value='true'::jsonb for share;
 if not found then raise exception 'client_job_record_disabled' using errcode='42501';end if;
 checked:=clock_timestamp();
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit,p_tenant,actor::text,
  case when operator_read then 'client_jobs.record_preview'
   else 'client_jobs.record_read' end,
  'jobs',p_external,jsonb_build_object('connection_id',p_connection,
   'source_version_id',p_version,'exact_detail',exact is not null,
   'source_observed_at',source_time),
  case when operator_read then btrim(p_reason) else 'Client job record' end,
  audit::text,false,'new-dawn-client-job-record');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-client-job-record/1',
  'tenant_id',p_tenant,'actor_id',actor,'connection_id',p_connection,
  'external_id',p_external,'source_version_id',p_version,
  'source_observed_at',source_time,'read_at',checked,'audit_id',audit,
  'status',left(source_row.payload->>'status',120),
  'priority',case when jsonb_typeof(source_row.payload->'priority')='string'
    then left(source_row.payload->>'priority',120) end,
  'description',case when jsonb_typeof(source_row.payload->'description')='string'
    then left(source_row.payload->>'description',4000) end,
  'exact_detail',exact);
end $$;
revoke all on function public.new_dawn_client_job_record(uuid,uuid,text,uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_client_job_record(uuid,uuid,text,uuid,text)
 to authenticated;
commit;
