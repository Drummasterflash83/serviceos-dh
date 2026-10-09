-- Add subject-scoped evidence to the existing measurement model. No data is
-- seeded or scored, and no historical communications are changed.
begin;
alter table public.metric_definitions add column measurement_scope text not null default 'tenant'
 check(measurement_scope in ('tenant','performance'));
alter table public.measurements
 add column subject_kind text not null default 'tenant' check(subject_kind in ('tenant','member','team','job','customer')),
 add column subject_id uuid,
 add column policy_version_id uuid references public.config_versions(id),
 add column policy_id uuid,
 add column policy_revision integer,
 add column metric_key text,
 add column sample_count bigint,
 add column covered_count bigint,
 add column eligible_count bigint,
 add column source_through timestamptz,
 add column review_state text,
 add column exclusions jsonb,
 add column supersedes uuid references public.measurements(id),
 add column group_ids uuid[],
 add column request_payload jsonb,
 add column change_reason text;
alter table public.measurements add constraint measurements_performance_shape check(
 (subject_kind='tenant' and subject_id is null and policy_version_id is null and policy_id is null
  and policy_revision is null and metric_key is null and review_state is null and request_payload is null)
 or (subject_kind<>'tenant' and subject_id is not null and policy_version_id is not null
  and policy_id is not null and policy_revision is not null and policy_revision>0 and metric_key is not null
  and sample_count>=0 and sample_count<=9007199254740991 and sample_count is not null
  and covered_count>=0 and covered_count<=9007199254740991 and covered_count is not null
  and (eligible_count is null or (eligible_count>=covered_count and eligible_count<=9007199254740991))
  and window_start is not null and window_end is not null and isfinite(window_start) and isfinite(window_end)
  and window_start<window_end and isfinite(measured_at) and measured_at>=window_end
  and (source_through is null or (isfinite(source_through) and source_through<=measured_at))
  and review_state in ('inferred','confirmed','disputed') and review_state is not null
  and exclusions is not null and jsonb_typeof(exclusions)='array'
  and group_ids is not null and request_payload is not null and jsonb_typeof(request_payload)='object'
  and length(btrim(change_reason)) between 1 and 1000 and change_reason is not null)
);
create index measurements_performance_series on public.measurements
 (tenant_id,policy_id,policy_revision,subject_kind,subject_id,window_start,window_end)
 where subject_kind<>'tenant';
create unique index measurements_one_correction on public.measurements(supersedes) where supersedes is not null;
-- Existing tenant-wide objective reads remain unchanged; staff performance starts
-- with owner/admin visibility until explicit team/self access is implemented.
create policy measurements_performance_read on public.measurements as restrictive for select to authenticated
 using(subject_kind='tenant' or (tenant_id=public.current_tenant_id()
  and coalesce(public.current_user_role(),'') in ('owner','admin')));

create function public.learn_metric_scope_guard() returns trigger language plpgsql as $$
declare d public.metric_definitions%rowtype;
begin
 if tg_table_name='metric_definitions' then
  if new.measurement_scope is distinct from old.measurement_scope
   or (old.measurement_scope='performance' and (new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id or new.key is distinct from old.key
    or new.version_id is distinct from old.version_id)) then
   raise exception 'Metric scope is immutable' using errcode='23514';
  end if;
  return new;
 end if;
 if new.metric_id is null then return new; end if;
 select * into d from public.metric_definitions where id=new.metric_id for share;
 if not found or d.tenant_id<>new.tenant_id then
  raise exception 'Metric belongs to another tenant or is missing' using errcode='23514';
 end if;
 if tg_table_name='measurements' then
  if (new.subject_kind='tenant') is distinct from (d.measurement_scope='tenant') then
   raise exception 'Measurement and metric scopes differ' using errcode='23514';
  end if;
 elsif d.measurement_scope<>'tenant' then
  raise exception 'Performance metrics cannot drive company objectives' using errcode='23514';
 end if;
 return new;
end $$;
create trigger learn_metric_scope_guard before update on public.metric_definitions for each row execute function public.learn_metric_scope_guard();
create trigger learn_measurement_scope_guard before insert on public.measurements for each row execute function public.learn_metric_scope_guard();
create trigger learn_objective_metric_scope_guard before insert or update on public.objective_metrics for each row execute function public.learn_metric_scope_guard();
create trigger learn_objective_constraint_scope_guard before insert or update on public.objective_constraints for each row execute function public.learn_metric_scope_guard();

-- Trusted adapters may append unconfirmed observations. Human review/publication
-- is separate: callers cannot claim a confirmed score through this RPC.
create function public.learn_performance_append(p_tenant_id uuid,p_measurement jsonb,p_reason text)
 returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 p jsonb:=p_measurement;
 mid uuid:=(p->>'id')::uuid;
 pid uuid:=(p->>'policyId')::uuid;
 revision integer:=(p->>'policyVersion')::integer;
 sid uuid:=(p#>>'{subject,id}')::uuid;
 kind text:=p#>>'{subject,kind}';
 start_at timestamptz:=(p#>>'{period,start}')::timestamptz;
 end_at timestamptz:=(p#>>'{period,end}')::timestamptz;
 observed timestamptz:=(p->>'observedAt')::timestamptz;
 through_at timestamptz:=(p->>'sourceThrough')::timestamptz;
 previous uuid:=(p->>'supersedes')::uuid;
 policy jsonb;
 rule jsonb;
 v_version_id uuid;
 metric uuid;
 existing public.measurements%rowtype;
 parent public.measurements%rowtype;
 member public.team_members%rowtype;
 groups uuid[]:='{}';
 source_table text;
 ref jsonb;
 exclusion jsonb;
 exists_ref boolean;
begin
 if p_tenant_id is null or jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>262144
  or mid is null or pid is null or sid is null or revision is null or revision<1
  or (p->>'tenantId')::uuid is distinct from p_tenant_id
  or coalesce(kind,'') not in ('member','team','job','customer')
  or coalesce(p->>'review','')<>'inferred'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000
  or start_at is null or end_at is null or observed is null or not isfinite(start_at) or not isfinite(end_at)
  or not isfinite(observed) or start_at>=end_at or observed<end_at or observed>clock_timestamp()
  or (through_at is not null and (not isfinite(through_at) or through_at>observed))
  or jsonb_typeof(p->'value') not in ('number','null') or not (p ? 'value')
  or abs((p->>'value')::numeric)>1.7976931348623157e308
  or jsonb_typeof(p->'sampleCount') is distinct from 'number'
  or jsonb_typeof(p->'coveredCount') is distinct from 'number'
  or jsonb_typeof(p->'eligibleCount') not in ('number','null') or not (p ? 'eligibleCount')
  or (p->>'sampleCount')::numeric<>trunc((p->>'sampleCount')::numeric)
  or (p->>'coveredCount')::numeric<>trunc((p->>'coveredCount')::numeric)
  or ((p->>'eligibleCount')::numeric is not null and (p->>'eligibleCount')::numeric<>trunc((p->>'eligibleCount')::numeric))
  or jsonb_typeof(p->'evidence') is distinct from 'array' or jsonb_typeof(p->'exclusions') is distinct from 'array' then
  raise exception 'Invalid performance observation' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-performance:'||mid::text,0));
 select * into existing from public.measurements where id=mid;
 if found then
  if existing.tenant_id<>p_tenant_id or existing.request_payload is distinct from p
   or existing.change_reason is distinct from btrim(p_reason) then
   raise exception 'Measurement request identity changed' using errcode='40001';
  end if;
  return jsonb_build_object('measurementId',mid,'reused',true);
 end if;
 select e.value,c.id into policy,v_version_id from public.operating_profile_entries e
  join public.config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant_id and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=pid::text and e.value->>'version'=revision::text
   and c.artifact_kind='learn_scorecard' and c.version=revision and c.status in ('draft','published');
 if not found or policy->>'subjectKind' is distinct from kind then
  raise exception 'Unknown scorecard revision or subject kind' using errcode='22023';
 end if;
 select r into rule from jsonb_array_elements(policy->'metrics') r where r->>'key'=p->>'metricKey';
 if rule is null or rule->>'unit' is distinct from p->>'unit'
  or not coalesce((rule->'sourceSystems') ? (p->>'sourceSystem'),false) then
  raise exception 'Unknown measure, unit or source' using errcode='22023';
 end if;
 source_table:=case kind when 'member' then 'team_members' when 'team' then 'org_units'
  when 'job' then 'jobs' when 'customer' then 'customer_cards' end;
 execute format('select exists(select 1 from public.%I where tenant_id=$1 and id=$2)',source_table)
  into exists_ref using p_tenant_id,sid;
 if not exists_ref then raise exception 'Unknown tenant subject' using errcode='22023'; end if;
 if policy->>'groupId' is not null then
  if kind='team' and sid=(policy->>'groupId')::uuid then groups:=array[sid];
  elsif kind='member' then
   select * into member from public.team_members where id=sid and tenant_id=p_tenant_id for share;
   if member.org_unit_id is distinct from (policy->>'groupId')::uuid or member.confirmed_at is null
    or member.effective_from>start_at or (member.effective_to is not null and member.effective_to<end_at) then
    raise exception 'Team membership does not establish the entire period' using errcode='22023';
   end if;
   groups:=array[member.org_unit_id];
  else raise exception 'Subject differs from policy team' using errcode='22023'; end if;
 end if;
 if jsonb_array_length(p->'evidence') not between 1 and 1000 or jsonb_array_length(p->'exclusions')>100 then
  raise exception 'Evidence bounds exceeded' using errcode='22023';
 end if;
 for exclusion in select value from jsonb_array_elements(p->'exclusions') loop
  if jsonb_typeof(exclusion) is distinct from 'object' or length(btrim(coalesce(exclusion->>'reason',''))) not between 1 and 200
   or jsonb_typeof(exclusion->'count') is distinct from 'number' or (exclusion->>'count')::numeric<0
   or (exclusion->>'count')::numeric>9007199254740991
   or (exclusion->>'count')::numeric<>trunc((exclusion->>'count')::numeric)
   or jsonb_typeof(exclusion->'evidence') is distinct from 'array' then
   raise exception 'Invalid exclusion' using errcode='22023';
  end if;
  if jsonb_array_length(exclusion->'evidence') not between 1 and 1000 then
   raise exception 'Exclusion evidence required' using errcode='22023';
  end if;
 end loop;
 for ref in select value from jsonb_array_elements(p->'evidence')
  union all select ev.value from jsonb_array_elements(p->'exclusions') ex cross join lateral jsonb_array_elements(ex->'evidence') ev loop
  if coalesce(ref->>'table','') not in ('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members')
   or ref->>'id' is null then raise exception 'Unsupported evidence reference' using errcode='22023'; end if;
  execute format('select exists(select 1 from public.%I where tenant_id=$1 and id=$2)',ref->>'table')
   into exists_ref using p_tenant_id,(ref->>'id')::uuid;
  if not exists_ref then raise exception 'Missing or foreign evidence' using errcode='22023'; end if;
 end loop;
 insert into public.metric_definitions(tenant_id,key,name,unit,source_system,calculation_method,version_id,measurement_scope)
  values(p_tenant_id,'learn.scorecard.'||v_version_id::text||'.'||(p->>'metricKey'),rule->>'label',rule->>'unit',
   'learn_performance','evidence_adapter',v_version_id,'performance') on conflict(tenant_id,key) do nothing;
 select id into metric from public.metric_definitions where tenant_id=p_tenant_id
  and key='learn.scorecard.'||v_version_id::text||'.'||(p->>'metricKey')
  and measurement_scope='performance' and unit=rule->>'unit' and metric_definitions.version_id=v_version_id;
 if metric is null then raise exception 'Metric registry conflict' using errcode='40001'; end if;
 if previous is not null then
  select * into parent from public.measurements where id=previous for update;
  if not found or parent.tenant_id<>p_tenant_id or parent.metric_id<>metric
   or parent.subject_kind<>kind or parent.subject_id<>sid or parent.window_start<>start_at or parent.window_end<>end_at
   or parent.measured_at>=observed or exists(select 1 from public.measurements where supersedes=previous) then
   raise exception 'Correction history changed or differs in scope' using errcode='40001';
  end if;
 end if;
 insert into public.measurements(id,tenant_id,metric_id,value,unit,window_start,window_end,measured_at,source,evidence,
  subject_kind,subject_id,policy_version_id,policy_id,policy_revision,metric_key,sample_count,covered_count,eligible_count,
  source_through,review_state,exclusions,supersedes,group_ids,request_payload,change_reason)
 values(mid,p_tenant_id,metric,(p->>'value')::numeric,p->>'unit',start_at,end_at,observed,p->>'sourceSystem',p->'evidence',
  kind,sid,v_version_id,pid,revision,p->>'metricKey',(p->>'sampleCount')::bigint,(p->>'coveredCount')::bigint,(p->>'eligibleCount')::bigint,
  through_at,'inferred',p->'exclusions',previous,groups,p,btrim(p_reason));
 return jsonb_build_object('measurementId',mid,'reused',false);
end $$;
revoke all on function public.learn_performance_append(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.learn_performance_append(uuid,jsonb,text) to service_role;
commit;
