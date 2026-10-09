-- Generated TEST-only forward work capture/collection. No historical baseline.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_measurements_reviews_v1' and source_sha256='8a1b32fd0a1896946a7a6f79dd3598eabfec237ca418a4fab6d3b7ee155a15e8' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified measurement prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_work_capture_collectors_v1') then raise exception 'Work release already exists';end if;
 if to_regclass('public.learn_work_measurement_runs') is not null or to_regclass('public.learn_work_capture_sequence') is not null then raise exception 'Work capture objects already exist';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_work_history_immutable','learn_work_snapshot','learn_capture_work_change','learn_work_capture_baseline','learn_work_history_read','learn_work_handoffs_collect','learn_handoff_owner','learn_work_residence_collect'])) then raise exception 'Work function already exists';end if;
end $$;
-- SOURCE 20261029180000_learn_work_transition_history.sql
-- Original SHA-256 60fa23defd764b107b4f75c2c57335e92d7835035966ac526c1047812e7f695b
-- Extend the existing work ledger, preserving every historical row. Atomic
-- persistence is adapted from serviceos-dh commit 27eb4ad's work_transition_apply.
-- Old rows have NULL snapshots: they do not prove historical ownership intervals.
alter table public.object_state_history
  add column work_before jsonb,
  add column work_after jsonb,
  add column transition_verb text;
alter table public.object_state_history add constraint osh_work_snapshot_pair check (
  (work_before is null and work_after is null and transition_verb is null) or
  (work_before is not null and work_after is not null
    and jsonb_typeof(work_before) = 'object' and jsonb_typeof(work_after) = 'object'
    and work_before ?& array['status','version','responsible_ref','accountable_ref','waiting_on_ref','attributes']
    and work_after ?& array['status','version','responsible_ref','accountable_ref','waiting_on_ref','attributes']
    and transition_verb is not null)
);
create index osh_work_snapshot_lookup on public.object_state_history(tenant_id, object_id, occurred_at, id)
  where work_before is not null;

create function public.learn_work_history_immutable() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.work_before is not null or (tg_op='UPDATE' and new.work_before is not null) then
    raise exception 'Structured work history is append-only';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger learn_work_history_immutable before update or delete on public.object_state_history
  for each row execute function public.learn_work_history_immutable();
revoke insert, update, delete, truncate on public.object_state_history from public, anon, authenticated;
revoke truncate on public.object_state_history from service_role;


-- SOURCE 20261029190000_learn_work_source_capture.sql
-- Original SHA-256 7fad2334d4ecf1bca5f4dcdbca6349a0879355aacc896d01cfd85dcc900e2243
-- Complete forward capture on the existing work ledger, including background
-- writers. No historical timestamps/owners are reconstructed or rewritten.
alter table public.object_state_history
  add column capture_kind text check(capture_kind in ('insert','update','baseline')),
  add column capture_sequence bigint;
alter table public.object_state_history add constraint osh_capture_shape check (
  (capture_kind is null and capture_sequence is null) or
  (capture_kind is not null and capture_sequence is not null and capture_sequence>0
    and work_before is not null and work_after is not null)
);
create sequence public.learn_work_capture_sequence;
create unique index osh_capture_sequence on public.object_state_history(capture_sequence)
  where capture_sequence is not null;
create index osh_capture_read on public.object_state_history(tenant_id,object_id,occurred_at,capture_sequence)
  where capture_kind is not null;

create function public.learn_work_snapshot(p public.intelligence_objects) returns jsonb
language sql immutable set search_path=public as $$
  select jsonb_build_object('status',p.status,'version',p.version,
    'responsible_ref',p.responsible_ref,'accountable_ref',p.accountable_ref,
    'waiting_on_ref',p.waiting_on_ref,'attributes',p.attributes);
$$;

create function public.learn_capture_work_change() returns trigger
language plpgsql security definer set search_path=public as $$
declare b jsonb; a jsonb;
begin
  a:=learn_work_snapshot(new);
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
      raise exception 'Work identity and tenant are immutable' using errcode='23514';
    end if;
    b:=learn_work_snapshot(old);
    if a=b then return new; end if;
  else b:=a;
  end if;
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
    occurred_at,work_before,work_after,transition_verb,capture_kind,capture_sequence)
  values(new.tenant_id,new.id,b->>'status',a->>'status',
    '{"kind":"system","ref":"database_work_capture"}',
    'Database-observed work change; actor attribution is separate transition evidence',
    clock_timestamp(),b,a,'observed_'||lower(tg_op),lower(tg_op),nextval('learn_work_capture_sequence'));
  return new;
end $$;
create trigger learn_capture_work_change after insert or update on public.intelligence_objects
  for each row execute function public.learn_capture_work_change();

-- Explicit, bounded baseline for an existing item. It starts coverage NOW,
-- never at created_at and never at a guessed historical assignment time.
create function public.learn_work_capture_baseline(p_tenant uuid,p_object uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare o intelligence_objects%rowtype; snapshot jsonb; result uuid;
begin
  select * into o from intelligence_objects where tenant_id=p_tenant and id=p_object for update;
  if not found then raise exception 'Work item not found in tenant' using errcode='P0002'; end if;
  select id into result from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null order by capture_sequence limit 1;
  if found then return result; end if;
  snapshot:=learn_work_snapshot(o);
  insert into object_state_history(tenant_id,object_id,from_state,to_state,actor,reason,
    occurred_at,work_before,work_after,transition_verb,capture_kind,capture_sequence)
  values(p_tenant,p_object,o.status,o.status,'{"kind":"system","ref":"database_work_baseline"}',
    'Current state baseline; prior ownership duration is unknown',clock_timestamp(),snapshot,snapshot,
    'observed_baseline','baseline',nextval('learn_work_capture_sequence')) returning id into result;
  return result;
end $$;

-- One statement snapshot: period events, preceding state, capture watermark and
-- current object agree. A browser cannot declare history complete using a count
-- from a different read. The reader never creates baselines or writes anything.
create function public.learn_work_history_read(p_tenant uuid,p_object uuid,p_start timestamptz,p_end timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  o intelligence_objects%rowtype; head object_state_history%rowtype;
  coverage_start timestamptz; predecessor bigint; event_count int; events jsonb;
  observed timestamptz:=statement_timestamp(); result jsonb;
begin
  if auth.uid() is null or p_tenant is distinct from current_tenant_id()
    or coalesce(current_user_role(),'') not in ('owner','admin') then
    raise exception 'Owner/admin access in this tenant required' using errcode='42501';
  end if;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days' then
    raise exception 'Choose a completed period of at most 366 days' using errcode='22023';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass
    and tgname='learn_capture_work_change' and tgenabled in ('O','A')) then
    raise exception 'Work capture is unavailable' using errcode='55000';
  end if;
  select * into o from intelligence_objects where id=p_object and tenant_id=p_tenant;
  if not found then raise exception 'Work item unavailable in tenant' using errcode='P0002'; end if;
  select * into head from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null order by capture_sequence desc limit 1;
  if found and (head.work_after is distinct from learn_work_snapshot(o) or head.occurred_at>observed) then
    raise exception 'Current work state does not reconcile with captured history' using errcode='55000';
  end if;
  if exists(select 1 from (
    select occurred_at,work_before,
      lag(occurred_at) over(order by capture_sequence) prior_at,
      lag(work_after) over(order by capture_sequence) prior_state
    from object_state_history where tenant_id=p_tenant and object_id=p_object and capture_kind is not null
  ) h where occurred_at<prior_at or (prior_state is not null and work_before is distinct from prior_state)) then
    raise exception 'Work capture contains an unexplained history gap' using errcode='55000';
  end if;
  select min(occurred_at) into coverage_start from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null;
  select capture_sequence into predecessor from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null and occurred_at<p_start
    order by capture_sequence desc limit 1;
  select count(*) into event_count from object_state_history where tenant_id=p_tenant and object_id=p_object
    and capture_kind is not null and (capture_sequence=predecessor or occurred_at between p_start and p_end);
  if event_count>1000 then raise exception 'Work history exceeds this bounded review window' using errcode='54000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'tenantId',tenant_id,'objectId',object_id,'sequence',capture_sequence::text,
    'kind',capture_kind,'occurredAt',occurred_at,'before',work_before,'after',work_after
  ) order by capture_sequence),'[]') into events from object_state_history
    where tenant_id=p_tenant and object_id=p_object and capture_kind is not null
    and (capture_sequence=predecessor or occurred_at between p_start and p_end);
  result:=jsonb_build_object('tenantId',p_tenant,'objectId',p_object,
    'period',jsonb_build_object('start',p_start,'end',p_end),'observedAt',observed,
    'sourceThrough',case when coverage_start is not null then observed end,
    'coverageStart',coverage_start,'count',event_count,'events',events,
    'contract','work-capture@1');
  if octet_length(result::text)>2097152 then raise exception 'Work history exceeds review payload limit' using errcode='54000'; end if;
  return result;
end $$;
revoke all on sequence public.learn_work_capture_sequence from public,anon,authenticated,service_role;
revoke all on function public.learn_work_snapshot(public.intelligence_objects),
  public.learn_capture_work_change(),public.learn_work_capture_baseline(uuid,uuid),
  public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_capture_baseline(uuid,uuid) to service_role;
grant execute on function public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) to authenticated;

-- SOURCE 20261029230000_learn_work_handoff_measurements.sql
-- Original SHA-256 95a8dfa1afaaef4c81ef504498ad9905fcf2b1f47c854d06dd76bcc075d9e5fc
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

-- SOURCE 20261030010000_learn_work_residence_measurements.sql
-- Original SHA-256 a3fc08c70b854dcade484eb8f9ab4b6656e78f7032e5b50cff3c6ed71edc36f4
create or replace function public.learn_handoff_owner(p_tenant uuid,p_roster jsonb,p_ref jsonb,p_at timestamptz)
returns text language plpgsql stable security definer set search_path=public as $$
declare m jsonb; e jsonb; state jsonb; found_owner text; n int:=0; ref_id uuid;
begin
 if p_ref is null or p_ref='null'::jsonb or coalesce(p_ref->>'kind','') not in ('member','user','team','org_unit') then return null; end if;
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

-- Source-owned elapsed item-minutes; no calendar or productivity claim.
-- Uses preserved capture history without modifying source records.
create function public.learn_work_residence_collect(p_tenant uuid,p_member uuid,p_policy uuid,p_revision int,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare actor uuid:=auth.uid(); descriptor jsonb; prior learn_work_measurement_runs%rowtype;
 roster jsonb; history jsonb; o intelligence_objects%rowtype; first_capture object_state_history%rowtype;
 policy jsonb; rule jsonb; ev jsonb; next_ev jsonb; owner text;
 interval_start timestamptz; interval_end timestamptz; segment_start timestamptz; segment_end timestamptz;
 boundaries timestamptz[]; points timestamptz[]; i int; j int; segment_count int:=0;
 observed timestamptz:=statement_timestamp(); source_through timestamptz:=statement_timestamp();
 eligible int:=0; covered int:=0; item_minutes numeric:=0; total_events int:=0; object_complete boolean;
 proof jsonb; items jsonb:='[]'; credited jsonb:='[]'; issues jsonb:='[]'; payload jsonb; ack jsonb;
 count_objects int; result_value numeric;
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
   'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor,'algorithm','work-residence@1');
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
 if policy is null or policy->>'subjectKind' is distinct from 'member' or policy->>'groupId' is not null then
   raise exception 'Choose a company-wide member policy for owned item minutes' using errcode='22023'; end if;
 select value into rule from jsonb_array_elements(policy->'metrics') where value->>'key'='work.owned_item_minutes';
 if rule is null or rule->>'unit' is distinct from 'item_minutes' or not coalesce((rule->'sourceSystems') ? 'serviceos.work.residence@1',false) then
   raise exception 'Policy does not define the owned item-minute measure' using errcode='22023'; end if;
 -- Serialize one observation per exact cell. Refreshes must use a separately
 -- reviewed correction workflow, not create two competing independent counts.
 perform pg_advisory_xact_lock(hashtextextended('learn-residence-cell:'||p_tenant::text||p_member::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind='member' and subject_id=p_member
   and policy_id=p_policy and policy_revision=p_revision and metric_key='work.owned_item_minutes'
   and window_start=p_start and window_end=p_end) then
   raise exception 'An observation already exists for this cell; review or correct it' using errcode='40001'; end if;
 roster:=learn_member_history_read(p_tenant,p_start,p_end);
 -- Ownership can change meaning without a work write: split at roster capture,
 -- effective-from/to and confirmation boundaries before resolving identity.
 select coalesce(array_agg(distinct boundary order by boundary),'{}'::timestamptz[]) into boundaries from (
   select (m->>'coverageStart')::timestamptz boundary from jsonb_array_elements(roster->'members') m
   union all select (e->>'observedAt')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveFrom}')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveTo}')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,confirmedAt}')::timestamptz from jsonb_array_elements(roster->'members') m
     cross join lateral jsonb_array_elements(m->'events') e
 ) b where boundary>p_start and boundary<p_end;
 select count(*) into count_objects from intelligence_objects where tenant_id=p_tenant;
 if count_objects>2000 then raise exception 'Work population exceeds bounded collection; no partial score saved' using errcode='54000'; end if;
 for o in select * from intelligence_objects where tenant_id=p_tenant order by id loop
   select * into first_capture from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null
     order by capture_sequence limit 1;
   -- A proven database insertion after the period cannot contain period ownership.
   if first_capture.capture_kind='insert' and first_capture.occurred_at>=p_end then continue; end if;
   eligible:=eligible+1;
   history:=learn_work_history_read(p_tenant,o.id,p_start,p_end);
   total_events:=total_events+(history->>'count')::int;
   if total_events>5000 then raise exception 'Work events exceed bounded collection' using errcode='54000'; end if;
   object_complete:=history->>'coverageStart' is not null and (
     (history->>'coverageStart')::timestamptz<=p_start or first_capture.capture_kind='insert');
   if history->>'sourceThrough' is not null then source_through:=least(source_through,(history->>'sourceThrough')::timestamptz); end if;
   for i in 0..jsonb_array_length(history->'events')-1 loop
     ev:=history->'events'->i;
     next_ev:=history->'events'->(i+1);
     interval_start:=greatest(p_start,(ev->>'occurredAt')::timestamptz);
     interval_end:=least(p_end,coalesce((next_ev->>'occurredAt')::timestamptz,p_end));
     if interval_end<=interval_start then continue; end if;
     points:=array[interval_start]||array(select b from unnest(boundaries) b
       where b>interval_start and b<interval_end order by b)||array[interval_end];
     for j in 1..cardinality(points)-1 loop
       segment_count:=segment_count+1;
       if segment_count>10000 then raise exception 'Attribution segments exceed bounded collection' using errcode='54000'; end if;
       segment_start:=points[j]; segment_end:=points[j+1];
       if ev#>'{after,responsible_ref}' is null or ev#>'{after,responsible_ref}'='null'::jsonb then continue; end if;
       owner:=learn_handoff_owner(p_tenant,roster,ev#>'{after,responsible_ref}',segment_start);
       if owner is null then object_complete:=false; continue; end if;
       if owner<>'member:'||p_member::text then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',o.id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
         'waitingOn',ev#>'{after,waiting_on_ref}',
         'workEventIds',case when next_ev is null then jsonb_build_array(ev->>'id') else jsonb_build_array(ev->>'id',next_ev->>'id') end));
     end loop;
   end loop;
   if object_complete then covered:=covered+1; else issues:=issues||jsonb_build_array(o.id); end if;
   items:=items||jsonb_build_array(jsonb_build_object('objectId',o.id,'complete',object_complete,
     'coverageStart',history->'coverageStart','sourceThrough',history->'sourceThrough',
     'eventIds',(select coalesce(jsonb_agg(v->'id'),'[]') from jsonb_array_elements(history->'events') v)));
 end loop;
 -- Even zero must be supported: unknown history never becomes zero residence.
 result_value:=case when covered=eligible then item_minutes else null end;
 proof:=jsonb_build_object('contract','work-residence@1','population','all retained intelligence objects',
   'value',result_value,'knownItemMinutes',item_minutes,'eligibleItems',eligible,'coveredItems',covered,
   'incompleteObjectIds',issues,'items',items,'credited',credited,'membership',roster);
 if octet_length(proof::text)>1048576 then raise exception 'Calculation evidence exceeds retention limit' using errcode='54000'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 insert into learn_work_measurement_runs(id,tenant_id,member_id,actor_id,request,observed_at,explanation,proof,source_system,metric_key)
 values(p_request,p_tenant,p_member,actor,descriptor,observed,
   'Elapsed owned item-minutes across all recorded states, including waiting and closed states. Concurrent items add separately; this is not working hours, speed or productivity. No business calendar or delay exclusion applied. '
   ||covered||' of '||eligible||' retained work items have complete history/identity coverage. '
   ||case when result_value is null then 'Value withheld because coverage is incomplete.' else 'Confirmed review is still required.' end,proof,'serviceos.work.residence@1','work.owned_item_minutes');
 payload:=jsonb_build_object('id',p_request,'tenantId',p_tenant,'subject',jsonb_build_object('kind','member','id',p_member),
   'metricKey','work.owned_item_minutes','policyId',p_policy,'policyVersion',p_revision,
   'period',jsonb_build_object('start',p_start,'end',p_end),'value',result_value,'unit','item_minutes',
   'sampleCount',covered,'coveredCount',covered,'eligibleCount',eligible,'observedAt',observed,
   'sourceThrough',case when covered=eligible then source_through end,'sourceSystem','serviceos.work.residence@1',
   'review','inferred','evidence',jsonb_build_array(jsonb_build_object('table','learn_work_measurement_runs','id',p_request)),
   'exclusions','[]'::jsonb);
 ack:=learn_performance_append(p_tenant,payload,btrim(p_reason));
 return ack;
end $$;
revoke all on function public.learn_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) to authenticated;

-- SOURCE 20261030060000_learn_work_collection_release_guards.sql
-- Original SHA-256 513e1070acd01fc80b9e5e8ae1d3835eedb612427c94518008c6927f85e47313
-- Preserve the current validated append implementation when adding work receipts.
-- On a complete migration replay this evidence source is already present; the
-- selective TEST release adds it without overwriting newer membership guards.
do $patch$ declare d text; old_list text; new_list text; signature text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into d;
 old_list:=$old$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members')$old$;
 new_list:=$new$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs')$new$;
 if array_length(string_to_array(d,old_list),1)=2 then execute replace(d,old_list,new_list);
 elsif array_length(string_to_array(d,new_list),1)<>2 then raise exception 'Unexpected adapter evidence contract';end if;
 foreach signature in array array[
  'public.learn_work_handoffs_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text)',
  'public.learn_work_residence_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text)'
 ] loop
  select pg_get_functiondef(to_regprocedure(signature)) into d;
  if d is null or array_length(string_to_array(d,'errcode=''40001'''),1)<>3 then
   raise exception 'Unexpected collection conflict contract';end if;
  execute replace(d,'errcode=''40001''','errcode=''PT409''');
 end loop;
end $patch$;
-- The retained row trigger does not cover a whole-table TRUNCATE.
create trigger learn_work_history_no_truncate before truncate on public.object_state_history
 for each statement execute function public.learn_member_history_immutable();
alter table public.learn_work_measurement_runs add constraint learn_work_measurement_actor_fkey
 foreign key(actor_id) references public.profiles(id);
-- Put temporary schemas last explicitly in every released work function.
alter function public.learn_work_history_immutable() set search_path=public,pg_temp;
alter function public.learn_work_snapshot(public.intelligence_objects) set search_path=public,pg_temp;
alter function public.learn_capture_work_change() set search_path=public,pg_temp;
alter function public.learn_work_capture_baseline(uuid,uuid) set search_path=public,pg_temp;
alter function public.learn_work_history_read(uuid,uuid,timestamptz,timestamptz) set search_path=public,pg_temp;
alter function public.learn_handoff_owner(uuid,jsonb,jsonb,timestamptz) set search_path=public,pg_temp;
alter function public.learn_work_handoffs_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) set search_path=public,pg_temp;
alter function public.learn_work_residence_collect(uuid,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) set search_path=public,pg_temp;
revoke all on function public.learn_work_history_immutable() from public,anon,authenticated,service_role;

create trigger learn_work_receipt_reference_guard before insert or update on public.learn_work_measurement_runs
 for each row execute function public.learn_foundation_reference_guard();
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_work_capture_collectors_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
