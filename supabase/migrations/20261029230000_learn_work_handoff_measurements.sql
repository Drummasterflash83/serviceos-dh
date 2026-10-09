-- First source adapter: observed outgoing ownership transfers, not speed or quality.
-- Source history and provider inputs are never modified.
create table public.learn_work_measurement_runs (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 member_id uuid not null references public.team_members(id),
 actor_id uuid not null,
 request jsonb not null,
 observed_at timestamptz not null,
 source_system text not null default 'serviceos.work.handoffs@1',
 metric_key text not null default 'work.recorded_handoffs',
 explanation text not null,
 proof jsonb not null check(octet_length(proof::text)<=1048576)
);
alter table public.learn_work_measurement_runs enable row level security;
revoke all on public.learn_work_measurement_runs from public,anon,authenticated,service_role;
grant select on public.learn_work_measurement_runs to authenticated;
create policy learn_work_measurement_runs_read on public.learn_work_measurement_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create trigger learn_work_measurement_runs_immutable before update or delete on public.learn_work_measurement_runs
 for each row execute function public.learn_member_history_immutable();
create trigger learn_work_measurement_runs_no_truncate before truncate on public.learn_work_measurement_runs
 for each statement execute function public.learn_member_history_immutable();

-- Retain the existing append contract and add one tenant-checked evidence source.
create or replace function public.learn_performance_append(p_tenant_id uuid,p_measurement jsonb,p_reason text)
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
  if coalesce(ref->>'table','') not in ('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs')
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

-- Server-side resolution mirrors the as-observed member-history contract.
-- Null means unresolved, never a guessed person or a zero performance result.
create function public.learn_handoff_owner(p_tenant uuid,p_roster jsonb,p_ref jsonb,p_at timestamptz)
returns text language plpgsql stable security definer set search_path=public as $$
declare m jsonb; e jsonb; state jsonb; found_owner text; n int:=0; ref_id uuid;
begin
 if p_ref is null or p_ref='null'::jsonb or p_ref->>'kind' not in ('member','user','team','org_unit') then return null; end if;
 begin ref_id:=(p_ref->>'ref')::uuid; exception when invalid_text_representation then return null; end;
 if ref_id is null then return null; end if;
 if p_ref->>'kind' in ('team','org_unit') then
   if exists(select 1 from org_units where tenant_id=p_tenant and id=ref_id) then return 'team:'||ref_id::text; end if;
   return null;
 end if;
 for m in select value from jsonb_array_elements(p_roster->'members') loop
   if p_ref->>'kind'='member' and m->>'memberId'<>ref_id::text then continue; end if;
   if m->>'coverageStart' is null then return null; end if;
   if (m->>'coverageStart')::timestamptz>p_at then
     if m->>'firstKind'='insert' then continue; else return null; end if;
   end if;
   select value into e from jsonb_array_elements(m->'events') where (value->>'observedAt')::timestamptz<=p_at
     order by (value->>'sequence')::bigint desc limit 1;
   if e is null then return null; end if;
   state:=e->'after';
   if p_ref->>'kind'='user' and state->>'profileId' is distinct from ref_id::text then continue; end if;
   if (state->>'effectiveFrom')::timestamptz>p_at or
     (state->>'effectiveTo' is not null and (state->>'effectiveTo')::timestamptz<=p_at) then continue; end if;
   n:=n+1;
   -- An unconfirmed duplicate must not be ignored in favour of a confirmed row.
   if state->>'confirmedAt' is null or (state->>'confirmedAt')::timestamptz>p_at then return null; end if;
   found_owner:='member:'||(m->>'memberId');
 end loop;
 if n=1 then return found_owner; end if;
 return null;
end $$;
revoke all on function public.learn_handoff_owner(uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;

create function public.learn_work_handoffs_collect(p_tenant uuid,p_member uuid,p_policy uuid,p_revision int,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); descriptor jsonb; prior learn_work_measurement_runs%rowtype;
 roster jsonb; history jsonb; o intelligence_objects%rowtype; first_capture object_state_history%rowtype;
 policy jsonb; rule jsonb; ev jsonb; before_owner text; after_owner text; at timestamptz;
 observed timestamptz:=statement_timestamp(); source_through timestamptz:=statement_timestamp();
 eligible int:=0; covered int:=0; transfers int:=0; total_events int:=0; object_complete boolean;
 proof jsonb; items jsonb:='[]'; credited jsonb:='[]'; issues jsonb:='[]'; payload jsonb; ack jsonb;
 count_objects int; result_value int;
begin
 -- Lock the actor's real profile, so revocation cannot race a long calculation.
 if actor is null or p_tenant is distinct from current_tenant_id() then
   raise exception 'Owner/admin access required' using errcode='42501'; end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found then raise exception 'Owner/admin access required' using errcode='42501'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 if p_member is null or p_policy is null or p_request is null or p_revision is null or p_revision<1
   or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
   or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days'
   or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
   raise exception 'A member, policy, completed period and reason are required' using errcode='22023'; end if;
 descriptor:=jsonb_build_object('memberId',p_member,'policyId',p_policy,'policyVersion',p_revision,
   'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into prior from learn_work_measurement_runs where id=p_request;
 if found then
   if prior.tenant_id<>p_tenant or prior.request is distinct from descriptor then
     raise exception 'Collection request identity changed' using errcode='40001'; end if;
   if not exists(select 1 from measurements where id=p_request and tenant_id=p_tenant) then
     raise exception 'Collection receipt is incomplete' using errcode='55000'; end if;
   return jsonb_build_object('measurementId',p_request,'reused',true);
 end if;
 perform 1 from team_members where id=p_member and tenant_id=p_tenant;
 if not found then raise exception 'Member not found in tenant' using errcode='22023'; end if;
 select e.value into policy from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text
   and c.artifact_kind='learn_scorecard' and c.version=p_revision and c.status in ('draft','published');
 if policy is null or policy->>'subjectKind'<>'member' or policy->>'groupId' is not null then
   raise exception 'Choose a company-wide member policy for recorded handoffs' using errcode='22023'; end if;
 select value into rule from jsonb_array_elements(policy->'metrics') where value->>'key'='work.recorded_handoffs';
 if rule is null or rule->>'unit'<>'handoffs' or not coalesce((rule->'sourceSystems') ? 'serviceos.work.handoffs@1',false) then
   raise exception 'Policy does not define the recorded handoff measure' using errcode='22023'; end if;
 -- Serialize one observation per exact cell. Refreshes must use a separately
 -- reviewed correction workflow, not create two competing independent counts.
 perform pg_advisory_xact_lock(hashtextextended('learn-handoff-cell:'||p_tenant::text||p_member::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind='member' and subject_id=p_member
   and policy_id=p_policy and policy_revision=p_revision and metric_key='work.recorded_handoffs'
   and window_start=p_start and window_end=p_end) then
   raise exception 'An observation already exists for this cell; review or correct it' using errcode='40001'; end if;
 roster:=learn_member_history_read(p_tenant,p_start,p_end);
 select count(*) into count_objects from intelligence_objects where tenant_id=p_tenant;
 if count_objects>2000 then raise exception 'Work population exceeds bounded collection; no partial score saved' using errcode='54000'; end if;
 for o in select * from intelligence_objects where tenant_id=p_tenant order by id loop
   select * into first_capture from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null
     order by capture_sequence limit 1;
   -- A proven database insertion after the period cannot contain period handoffs.
   if first_capture.capture_kind='insert' and first_capture.occurred_at>=p_end then continue; end if;
   eligible:=eligible+1;
   history:=learn_work_history_read(p_tenant,o.id,p_start,p_end);
   total_events:=total_events+(history->>'count')::int;
   if total_events>5000 then raise exception 'Work events exceed bounded collection' using errcode='54000'; end if;
   object_complete:=history->>'coverageStart' is not null and (
     (history->>'coverageStart')::timestamptz<=p_start or first_capture.capture_kind='insert');
   if history->>'sourceThrough' is not null then source_through:=least(source_through,(history->>'sourceThrough')::timestamptz); end if;
   for ev in select value from jsonb_array_elements(history->'events') loop
     at:=(ev->>'occurredAt')::timestamptz;
     if ev->>'kind'<>'update' or at<p_start or at>=p_end
       or ev#>'{before,responsible_ref}'='null'::jsonb or ev#>'{after,responsible_ref}'='null'::jsonb
       or ev#>'{before,responsible_ref}'=ev#>'{after,responsible_ref}' then continue; end if;
     before_owner:=learn_handoff_owner(p_tenant,roster,ev#>'{before,responsible_ref}',at);
     if before_owner is null then object_complete:=false; continue; end if;
     if before_owner<>'member:'||p_member::text then continue; end if;
     after_owner:=learn_handoff_owner(p_tenant,roster,ev#>'{after,responsible_ref}',at);
     if after_owner is null then object_complete:=false; continue; end if;
     if before_owner=after_owner then continue; end if; -- user/member aliases are not a transfer.
     transfers:=transfers+1;
     credited:=credited||jsonb_build_array(jsonb_build_object('objectId',o.id,'eventId',ev->>'id',
       'occurredAt',at,'from',before_owner,'to',after_owner));
   end loop;
   if object_complete then covered:=covered+1; else issues:=issues||jsonb_build_array(o.id); end if;
   items:=items||jsonb_build_array(jsonb_build_object('objectId',o.id,'complete',object_complete,
     'coverageStart',history->'coverageStart','sourceThrough',history->'sourceThrough',
     'eventIds',(select coalesce(jsonb_agg(v->'id'),'[]') from jsonb_array_elements(history->'events') v)));
 end loop;
 -- Even zero must be supported: unknown history never becomes zero handoffs.
 result_value:=case when covered=eligible then transfers else null end;
 proof:=jsonb_build_object('contract','work-handoffs@1','population','all retained intelligence objects',
   'value',result_value,'knownHandoffs',transfers,'eligibleItems',eligible,'coveredItems',covered,
   'incompleteObjectIds',issues,'items',items,'credited',credited,'membership',roster);
 if octet_length(proof::text)>1048576 then raise exception 'Calculation evidence exceeds retention limit' using errcode='54000'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 insert into learn_work_measurement_runs(id,tenant_id,member_id,actor_id,request,observed_at,explanation,proof)
 values(p_request,p_tenant,p_member,actor,descriptor,observed,
   'Recorded outgoing ownership transfers. Not speed, quality or hours worked. '
   ||covered||' of '||eligible||' retained work items have complete history/identity coverage. '
   ||case when result_value is null then 'Value withheld because coverage is incomplete.' else 'Confirmed review is still required.' end,proof);
 payload:=jsonb_build_object('id',p_request,'tenantId',p_tenant,'subject',jsonb_build_object('kind','member','id',p_member),
   'metricKey','work.recorded_handoffs','policyId',p_policy,'policyVersion',p_revision,
   'period',jsonb_build_object('start',p_start,'end',p_end),'value',result_value,'unit','handoffs',
   'sampleCount',covered,'coveredCount',covered,'eligibleCount',eligible,'observedAt',observed,
   'sourceThrough',case when covered=eligible then source_through end,'sourceSystem','serviceos.work.handoffs@1',
   'review','inferred','evidence',jsonb_build_array(jsonb_build_object('table','learn_work_measurement_runs','id',p_request)),
   'exclusions','[]'::jsonb);
 ack:=learn_performance_append(p_tenant,payload,btrim(p_reason));
 return ack;
end $$;
revoke all on function public.learn_work_handoffs_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_handoffs_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) to authenticated;
