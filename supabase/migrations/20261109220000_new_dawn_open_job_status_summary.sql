-- A small, auditable status summary for the client job home. Counts use the
-- same saved-source and conflict rules as new_dawn_open_job_page; they are not
-- a live provider count, a stage-age measure, or a performance score.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function public.new_dawn_open_job_status_summary(
 p_tenant uuid, p_reason text default null
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='20s' as $$
declare
 actor uuid:=auth.uid(); operator_read boolean:=p_reason is not null;
 as_of timestamptz:=statement_timestamp(); flag_name text;
 held bigint; pending_count bigint; open_count bigint; audit_id uuid:=gen_random_uuid();
begin
 if actor is null or p_tenant is null or auth.role() is distinct from 'authenticated'
  then raise exception 'open_job_summary_forbidden' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=as_of) for share;
 if not found then raise exception 'open_job_summary_forbidden' using errcode='42501';end if;
 if operator_read then
  if length(btrim(p_reason)) not between 3 and 500 then
   raise exception 'open_job_summary_reason_invalid' using errcode='22023';end if;
  perform public.learn_operator_input_access(p_tenant,actor,true);
  flag_name:='new_dawn.open_job_page.operator_preview';
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in ('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
   where v.actor_user_id=actor and v.ended_at is null
    and (v.expires_at is null or v.expires_at>as_of))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor and g.permission in
     ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=as_of
     and coalesce(g.effective_to,'infinity')>as_of)
   then raise exception 'open_job_summary_forbidden' using errcode='42501';end if;
  flag_name:='new_dawn.open_job_page';
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=flag_name and value='true'::jsonb for share;
 if not found then raise exception 'open_job_summary_disabled' using errcode='42501';end if;

 with latest_time as materialized (
  select v.connection_id,v.external_id,max(pg.committed_at) observed_at
  from public.learn_business_input_versions v
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages pg on pg.id=o.page_id
   and pg.tenant_id=v.tenant_id and pg.connection_id=v.connection_id
   and pg.provider=v.provider and pg.collection=v.collection
  where v.tenant_id=p_tenant and v.provider='commusoft'
   and v.collection='jobs' and pg.committed_at<=as_of
  group by v.connection_id,v.external_id
 ), unique_latest as materialized (
  select t.connection_id,t.external_id,t.observed_at,min(v.id::text)::uuid version_id
  from latest_time t
  join public.learn_business_input_versions v
   on v.tenant_id=p_tenant and v.connection_id=t.connection_id
    and v.provider='commusoft' and v.collection='jobs' and v.external_id=t.external_id
  join public.learn_business_input_observations o on o.version_id=v.id
  join public.learn_business_input_pages pg on pg.id=o.page_id
   and pg.tenant_id=p_tenant and pg.connection_id=t.connection_id
   and pg.provider='commusoft' and pg.collection='jobs'
   and pg.committed_at=t.observed_at
  group by t.connection_id,t.external_id,t.observed_at
  having count(distinct v.id)=1
 ), source_status as (
  select case v.payload->>'status' when 'Open' then 'open'
    when 'ongoing' then 'open' when 'pending' then 'pending'
    when 'on_hold' then 'on_hold' end status
  from unique_latest u join public.learn_business_input_versions v
   on v.id=u.version_id and v.tenant_id=p_tenant and v.connection_id=u.connection_id
    and v.provider='commusoft' and v.collection='jobs'
  where jsonb_typeof(v.payload->'id')='number'
   and v.payload->>'id'=u.external_id
 )
 select count(*) filter(where status='on_hold'),
  count(*) filter(where status='pending'),count(*) filter(where status='open')
 into held,pending_count,open_count from source_status;

 if operator_read then perform public.learn_operator_input_access(p_tenant,actor,true);
 else
  perform 1 from public.profiles p join public.tenants t on t.id=p.tenant_id
   where p.id=actor and p.tenant_id=p_tenant and p.role in ('owner','admin')
    and t.status='active' for share of p,t;
  if not found or exists(select 1 from public.view_as_context v
   where v.actor_user_id=actor and v.ended_at is null
    and (v.expires_at is null or v.expires_at>clock_timestamp()))
   or exists(select 1 from public.platform_authority_grants g
    where g.profile_id=actor and g.permission in
     ('platform.controlplane.view','platform.controlplane.admin')
     and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
     and coalesce(g.effective_to,'infinity')>clock_timestamp())
   then raise exception 'open_job_summary_forbidden' using errcode='42501';end if;
 end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,
  case when operator_read then 'client_jobs.status_summary_preview'
   else 'client_jobs.status_summary_read' end,
  'jobs',p_tenant::text,
  jsonb_build_object('snapshot_at',as_of,'on_hold',held,
   'pending',pending_count,'open',open_count),
  case when operator_read then btrim(p_reason) else 'Client open job status summary' end,
  audit_id::text,false,'new-dawn-open-job-status-summary');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-open-job-status-summary/1',
  'tenant_id',p_tenant,'actor_id',actor,'audit_id',audit_id,
  'observed_at',clock_timestamp(),'snapshot_at',as_of,
  'counts',jsonb_build_object('on_hold',held,'pending',pending_count,
   'open',open_count,'total',held+pending_count+open_count));
end $$;
revoke all on function public.new_dawn_open_job_status_summary(uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_open_job_status_summary(uuid,text)
 to authenticated;
commit;
