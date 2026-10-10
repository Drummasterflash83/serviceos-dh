-- Resumable work collection. Sources and previous receipts are never rewritten.
-- This remains a candidate until paired client verification and a pinned TEST release.
create table public.learn_work_collection_runs (
 id uuid primary key, tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id), request jsonb not null,
 kind text not null check(kind in ('handoffs','residence','teamResidence')),
 subject_kind text not null check(subject_kind in ('member','team')), subject_id uuid not null,
 policy_id uuid not null, policy_revision integer not null, policy jsonb not null,
 window_start timestamptz not null, window_end timestamptz not null, reason text not null,
 snapshot_at timestamptz not null, roster jsonb not null, teams jsonb not null,
 source_system text not null, metric_key text not null, unit text not null,
 state text not null default 'collecting' check(state in ('collecting','completed','abandoned','superseded')),
 population integer not null default 0, processed integer not null default 0,
 eligible integer not null default 0, covered integer not null default 0, known_value numeric not null default 0,
 observed_at timestamptz, explanation text, proof jsonb, end_reason text,
 check(processed between 0 and population and covered between 0 and eligible and eligible<=processed),
 check(octet_length(roster::text)<=2097152 and octet_length(teams::text)<=2097152),
 check((state='completed')=(proof is not null))
);
create unique index learn_work_collection_active_cell on public.learn_work_collection_runs
 (tenant_id,kind,subject_id,policy_id,policy_revision,window_start,window_end) where state='collecting';
create table public.learn_work_collection_items (
 run_id uuid not null references public.learn_work_collection_runs(id),
 tenant_id uuid not null references public.tenants(id), ordinal bigint not null, object_id uuid not null,
 head_sequence bigint, head_reconciled boolean not null, first_kind text, first_at timestamptz,
 result jsonb check(result is null or octet_length(result::text)<=1048576),
 primary key(run_id,ordinal), unique(run_id,object_id)
);
create index learn_work_collection_items_tenant on public.learn_work_collection_items(tenant_id,run_id,ordinal);
alter table public.learn_work_collection_runs enable row level security;
alter table public.learn_work_collection_items enable row level security;
revoke all on public.learn_work_collection_runs,public.learn_work_collection_items from public,anon,authenticated,service_role;
grant select on public.learn_work_collection_runs,public.learn_work_collection_items to authenticated;
create policy learn_work_collection_runs_read on public.learn_work_collection_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create policy learn_work_collection_items_read on public.learn_work_collection_items for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create function public.learn_work_collection_immutable() returns trigger
language plpgsql set search_path=public,pg_temp as $$begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Retained collection evidence cannot be removed' using errcode='55000';end if;
 if tg_table_name='learn_work_collection_items' then
  if old.result is not null or new.result is null or (to_jsonb(new)-'result') is distinct from (to_jsonb(old)-'result') then
   raise exception 'Frozen item evidence cannot change' using errcode='55000';end if;
 else
  if old.state<>'collecting' or
    (to_jsonb(new)-array['population','processed','eligible','covered','known_value','state','observed_at','explanation','proof','end_reason'])
    is distinct from (to_jsonb(old)-array['population','processed','eligible','covered','known_value','state','observed_at','explanation','proof','end_reason'])
    or new.processed<old.processed or new.eligible<old.eligible or new.covered<old.covered or new.known_value<old.known_value
    or (old.population<>0 and new.population<>old.population) then
    raise exception 'Frozen collection scope or completed evidence cannot change' using errcode='55000';end if;
 end if;return new;
end $$;
create trigger learn_work_collection_runs_immutable before update or delete on public.learn_work_collection_runs
 for each row execute function public.learn_work_collection_immutable();
create trigger learn_work_collection_runs_no_truncate before truncate on public.learn_work_collection_runs
 for each statement execute function public.learn_work_collection_immutable();
create trigger learn_work_collection_items_immutable before update or delete on public.learn_work_collection_items
 for each row execute function public.learn_work_collection_immutable();
create trigger learn_work_collection_items_no_truncate before truncate on public.learn_work_collection_items
 for each statement execute function public.learn_work_collection_immutable();
revoke all on function public.learn_work_collection_immutable() from public,anon,authenticated,service_role;

-- Every mutation rechecks actual tenant, role, actor and View-As. The shared profile
-- lock serializes revocation with a batch; no browser-reported authority is trusted.
create function public.learn_work_collection_access(p_tenant uuid) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$declare actor uuid:=auth.uid();begin
 if actor is null or p_tenant is distinct from current_tenant_id() then raise exception 'Owner/admin access required' using errcode='42501';end if;
 perform 1 from profiles where id=actor and tenant_id=p_tenant and role in ('owner','admin') for share;
 if not found then raise exception 'Owner/admin access required' using errcode='42501';end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'View-As cannot collect observations' using errcode='42501';end if;
 return actor;
end $$;
revoke all on function public.learn_work_collection_access(uuid) from public,anon,authenticated,service_role;

-- Read only history visible at the frozen per-object head. Later writes, baseline
-- creation and newly inserted objects cannot leak into a resumed calculation.
create function public.learn_work_collection_history(p_item public.learn_work_collection_items,p_start timestamptz,p_end timestamptz,p_observed timestamptz)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare predecessor bigint;n integer;events jsonb;begin
 if not p_item.head_reconciled then raise exception 'Frozen work state did not reconcile with capture' using errcode='55000';end if;
 if p_item.head_sequence is not null and not exists(select 1 from object_state_history where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_sequence=p_item.head_sequence) then
  raise exception 'Frozen work history unavailable' using errcode='55000';end if;
 if exists(select 1 from (select occurred_at,work_before,lag(occurred_at) over(order by capture_sequence) prior_at,
   lag(work_after) over(order by capture_sequence) prior_state from object_state_history
   where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_kind is not null and capture_sequence<=p_item.head_sequence) h
   where occurred_at<prior_at or (prior_state is not null and work_before is distinct from prior_state)) then
  raise exception 'Frozen work capture contains an unexplained gap' using errcode='55000';end if;
 select capture_sequence into predecessor from object_state_history where tenant_id=p_item.tenant_id and object_id=p_item.object_id
   and capture_kind is not null and capture_sequence<=p_item.head_sequence and occurred_at<p_start order by capture_sequence desc limit 1;
 select count(*) into n from object_state_history where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_kind is not null
   and capture_sequence<=p_item.head_sequence and (capture_sequence=predecessor or occurred_at between p_start and p_end);
 if n>1000 then raise exception 'Individual work history exceeds review limit' using errcode='54000';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'sequence',capture_sequence::text,'kind',capture_kind,'occurredAt',occurred_at,
   'before',work_before,'after',work_after) order by capture_sequence),'[]') into events from object_state_history
   where tenant_id=p_item.tenant_id and object_id=p_item.object_id and capture_kind is not null and capture_sequence<=p_item.head_sequence
    and (capture_sequence=predecessor or occurred_at between p_start and p_end);
 return jsonb_build_object('objectId',p_item.object_id,'coverageStart',p_item.first_at,'sourceThrough',case when p_item.head_sequence is not null then p_observed end,'count',n,'events',events);
end $$;
revoke all on function public.learn_work_collection_history(public.learn_work_collection_items,timestamptz,timestamptz,timestamptz) from public,anon,authenticated,service_role;
create or replace function public.learn_work_frozen_owner(p_roster jsonb,p_teams jsonb,p_ref jsonb,p_at timestamptz)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare m jsonb; e jsonb; state jsonb; found_owner text; n int:=0; ref_id uuid;
begin
 if p_ref is null or p_ref='null'::jsonb or coalesce(p_ref->>'kind','') not in ('member','user','team','org_unit') then return null; end if;
 begin ref_id:=(p_ref->>'ref')::uuid; exception when invalid_text_representation then return null; end;
 if ref_id is null then return null; end if;
 if p_ref->>'kind' in ('team','org_unit') then
   if exists(select 1 from jsonb_array_elements(p_teams) t where t->>'id'=ref_id::text and (t->>'createdAt')::timestamptz<=p_at) then return 'team:'||ref_id::text; end if;
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
revoke all on function public.learn_work_frozen_owner(jsonb,jsonb,jsonb,timestamptz) from public,anon,authenticated,service_role;


create function public.learn_work_collection_calculate(p_kind text,p_subject uuid,p_history jsonb,p_roster jsonb,p_teams jsonb,p_start timestamptz,p_end timestamptz,p_first_kind text)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare history jsonb:=p_history;roster jsonb:=p_roster;object_id uuid:=(p_history->>'objectId')::uuid;
 object_complete boolean;ev jsonb;next_ev jsonb;owner text;before_owner text;after_owner text;at timestamptz;
 owner_team uuid;membership_event jsonb;member_capture jsonb;
 interval_start timestamptz;interval_end timestamptz;segment_start timestamptz;segment_end timestamptz;
 boundaries timestamptz[];points timestamptz[];i integer;j integer;segment_count integer:=0;
 item_minutes numeric:=0;transfers integer:=0;credited jsonb:='[]';
begin
 if p_kind not in ('handoffs','residence','teamResidence') then raise exception 'Unsupported collection kind' using errcode='22023';end if;
 if p_first_kind='insert' and (history->>'coverageStart')::timestamptz>=p_end then
  return jsonb_build_object('objectId',object_id,'eligible',false,'complete',true,'knownValue',0,'eventIds','[]'::jsonb,'credited','[]'::jsonb);end if;
 object_complete:=history->>'coverageStart' is not null and ((history->>'coverageStart')::timestamptz<=p_start or p_first_kind='insert');
 select coalesce(array_agg(distinct boundary order by boundary),'{}'::timestamptz[]) into boundaries from (
   select (m->>'coverageStart')::timestamptz boundary from jsonb_array_elements(roster->'members') m
   union all select (e->>'observedAt')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveFrom}')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,effectiveTo}')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
   union all select (e#>>'{after,confirmedAt}')::timestamptz from jsonb_array_elements(roster->'members') m cross join lateral jsonb_array_elements(m->'events') e
 ) b where boundary>p_start and boundary<p_end;
 if p_kind='handoffs' then
   for ev in select value from jsonb_array_elements(history->'events') loop
     at:=(ev->>'occurredAt')::timestamptz;
     if ev->>'kind'<>'update' or at<p_start or at>=p_end
       or ev#>'{before,responsible_ref}'='null'::jsonb or ev#>'{after,responsible_ref}'='null'::jsonb
       or ev#>'{before,responsible_ref}'=ev#>'{after,responsible_ref}' then continue; end if;
     before_owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{before,responsible_ref}',at);
     if before_owner is null then object_complete:=false; continue; end if;
     if before_owner<>'member:'||p_subject::text then continue; end if;
     after_owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{after,responsible_ref}',at);
     if after_owner is null then object_complete:=false; continue; end if;
     if before_owner=after_owner then continue; end if; -- user/member aliases are not a transfer.
     transfers:=transfers+1;
     credited:=credited||jsonb_build_array(jsonb_build_object('objectId',object_id,'eventId',ev->>'id',
       'occurredAt',at,'from',before_owner,'to',after_owner));
   end loop;
 elsif p_kind='residence' then
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
       owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{after,responsible_ref}',segment_start);
       if owner is null then object_complete:=false; continue; end if;
       if owner<>'member:'||p_subject::text then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',object_id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
         'waitingOn',ev#>'{after,waiting_on_ref}',
         'workEventIds',case when next_ev is null then jsonb_build_array(ev->>'id') else jsonb_build_array(ev->>'id',next_ev->>'id') end));
     end loop;
   end loop;
 else
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
       owner:=learn_work_frozen_owner(roster,p_teams,ev#>'{after,responsible_ref}',segment_start);
       if owner is null then object_complete:=false; continue; end if;
       -- Count an item segment once: direct team assignment OR its observed member's team.
       -- Current member rows and member score percentages never determine attribution.
       membership_event:=null; owner_team:=null;
       if owner like 'team:%' then owner_team:=substring(owner from 6)::uuid;
       else
         select m into member_capture from jsonb_array_elements(roster->'members') m
           where m->>'memberId'=substring(owner from 8);
         select e into membership_event from jsonb_array_elements(member_capture->'events') e
           where (e->>'observedAt')::timestamptz<=segment_start
           order by (e->>'sequence')::bigint desc limit 1;
         if membership_event is null or not (membership_event->'after' ? 'teamId') then
           object_complete:=false; continue;
         end if;
         owner_team:=(membership_event#>>'{after,teamId}')::uuid;
         -- An explicitly ungrouped member has known non-team ownership.
         if owner_team is null then continue; end if;

       end if;
       if not exists(select 1 from jsonb_array_elements(p_teams) t where t->>'id'=owner_team::text and (t->>'createdAt')::timestamptz<=segment_start) then
         object_complete:=false; continue;
       end if;
       if owner_team<>p_subject then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',object_id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'teamId',p_subject,'membershipEventId',membership_event->'id','responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
         'waitingOn',ev#>'{after,waiting_on_ref}',
         'workEventIds',case when next_ev is null then jsonb_build_array(ev->>'id') else jsonb_build_array(ev->>'id',next_ev->>'id') end));
     end loop;
   end loop;

 end if;
 return jsonb_build_object('objectId',object_id,'eligible',true,'complete',object_complete,
  'coverageStart',history->'coverageStart','sourceThrough',history->'sourceThrough',
  'knownValue',case when p_kind='handoffs' then transfers else item_minutes end,
  'eventIds',(select coalesce(jsonb_agg(v->'id'),'[]') from jsonb_array_elements(history->'events') v),'credited',credited);
end $$;
revoke all on function public.learn_work_collection_calculate(text,uuid,jsonb,jsonb,jsonb,timestamptz,timestamptz,text) from public,anon,authenticated,service_role;

create function public.learn_work_collection_result(p_run public.learn_work_collection_runs) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select jsonb_build_object('contract','work-collection@1','requestId',p_run.id,'tenantId',p_run.tenant_id,'actorId',p_run.actor_id,'state',p_run.state,
 'kind',p_run.kind,'subjectId',p_run.subject_id,'policyId',p_run.policy_id,'policyVersion',p_run.policy_revision,
 'period',jsonb_build_object('start',p_run.window_start,'end',p_run.window_end),
 'population',p_run.population,'processed',p_run.processed,'eligible',p_run.eligible,'covered',p_run.covered,
 'snapshotAt',p_run.snapshot_at,'measurementId',case when p_run.state='completed' then p_run.id end,
 'endReason',p_run.end_reason);
$$;
revoke all on function public.learn_work_collection_result(public.learn_work_collection_runs) from public,anon,authenticated,service_role;
create function public.learn_work_collection_cell_lock(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,p_start timestamptz,p_end timestamptz) returns void
language sql volatile set search_path=public,pg_temp as $$
 select pg_advisory_xact_lock(hashtextextended((case p_kind when 'handoffs' then 'learn-handoff-cell:' when 'residence' then 'learn-residence-cell:' else 'learn-team-residence-cell:' end)
  ||p_tenant::text||p_subject::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
$$;
revoke all on function public.learn_work_collection_cell_lock(uuid,text,uuid,uuid,integer,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function public.learn_work_collection_begin(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);descriptor jsonb;r learn_work_collection_runs%rowtype;
 pol jsonb;rule jsonb;sk text;mk text;src text;un text;n integer;
begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence') or p_subject is null or p_policy is null or p_request is null
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
 sk:=case when p_kind='teamResidence' then 'team' else 'member' end;
 mk:=case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' else 'work.team_owned_item_minutes' end;
 src:=case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' else 'serviceos.work.team-residence@1' end;
 un:=case p_kind when 'handoffs' then 'handoffs' else 'item_minutes' end;
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
  (select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at) order by id),'[]') from org_units where tenant_id=p_tenant) teams),
 inserted as (insert into learn_work_collection_runs(id,tenant_id,actor_id,request,kind,subject_kind,subject_id,policy_id,policy_revision,policy,
  window_start,window_end,reason,snapshot_at,roster,teams,source_system,metric_key,unit)
  select p_request,p_tenant,actor,descriptor,p_kind,sk,p_subject,p_policy,p_revision,pol,p_start,p_end,btrim(p_reason),statement_timestamp(),roster,teams,src,mk,un from frozen returning id)
 insert into learn_work_collection_items(run_id,tenant_id,ordinal,object_id,head_sequence,head_reconciled,first_kind,first_at)
 select inserted.id,p_tenant,row_number() over(order by o.id),o.id,h.capture_sequence,
  (h.id is null or (h.work_after=learn_work_snapshot(o) and h.occurred_at<=statement_timestamp())),f.capture_kind,f.occurred_at
 from inserted cross join intelligence_objects o
 left join lateral (select id,capture_sequence,work_after,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence desc limit 1) h on true
 left join lateral (select capture_kind,occurred_at from object_state_history where tenant_id=p_tenant and object_id=o.id and capture_kind is not null order by capture_sequence limit 1) f on true
 where o.tenant_id=p_tenant;
 get diagnostics n=row_count;
 if exists(select 1 from learn_work_collection_items where run_id=p_request and not head_reconciled) then
  raise exception 'Current work state does not reconcile with captured history' using errcode='55000';end if;
 update learn_work_collection_runs set population=n where id=p_request returning * into r;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_begin(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_begin(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text) to authenticated;

-- Existence of an unfinished run cannot serve as evidence for a score observation.
do $patch$ declare d text;old_list text;new_list text;anchor text;begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into d;
 old_list:=$old$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs','learn_team_work_measurement_runs')$old$;
 new_list:=$new$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs','learn_team_work_measurement_runs','learn_work_collection_runs')$new$;
 anchor:=$anchor$if not exists_ref then raise exception 'Missing or foreign evidence' using errcode='22023'; end if;$anchor$;
 if array_length(string_to_array(d,old_list),1) is distinct from 2 or array_length(string_to_array(d,anchor),1) is distinct from 2 then
  raise exception 'Unexpected performance evidence contract';end if;
 d:=replace(d,old_list,new_list);
 d:=replace(d,anchor,anchor||$guard$
  if ref->>'table'='learn_work_collection_runs' and not exists(select 1 from public.learn_work_collection_runs where tenant_id=p_tenant_id and id=(ref->>'id')::uuid and state='completed') then
   raise exception 'Incomplete collection cannot support an observation' using errcode='22023';end if;
$guard$);
 execute d;
end $patch$;

create function public.learn_work_collection_step(p_tenant uuid,p_request uuid,p_after integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 item_result jsonb;pol jsonb;value numeric;payload jsonb;ack jsonb;begin
 select * into r from learn_work_collection_runs where id=p_request and tenant_id=p_tenant for update;
 if not found or r.actor_id<>actor then raise exception 'Collection unavailable to this actor' using errcode='42501';end if;
 if p_after is null or p_after<0 or p_after>r.processed then raise exception 'Collection checkpoint changed' using errcode='PT409';end if;
 if r.state<>'collecting' or p_after<r.processed then return learn_work_collection_result(r);end if;
 for i in select * from learn_work_collection_items where run_id=p_request and ordinal>r.processed order by ordinal limit 100 loop
  if i.result is not null then raise exception 'Unexpected item checkpoint' using errcode='55000';end if;
  item_result:=learn_work_collection_calculate(r.kind,r.subject_id,learn_work_collection_history(i,r.window_start,r.window_end,r.snapshot_at),r.roster,r.teams,r.window_start,r.window_end,i.first_kind);
  update learn_work_collection_items set result=item_result where run_id=i.run_id and ordinal=i.ordinal;
  r.processed:=r.processed+1;
  if (item_result->>'eligible')::boolean then
   r.eligible:=r.eligible+1;
   if (item_result->>'complete')::boolean then r.covered:=r.covered+1;end if;
   r.known_value:=r.known_value+(item_result->>'knownValue')::numeric;
  end if;
 end loop;
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
    r.state:='completed';r.observed_at:=clock_timestamp();value:=case when r.covered=r.eligible then r.known_value end;
    r.explanation:='Frozen retained-work collection processed in batches. '||r.covered||' of '||r.eligible||' eligible items have complete history and identity coverage. '
     ||case when r.kind='handoffs' then 'Counts captured outgoing transfers; member/user aliases are not extra transfers. ' else 'Counts elapsed owned item-minutes including waiting and closed states; simultaneous items add separately. ' end
     ||'This is not working hours, speed or productivity. No business calendar or delay exclusion applied. '
     ||case when value is null then 'Value withheld because coverage is incomplete.' else 'Human review remains required.' end;
    r.proof:=jsonb_build_object('contract','work-collection@1','kind',r.kind,'runId',r.id,'snapshotAt',r.snapshot_at,'population','all retained intelligence objects at snapshot',
     'populationCount',r.population,'processed',r.processed,'eligibleItems',r.eligible,'coveredItems',r.covered,'knownValue',r.known_value,'value',value,
     'itemsTable','learn_work_collection_items','itemCount',r.population,'membershipStored',true,'teamDirectoryStored',true);
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
   'sourceThrough',case when r.covered=r.eligible then r.snapshot_at end,'sourceSystem',r.source_system,'review','inferred',
   'evidence',jsonb_build_array(jsonb_build_object('table','learn_work_collection_runs','id',r.id)),'exclusions','[]'::jsonb);
  ack:=learn_performance_append(p_tenant,payload,r.reason);
 end if;
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_step(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_step(uuid,uuid,integer) to authenticated;

-- Ending an unconfirmed start shares the request lock with begin and retains a
-- terminal intent even when no source snapshot was created. A delayed begin can
-- only read that terminal result; it cannot resurrect the request.
create function public.learn_work_collection_abandon(p_tenant uuid,p_kind text,p_subject uuid,p_policy uuid,p_revision integer,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text,p_end_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;descriptor jsonb;begin
 if p_kind is null or p_kind not in ('handoffs','residence','teamResidence') or p_subject is null or p_policy is null or p_request is null
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
  values(p_request,p_tenant,actor,descriptor,p_kind,case when p_kind='teamResidence' then 'team' else 'member' end,p_subject,p_policy,p_revision,'{}',
   p_start,p_end,btrim(p_reason),statement_timestamp(),'{}','[]',
   case p_kind when 'handoffs' then 'serviceos.work.handoffs@1' when 'residence' then 'serviceos.work.residence@1' else 'serviceos.work.team-residence@1' end,
   case p_kind when 'handoffs' then 'work.recorded_handoffs' when 'residence' then 'work.owned_item_minutes' else 'work.team_owned_item_minutes' end,
   case p_kind when 'handoffs' then 'handoffs' else 'item_minutes' end,'abandoned',btrim(p_end_reason)) returning * into r;
 end if;
 perform learn_work_collection_access(p_tenant);
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_abandon(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_abandon(uuid,text,uuid,uuid,integer,timestamptz,timestamptz,uuid,text,text) to authenticated;

create function public.learn_work_collection_status(p_tenant uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;begin
 select * into r from learn_work_collection_runs where tenant_id=p_tenant and id=p_request;
 if not found or r.actor_id<>actor then raise exception 'Collection unavailable to this actor' using errcode='42501';end if;
 return learn_work_collection_result(r);
end $$;
revoke all on function public.learn_work_collection_status(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_status(uuid,uuid) to authenticated;

-- Complete proof is retained by item and read in deterministic, bounded pages.
-- The overview identifies all rows and stores the frozen identity context separately.
create function public.learn_work_collection_evidence(p_tenant uuid,p_request uuid,p_part text,p_after bigint default 0) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=learn_work_collection_access(p_tenant);r learn_work_collection_runs%rowtype;i learn_work_collection_items%rowtype;
 rows jsonb:='[]';entry jsonb;bytes integer:=0;last_ordinal bigint:=p_after;begin
 select * into r from learn_work_collection_runs where tenant_id=p_tenant and id=p_request;
 if not found or r.state<>'completed' then raise exception 'Completed collection evidence unavailable' using errcode='42501';end if;
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
revoke all on function public.learn_work_collection_evidence(uuid,uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.learn_work_collection_evidence(uuid,uuid,text,bigint) to authenticated;
