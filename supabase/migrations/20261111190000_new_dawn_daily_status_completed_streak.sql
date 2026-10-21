-- Preserve the last completed qualifying streak while today's provider
-- sweep is pending. This changes a read-only coverage presentation, not the
-- status ledger, provider schedule, score policy or any job source.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.new_dawn_daily_status_coverage(
 p_tenant uuid, p_reason text default null
) returns jsonb language plpgsql security definer
 set search_path=pg_catalog set statement_timeout='20s' as $$
declare
 actor uuid:=auth.uid(); operator_read boolean:=p_reason is not null;
 as_of timestamptz:=statement_timestamp(); flag_name text;
 latest_day date; london_today date:=(as_of at time zone 'Europe/London')::date;
 latest_roster integer; latest_rows bigint;
 latest_observed bigint; latest_checked_at timestamptz;
 streak integer:=0; streak_start date; expected_day date;
 day_row record; audit_id uuid:=gen_random_uuid();
begin
 if actor is null or p_tenant is null or auth.role() is distinct from 'authenticated'
  then raise exception 'daily_status_coverage_forbidden' using errcode='42501';end if;
 perform 1 from auth.users u where u.id=actor and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=as_of) for share;
 if not found then raise exception 'daily_status_coverage_forbidden' using errcode='42501';end if;
 if operator_read then
  if length(btrim(p_reason)) not between 3 and 500 then
   raise exception 'daily_status_coverage_reason_invalid' using errcode='22023';end if;
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
   then raise exception 'daily_status_coverage_forbidden' using errcode='42501';end if;
  flag_name:='new_dawn.open_job_page';
 end if;
 perform 1 from public.feature_flags where tenant_id=p_tenant
  and flag=flag_name and value='true'::jsonb for share;
 if not found then raise exception 'daily_status_coverage_disabled' using errcode='42501';end if;

 select s.observation_day,s.candidate_count,count(d.id),
  count(d.id) filter(where d.state='observed'),max(d.observed_at)
 into latest_day,latest_roster,latest_rows,latest_observed,latest_checked_at
 from public.new_dawn_job_status_daily_seeds s
 left join public.new_dawn_job_status_daily d
  on d.tenant_id=s.tenant_id and d.connection_id=s.connection_id
   and d.observation_day=s.observation_day
 where s.tenant_id=p_tenant and s.observation_day=(
  select max(s2.observation_day) from public.new_dawn_job_status_daily_seeds s2
  where s2.tenant_id=p_tenant)
 group by s.observation_day,s.candidate_count;

 -- The current rollout has one configured Commusoft connection per tenant.
 -- Never combine different frozen rosters into an apparently complete day.
 if latest_day is not null and (
  select count(*) from public.new_dawn_job_status_daily_seeds s
  where s.tenant_id=p_tenant and s.observation_day=latest_day) <> 1
  then raise exception 'daily_status_coverage_ambiguous_roster' using errcode='22023';end if;
 if latest_day is not null and latest_rows>latest_roster then
  raise exception 'daily_status_coverage_roster_mismatch' using errcode='22023';end if;

 if latest_day is not null then
  expected_day:=latest_day;
  for day_row in
   select s.observation_day,s.candidate_count,count(d.id) row_count,
    count(d.id) filter(where d.state='observed') observed_count,
    count(distinct s.connection_id) connection_count
   from public.new_dawn_job_status_daily_seeds s
   left join public.new_dawn_job_status_daily d
    on d.tenant_id=s.tenant_id and d.connection_id=s.connection_id
     and d.observation_day=s.observation_day
   where s.tenant_id=p_tenant and s.observation_day between latest_day-27 and latest_day
   group by s.observation_day,s.candidate_count
   order by s.observation_day desc
  loop
   -- Today's frozen roster is still being checked. Keep the completed
   -- consecutive streak through yesterday visible; never count today until
   -- its own provider observations meet the 99% threshold. A missed prior
   -- day or a partial roster after midnight still breaks the streak.
   if day_row.observation_day=latest_day and latest_day=london_today
    and day_row.candidate_count>0
    and day_row.observed_count*100<day_row.candidate_count*99 then
    expected_day:=latest_day-1;
    continue;
   end if;
   if day_row.observation_day<>expected_day or day_row.connection_count<>1
    or day_row.candidate_count<=0 or day_row.row_count>day_row.candidate_count
    or day_row.observed_count*100<day_row.candidate_count*99 then exit;end if;
   streak:=streak+1;
   streak_start:=day_row.observation_day;
   expected_day:=expected_day-1;
  end loop;
 end if;

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
   then raise exception 'daily_status_coverage_forbidden' using errcode='42501';end if;
 end if;
 insert into public.controlplane_change_log
  (id,tenant_id,actor,action,resource_type,resource_id,after,reason,
   correlation_id,view_as_active,source)
 values(audit_id,p_tenant,actor::text,
  case when operator_read then 'client_jobs.daily_coverage_preview'
   else 'client_jobs.daily_coverage_read' end,
  'jobs',p_tenant::text,
  jsonb_build_object('snapshot_at',as_of,'day',latest_day,
   'roster',latest_roster,'observed',latest_observed,'streak',streak),
  case when operator_read then btrim(p_reason) else 'Client daily job status coverage' end,
  audit_id::text,false,'new-dawn-daily-status-coverage');
 perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
 return jsonb_build_object('version','new-dawn-daily-status-coverage/1',
  'tenant_id',p_tenant,'actor_id',actor,'audit_id',audit_id,
  'observed_at',clock_timestamp(),'snapshot_at',as_of,
  'day',latest_day,'roster_count',latest_roster,
  'observed_count',latest_observed,
  'missing_count',case when latest_roster is null then null else latest_roster-latest_observed end,
  'last_provider_check_at',latest_checked_at,
  'qualifying_streak_days',streak,'streak_start_day',streak_start,
  'earliest_moving_review_day',case when streak_start is null then null else streak_start+14 end);
end $$;

revoke all on function public.new_dawn_daily_status_coverage(uuid,text)
 from public,anon,service_role;
grant execute on function public.new_dawn_daily_status_coverage(uuid,text)
 to authenticated;
commit;
