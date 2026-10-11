-- Add distinct working-time collection kinds without rewriting prior receipts.
alter table public.learn_work_collection_runs drop constraint learn_work_collection_runs_kind_check;
alter table public.learn_work_collection_runs add constraint learn_work_collection_runs_kind_check
 check(kind in ('handoffs','residence','teamResidence','workingTime','teamWorkingTime'));
alter table public.learn_work_collection_runs add constraint learn_work_collection_run_tenant unique(id,tenant_id);
alter table public.learn_work_collection_items add constraint learn_work_collection_item_scope unique(run_id,ordinal,tenant_id,object_id);
alter table public.learn_work_collection_items drop constraint learn_work_collection_items_result_check;
alter table public.learn_work_collection_items add constraint learn_work_collection_items_result_check check(result is null or octet_length(result::text)<=2097152);
create table public.learn_working_collection_runs (
 run_id uuid primary key,tenant_id uuid not null,calendar jsonb not null,states jsonb not null,
 known_micros numeric not null default 0 check(known_micros>=0 and mod(known_micros,1)=0),
 foreign key(run_id,tenant_id) references public.learn_work_collection_runs(id,tenant_id),
 check(octet_length(calendar::text)<=2097152)
);
create table public.learn_working_collection_items (
 run_id uuid not null,ordinal bigint not null,tenant_id uuid not null,object_id uuid not null,
 delay_through integer not null check(delay_through>=0),history jsonb,delays jsonb,
 primary key(run_id,ordinal),
 foreign key(run_id,ordinal,tenant_id,object_id) references public.learn_work_collection_items(run_id,ordinal,tenant_id,object_id),
 check((history is null)=(delays is null)),
 check(history is null or octet_length(history::text)<=2097152),check(delays is null or octet_length(delays::text)<=2097152)
);
alter table public.learn_working_collection_runs enable row level security;
alter table public.learn_working_collection_items enable row level security;
revoke all on public.learn_working_collection_runs,public.learn_working_collection_items from public,anon,authenticated,service_role;
grant select on public.learn_working_collection_runs,public.learn_working_collection_items to authenticated;
create policy learn_working_collection_runs_read on public.learn_working_collection_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create policy learn_working_collection_items_read on public.learn_working_collection_items for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create function public.learn_working_collection_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Retained working-time evidence cannot be removed' using errcode='55000';end if;
 if not exists(select 1 from learn_work_collection_runs where id=old.run_id and state='collecting') then raise exception 'Completed working-time evidence cannot change' using errcode='55000';end if;
 if tg_table_name='learn_working_collection_runs' then
  if (to_jsonb(old)-'known_micros') is distinct from (to_jsonb(new)-'known_micros') or new.known_micros<old.known_micros then
   raise exception 'Frozen working-time inputs cannot change' using errcode='55000';end if;
 else
  if old.history is not null or new.history is null or new.delays is null or
   (to_jsonb(old)-array['history','delays']) is distinct from (to_jsonb(new)-array['history','delays']) then
   raise exception 'Frozen working-time item cannot change' using errcode='55000';end if;
 end if;return new;
end $$;
create trigger learn_working_collection_runs_immutable before update or delete on public.learn_working_collection_runs for each row execute function public.learn_working_collection_immutable();
create trigger learn_working_collection_runs_no_truncate before truncate on public.learn_working_collection_runs for each statement execute function public.learn_working_collection_immutable();
create trigger learn_working_collection_items_immutable before update or delete on public.learn_working_collection_items for each row execute function public.learn_working_collection_immutable();
create trigger learn_working_collection_items_no_truncate before truncate on public.learn_working_collection_items for each statement execute function public.learn_working_collection_immutable();
revoke all on function public.learn_working_collection_immutable() from public,anon,authenticated,service_role;

create function public.learn_working_rule_states(p_rule jsonb,p_kind text) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$declare states jsonb;expected_kind text;expected_source text;begin
 if p_rule->>'key' not in ('work.working_item_minutes','work.team_working_item_minutes') then
  if p_rule ? 'workStates' then raise exception 'Work states apply only to working-time measures' using errcode='22023';end if;return null;
 end if;
 expected_kind:=case p_rule->>'key' when 'work.working_item_minutes' then 'member' else 'team' end;
 expected_source:=case expected_kind when 'member' then 'serviceos.work.working-time@1' else 'serviceos.work.team-working-time@1' end;
 states:=p_rule->'workStates';
 if p_kind is distinct from expected_kind or p_rule->>'unit' is distinct from 'working_item_minutes'
  or not coalesce((p_rule->'sourceSystems') ? expected_source,false) or jsonb_typeof(states) is distinct from 'array' then
  raise exception 'Working-time measure requires matching scope, source, unit and explicit states' using errcode='22023';end if;
 if jsonb_array_length(states) not between 1 and 50 or exists(select 1 from jsonb_array_elements(states) s
  where jsonb_typeof(s) is distinct from 'string' or length(s#>>'{}') not between 1 and 200 or btrim(s#>>'{}') is distinct from s#>>'{}')
  or (select count(distinct value)<>count(*) from jsonb_array_elements(states)) then
  raise exception 'Choose unique explicit work states' using errcode='22023';end if;
 return (select jsonb_agg(value order by value) from jsonb_array_elements(states));
end $$;
revoke all on function public.learn_working_rule_states(jsonb,text) from public,anon,authenticated,service_role;
-- Validate the additional rule fields before preserving the existing save path.
do $patch$ declare d text;anchor text:=$a$    v_keys := array_append(v_keys,m->>'key');$a$;begin
 select pg_get_functiondef('public.learn_scorecard_save_draft(uuid,integer,jsonb,text)'::regprocedure) into d;
 if array_length(string_to_array(d,anchor),1) is distinct from 2 then raise exception 'Unexpected scorecard validation contract';end if;
 execute replace(d,anchor,$a$    perform learn_working_rule_states(m,v_kind);
$a$||anchor);
end $patch$;

-- Only caller-materialised publication rows are used. No later table reads can
-- leak a commit into the frozen calendar; expanded windows are retained verbatim.
create function public.learn_working_calendar_freeze(p_tenant uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz,p_rows jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp set timezone='UTC' as $$
declare r jsonb;next_row jsonb;a timestamptz;b timestamptz;versions jsonb:='[]';windows jsonb:='[]';i int;first_at timestamptz;begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then raise exception 'Calendar publication history exceeds supported limit' using errcode='54000';end if;
 first_at:=(p_rows->0->>'effective_from')::timestamptz;
 for i in 0..jsonb_array_length(p_rows)-1 loop
  r:=p_rows->i;next_row:=p_rows->(i+1);
  if r->>'tenant_id' is distinct from p_tenant::text or (r->>'effective_from')::timestamptz>p_observed then raise exception 'Frozen calendar scope mismatch' using errcode='22023';end if;
  a:=greatest(p_start,(r->>'effective_from')::timestamptz);b:=least(p_end,coalesce((next_row->>'effective_from')::timestamptz,p_end));
  if a>=b then raise exception 'Frozen calendar publication ordering changed' using errcode='22023';end if;
  versions:=versions||jsonb_build_array(jsonb_build_object('publicationId',r->'id','versionId',r->'version_id','revision',r->'revision','definition',r->'definition',
   'effectiveFrom',r->'effective_from','start',a,'end',b,'recordedBy',r->'actor_id','reason',r->'reason'));
  windows:=windows||learn_work_calendar_expand(r->'definition',a,b);
 end loop;
 return jsonb_build_object('contract','work-calendar-snapshot@1','tenantId',p_tenant,'observedAt',p_observed,'period',jsonb_build_object('start',p_start,'end',p_end),
 'complete',coalesce(first_at<=p_start,false),'missing',case when first_at is null or first_at>p_start then jsonb_build_array(jsonb_build_object('start',p_start,'end',least(coalesce(first_at,p_end),p_end))) else '[]'::jsonb end,
 'versions',versions,'windows',windows);
end $$;
revoke all on function public.learn_working_calendar_freeze(uuid,timestamptz,timestamptz,timestamptz,jsonb) from public,anon,authenticated,service_role;
create function public.learn_working_delay_freeze(p_tenant uuid,p_object uuid,p_start timestamptz,p_end timestamptz,p_observed timestamptz,p_through integer)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$declare approvals jsonb;spans jsonb;n int;begin
 if p_through is null or p_through<0 or (p_through>0 and not exists(select 1 from learn_work_delay_events where tenant_id=p_tenant and object_id=p_object and revision=p_through and recorded_at<=p_observed)) then
  raise exception 'Frozen delay revision unavailable' using errcode='55000';end if;
 select count(*) into n from learn_work_delay_events a where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=p_through and a.decision='approve'
  and a.window_start<p_end and a.window_end>p_start and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=p_through);
 if n>1000 then raise exception 'Frozen delay snapshot exceeds review limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(learn_work_delay_entry(a) order by a.revision),'[]') into approvals from learn_work_delay_events a
  where a.tenant_id=p_tenant and a.object_id=p_object and a.revision<=p_through and a.decision='approve' and a.window_start<p_end and a.window_end>p_start
   and not exists(select 1 from learn_work_delay_events r where r.approval_id=a.id and r.revision<=p_through);
 select coalesce(jsonb_agg(jsonb_build_object('start',greatest(p_start,(v#>>'{period,start}')::timestamptz),'end',least(p_end,(v#>>'{period,end}')::timestamptz))),'[]') into spans from jsonb_array_elements(approvals) v;
 return jsonb_build_object('contract','work-delay-snapshot@1','tenantId',p_tenant,'objectId',p_object,'through',p_through,'observedAt',p_observed,
  'period',jsonb_build_object('start',p_start,'end',p_end),'approvals',approvals,'windows',learn_working_time_windows(learn_working_time_ranges(spans,p_start,p_end)));
end $$;
revoke all on function public.learn_working_delay_freeze(uuid,uuid,timestamptz,timestamptz,timestamptz,integer) from public,anon,authenticated,service_role;
create or replace function public.learn_work_collection_begin(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;r learn_work_collection_runs%rowtype;
 pol jsonb;rule jsonb;sk text;mk text;src text;un text;n integer;
begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence','workingTime','teamWorkingTime') or p_subject is null or p_policy is null or p_request is null
  or p_revision is null or p_revision<1 or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end>statement_timestamp() or p_end-p_start>interval '366 days' or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Choose a supported collection, completed period and reason' using errcode='22023';end if;
 descriptor:=jsonb_build_object('contract','work-collection@1','kind',p_kind,'subjectId',p_subject,'policyId',p_policy,'policyVersion',p_revision,
  'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into r from learn_work_collection_runs where id=p_request;
 if found then
  if r.tenant_id<>p_tenant or r.request is distinct from descriptor then raise exception 'Collection request identity changed' using errcode='PT409';end if;
  return learn_work_collection_result(r);
 end if;
 if exists(select 1 from measurements where id=p_request) or exists(select 1 from learn_work_measurement_runs where id=p_request)
  or exists(select 1 from learn_team_work_measurement_runs where id=p_request) then raise exception 'Request identity already used' using errcode='PT409';end if;
 sk:=case when p_kind in ('teamResidence','teamWorkingTime') then 'team' else 'member' end;
 mk:=case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' when 'workingTime' then 'work.working_item_minutes' when 'teamWorkingTime' then 'work.team_working_item_minutes' else 'work.team_owned_item_minutes' end;
 src:=case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' when 'workingTime' then 'serviceos.work.working-time@1' when 'teamWorkingTime' then 'serviceos.work.team-working-time@1' else 'serviceos.work.team-residence@1' end;
 un:=case p_kind when 'handoffs' then 'handoffs' when 'workingTime' then 'working_item_minutes' when 'teamWorkingTime' then 'working_item_minutes' else 'item_minutes' end;
 if sk='team' then perform 1 from org_units where id=p_subject and tenant_id=p_tenant for share;
 else perform 1 from team_members where id=p_subject and tenant_id=p_tenant for share;end if;
 if not found then raise exception 'Subject not in tenant' using errcode='22023';end if;
 select e.value into pol from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
  where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant' and e.key like 'definition.%'
  and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text and c.artifact_kind='learn_scorecard'
  and c.version=p_revision and c.status in ('draft','published') for share of e,c;
 if pol is null or pol->>'subjectKind' is distinct from sk or
  (pol->>'groupId' is not null and (sk<>'team' or pol->>'groupId' is distinct from p_subject::text)) then
  raise exception 'Policy does not cover this subject' using errcode='22023';end if;
 select value into rule from jsonb_array_elements(pol->'metrics') where value->>'key'=mk;
 if rule is null or rule->>'unit' is distinct from un or not coalesce((rule->'sourceSystems') ? src,false) then
  raise exception 'Policy does not define this collection' using errcode='22023';end if;
 perform learn_working_rule_states(rule,sk);
 perform learn_work_collection_cell_lock(p_tenant,p_kind,p_subject,p_policy,p_revision,p_start,p_end);
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind=sk and subject_id=p_subject and policy_id=p_policy
   and policy_revision=p_revision and metric_key=mk and window_start=p_start and window_end=p_end)
  or exists(select 1 from learn_work_collection_runs where tenant_id=p_tenant and kind=p_kind and subject_id=p_subject
   and policy_id=p_policy and policy_revision=p_revision and window_start=p_start and window_end=p_end and state='collecting') then
  raise exception 'An observation or collection already exists for this cell' using errcode='PT409';end if;
 if not exists(select 1 from pg_trigger where tgrelid='public.intelligence_objects'::regclass and tgname='learn_capture_work_change' and tgenabled in ('O','A')) then
  raise exception 'Work capture is unavailable' using errcode='55000';end if;
 -- One statement snapshot freezes membership, team directory, population and each
 -- work history head. UUID ordering is materialized, never re-queried on resume.
 with frozen as materialized (select learn_member_history_read(p_tenant,p_start,p_end) roster,
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) order by id),'[]') from org_units where tenant_id=p_tenant) teams,
  case when p_kind in ('workingTime','teamWorkingTime') then learn_working_calendar_freeze(p_tenant,p_start,p_end,statement_timestamp(),
   (select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('definition',v.definition,'revision',v.revision) order by p.effective_from),'[]')
    from learn_work_calendar_publications p join learn_work_calendar_versions v on v.id=p.version_id and v.tenant_id=p.tenant_id
    where p.tenant_id=p_tenant and p.effective_from<p_end and p.effective_from<=statement_timestamp()
     and (p.effective_from>=p_start or p.id=(select id from learn_work_calendar_publications where tenant_id=p_tenant and effective_from<p_start order by effective_from desc limit 1)))) end calendar),
 inserted as (insert into learn_work_collection_runs(id,tenant_id,actor_id,request,kind,subject_kind,subject_id,policy_id,policy_revision,policy,
  window_start,window_end,reason,snapshot_at,roster,teams,source_system,metric_key,unit)
  select p_request,p_tenant,actor,descriptor,p_kind,sk,p_subject,p_policy,p_revision,pol,p_start,p_end,btrim(p_reason),statement_timestamp(),roster,teams,src,mk,un from frozen returning id),
 working as (insert into learn_working_collection_runs(run_id,tenant_id,calendar,states)
  select inserted.id,p_tenant,frozen.calendar,learn_working_rule_states(rule,sk) from inserted cross join frozen
  where p_kind in ('workingTime','teamWorkingTime') returning run_id),
 items as (insert into learn_work_collection_items(run_id,tenant_id,ordinal,object_id,head_sequence,head_reconciled,first_kind,first_at)
 select inserted.id,p_tenant,row_number() over(order by o.id),o.id,h.capture_sequence,
  (h.id is null or (h.work_after=learn_work_snapshot(o) and h.occurred_at<=statement_timestamp())),f.capture_kind,f.occurred_at
 from inserted cross join intelligence_objects o
 left join lateral (select id,capture_sequence,work_after,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence desc limit 1) h on true
 left join lateral (select capture_kind,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence limit 1) f on true
 where o.tenant_id=p_tenant returning run_id,ordinal,tenant_id,object_id)
 insert into learn_working_collection_items(run_id,ordinal,tenant_id,object_id,delay_through)
 select i.run_id,i.ordinal,i.tenant_id,i.object_id,coalesce((select max(revision) from learn_work_delay_events where tenant_id=p_tenant and object_id=i.object_id and recorded_at<=statement_timestamp()),0)
 from items i join working w on w.run_id=i.run_id;
 select count(*) into n from learn_work_collection_items where run_id=p_request;
 if exists(select 1 from learn_work_collection_items where run_id=p_request and not head_reconciled) then
  raise exception 'Current work state does not reconcile with captured history' using errcode='55000';end if;
 update learn_work_collection_runs set population=n where id=p_request returning * into r;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;

create or replace function public.learn_work_collection_step(p_tenant uuid,p_request uuid,p_after integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 item_result jsonb;ctx learn_working_collection_runs%rowtype;ic learn_working_collection_items%rowtype;frozen_history jsonb;frozen_delays jsonb;is_working boolean;pol jsonb;value numeric;payload jsonb;ack jsonb;begin
 select * into r from learn_work_collection_runs where id=p_request and tenant_id=p_tenant for update;
 if not found or r.actor_id<>actor then raise exception 'Collection unavailable to this actor' using errcode='42501';end if;
 if p_after is null or p_after<0 or p_after>r.processed then raise exception 'Collection checkpoint changed' using errcode='PT409';end if;
 if r.state<>'collecting' or p_after<r.processed then return learn_work_collection_result(r);end if;
 is_working:=r.kind in ('workingTime','teamWorkingTime');
 if is_working then
  select * into ctx from learn_working_collection_runs where run_id=r.id and tenant_id=r.tenant_id for update;
  if not found then raise exception 'Frozen working-time inputs unavailable' using errcode='55000';end if;
 end if;
 for i in select * from learn_work_collection_items where run_id=p_request and ordinal>r.processed order by ordinal limit 100 loop
  if i.result is not null then raise exception 'Unexpected item checkpoint' using errcode='55000';end if;
  if is_working then
   select * into ic from learn_working_collection_items where run_id=r.id and ordinal=i.ordinal and tenant_id=r.tenant_id;
   if not found or ic.history is not null then raise exception 'Frozen working-time item unavailable' using errcode='55000';end if;
   frozen_history:=learn_work_collection_history(i,r.window_start,r.window_end,r.snapshot_at);
   frozen_delays:=learn_working_delay_freeze(r.tenant_id,i.object_id,r.window_start,r.window_end,r.snapshot_at,ic.delay_through);
   item_result:=learn_working_time_calculate(r.tenant_id,r.subject_kind,r.subject_id,frozen_history,r.roster,r.teams,r.window_start,r.window_end,r.snapshot_at,i.first_kind,ctx.states,ctx.calendar,frozen_delays);
   update learn_working_collection_items set history=frozen_history,delays=frozen_delays where run_id=r.id and ordinal=i.ordinal;
   ctx.known_micros:=ctx.known_micros+(item_result->>'assessedMicros')::numeric;
  else
   item_result:=learn_work_collection_calculate(r.kind,r.subject_id,learn_work_collection_history(i,r.window_start,r.window_end,r.snapshot_at),r.roster,r.teams,r.window_start,r.window_end,i.first_kind);
  end if;
  update learn_work_collection_items set result=item_result where run_id=i.run_id and ordinal=i.ordinal;
  r.processed:=r.processed+1;
  if (item_result->>'eligible')::boolean then
   r.eligible:=r.eligible+1;
   if (item_result->>'complete')::boolean then r.covered:=r.covered+1;end if;
   r.known_value:=r.known_value+(item_result->>'knownValue')::numeric;
  end if;
 end loop;
 if is_working then
  update learn_working_collection_runs set known_micros=ctx.known_micros where run_id=r.id;
  r.known_value:=round(ctx.known_micros/60000000,12);
 end if;
 if r.processed=r.population then
  perform learn_work_collection_cell_lock(r.tenant_id,r.kind,r.subject_id,r.policy_id,r.policy_revision,r.window_start,r.window_end);
  if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind=r.subject_kind and subject_id=r.subject_id
    and policy_id=r.policy_id and policy_revision=r.policy_revision and metric_key=r.metric_key and window_start=r.window_start and window_end=r.window_end) then
   r.state:='superseded';r.end_reason:='Another observation already exists for this cell. Review it before collecting again.';
  else
   select e.value into pol from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
    where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant' and e.key like 'definition.%'
    and e.value->>'id'=r.policy_id::text and e.value->>'version'=r.policy_revision::text and c.artifact_kind='learn_scorecard'
    and c.version=r.policy_revision and c.status in ('draft','published') for share of e,c;
   if pol is distinct from r.policy then
    r.state:='superseded';r.end_reason:='Scoring rules changed during collection. Start a new collection for the saved rules.';
   else
    r.state:='completed';r.observed_at:=clock_timestamp();value:=case when r.covered=r.eligible and (not is_working or (ctx.calendar->>'complete')::boolean) then r.known_value end;
    r.explanation:='Frozen retained-work collection processed in batches. '||r.covered||' of '||r.eligible||' eligible items have complete history and identity coverage. '
     ||case when r.kind='handoffs' then 'Counts captured outgoing transfers; member/user aliases are not extra transfers. ' else 'Counts elapsed owned item-minutes including waiting and closed states; simultaneous items add separately. ' end
     ||'This is not working hours, speed or productivity. No business calendar or delay exclusion applied. '
     ||case when value is null then 'Value withheld because coverage is incomplete.' else 'Human review remains required.' end;
    r.proof:=jsonb_build_object('contract','work-collection@1','kind',r.kind,'runId',r.id,'snapshotAt',r.snapshot_at,'population','all retained intelligence objects at snapshot',
     'populationCount',r.population,'processed',r.processed,'eligibleItems',r.eligible,'coveredItems',r.covered,'knownValue',r.known_value,'value',value,
     'itemsTable','learn_work_collection_items','itemCount',r.population,'membershipStored',true,'teamDirectoryStored',true);
    if is_working then
     r.explanation:='Frozen working-time collection: selected owned work states intersect published company hours, minus approved per-item delays. Concurrent items add separately. This is not hours worked, productivity or a pay decision. '
      ||case when value is null then 'Value withheld because calendar or ownership coverage is incomplete.' else 'Human review remains required.' end;
     r.proof:=r.proof||jsonb_build_object('calculation','work-working-time-item@1','states',ctx.states,'calendarComplete',ctx.calendar->'complete',
      'assessedMicros',trunc(ctx.known_micros)::text,'workingInputsTable','learn_working_collection_runs','workingItemsTable','learn_working_collection_items');
    end if;
   end if;
  end if;
 end if;
 perform learn_work_collection_access(p_tenant);
 update learn_work_collection_runs set processed=r.processed,eligible=r.eligible,covered=r.covered,known_value=r.known_value,
  state=r.state,observed_at=r.observed_at,explanation=r.explanation,proof=r.proof,end_reason=r.end_reason where id=p_request;
 if r.state='completed' then
  payload:=jsonb_build_object('id',r.id,'tenantId',p_tenant,'subject',jsonb_build_object('kind',r.subject_kind,'id',r.subject_id),
   'metricKey',r.metric_key,'policyId',r.policy_id,'policyVersion',r.policy_revision,'period',jsonb_build_object('start',r.window_start,'end',r.window_end),
   'value',value,'unit',r.unit,'sampleCount',r.covered,'coveredCount',r.covered,'eligibleCount',r.eligible,'observedAt',r.observed_at,
   'sourceThrough',case when r.covered=r.eligible and (not is_working or value is not null) then r.snapshot_at end,'sourceSystem',r.source_system,'review','inferred',
   'evidence',jsonb_build_array(jsonb_build_object('table','learn_work_collection_runs','id',r.id)),'exclusions','[]'::jsonb);
  ack:=learn_performance_append(p_tenant,payload,r.reason);
 end if;
 return learn_work_collection_result(r);
end $$;

create or replace function public.learn_work_collection_abandon(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text,p_end_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;descriptor jsonb;begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence','workingTime','teamWorkingTime') or p_subject is null or p_policy is null or p_request is null
  or p_revision is null or p_revision<1 or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start>=p_end or p_end>statement_timestamp() or p_end-p_start>interval '366 days'
  or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or length(btrim(coalesce(p_end_reason,''))) not between 1 and 1000 then
  raise exception 'An exact collection request and ending reason are required' using errcode='22023';end if;
 descriptor:=jsonb_build_object('contract','work-collection@1','kind',p_kind,'subjectId',p_subject,'policyId',p_policy,'policyVersion',p_revision,
  'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor);
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into r from learn_work_collection_runs where id=p_request for update;
 if found then
  if r.tenant_id<>p_tenant or r.actor_id<>actor or r.request is distinct from descriptor then raise exception 'Collection request identity changed' using errcode='PT409';end if;
  if r.state='collecting' then
   update learn_work_collection_runs set state='abandoned',end_reason=btrim(p_end_reason) where id=p_request returning * into r;
  elsif r.state='abandoned' and r.end_reason is distinct from btrim(p_end_reason) then
   raise exception 'Collection ending reason already recorded' using errcode='PT409';end if;
 else
  if exists(select 1 from measurements where id=p_request) or exists(select 1 from learn_work_measurement_runs where id=p_request)
   or exists(select 1 from learn_team_work_measurement_runs where id=p_request) then raise exception 'Request identity already used' using errcode='PT409';end if;
  insert into learn_work_collection_runs(id,tenant_id,actor_id,request,kind,subject_kind,subject_id,policy_id,policy_revision,policy,
   window_start,window_end,reason,snapshot_at,roster,teams,source_system,metric_key,unit,state,end_reason)
  values(p_request,p_tenant,actor,descriptor,p_kind,case when p_kind in ('teamResidence','teamWorkingTime') then 'team' else 'member' end,p_subject,p_policy,p_revision,'{}',
   p_start,p_end,btrim(p_reason),statement_timestamp(),'{}','[]',
   case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' when 'workingTime' then 'serviceos.work.working-time@1' when 'teamWorkingTime' then 'serviceos.work.team-working-time@1' else 'serviceos.work.team-residence@1' end,
   case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' when 'workingTime' then 'work.working_item_minutes' when 'teamWorkingTime' then 'work.team_working_item_minutes' else 'work.team_owned_item_minutes' end,
   case p_kind when 'handoffs' then 'handoffs' when 'workingTime' then 'working_item_minutes' when 'teamWorkingTime' then 'working_item_minutes' else 'item_minutes' end,'abandoned',btrim(p_end_reason)) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;

create or replace function public.learn_work_collection_evidence(p_tenant uuid,p_request uuid,p_part text,p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 rows jsonb:='[]';working_input learn_working_collection_items%rowtype;entry jsonb;bytes integer:=0;last_ordinal bigint:=p_after;begin
 select * into r from learn_work_collection_runs where tenant_id=p_tenant and id=p_request;
 if not found or r.state<>'completed' then raise exception 'Completed collection evidence unavailable' using errcode='42501';end if;
 if p_part in ('calendar','workingItem') and r.kind in ('workingTime','teamWorkingTime') then
  if p_after is null or (p_part='calendar' and p_after<>0) or (p_part='workingItem' and (p_after<1 or p_after>r.population)) then raise exception 'Invalid working-time proof page' using errcode='22023';end if;
  if p_part='calendar' then
   select jsonb_build_object('calendar',calendar,'states',states,'assessedMicros',trunc(known_micros)::text) into entry from learn_working_collection_runs where run_id=r.id and tenant_id=r.tenant_id;
  else
   select * into working_input from learn_working_collection_items where run_id=r.id and ordinal=p_after and tenant_id=r.tenant_id;
   if not found or working_input.history is null then raise exception 'Retained working-time item unavailable' using errcode='55000';end if;
   entry:=jsonb_build_object('ordinal',working_input.ordinal,'objectId',working_input.object_id,'delayThrough',working_input.delay_through,'history',working_input.history,'delays',working_input.delays);
  end if;
  if entry is null then raise exception 'Retained working-time inputs unavailable' using errcode='55000';end if;
  return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,'snapshotAt',r.snapshot_at,'data',entry);
 end if;
 if p_part is null or p_part not in ('overview','membership','teams','items') or p_after is null or p_after<0 or p_after>r.population or (p_part<>'items' and p_after<>0) then
  raise exception 'Invalid evidence page' using errcode='22023';end if;
 if p_part='overview' then return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'sourceSystem',r.source_system,'metricKey',r.metric_key,'observedAt',r.observed_at,'explanation',r.explanation,'proof',r.proof,
  'policy',r.policy,'subject',jsonb_build_object('kind',r.subject_kind,'id',r.subject_id),'period',jsonb_build_object('start',r.window_start,'end',r.window_end));end if;
 if p_part in ('membership','teams') then return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'snapshotAt',r.snapshot_at,'data',case p_part when 'membership' then r.roster else r.teams end);end if;
 for i in select * from learn_work_collection_items where run_id=p_request and ordinal>p_after order by ordinal limit 100 loop
  if i.result is null or i.ordinal<>last_ordinal+1 then raise exception 'Retained proof is incomplete' using errcode='55000';end if;
  entry:=(to_jsonb(i)-array['run_id','tenant_id'])||jsonb_build_object('head_sequence',i.head_sequence::text);
  if bytes+octet_length(entry::text)>2097152 and last_ordinal>p_after then exit;end if;
  bytes:=bytes+octet_length(entry::text);rows:=rows||jsonb_build_array(entry);last_ordinal:=i.ordinal;
 end loop;
 if p_after<r.population and last_ordinal=p_after then raise exception 'Retained proof is incomplete' using errcode='55000';end if;
 return jsonb_build_object('contract','work-collection-evidence@1','runId',r.id,'tenantId',r.tenant_id,'part',p_part,
  'population',r.population,'after',p_after,'next',case when last_ordinal<r.population then last_ordinal end,'items',rows);
end $$;
