-- Team workload observation; source history and existing member receipts are retained.
-- Apply only through a reviewed, pinned release. This file does not activate capture.
create table public.learn_team_work_measurement_runs (
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 team_id uuid not null references public.org_units(id),
 actor_id uuid not null references public.profiles(id),
 request jsonb not null,
 observed_at timestamptz not null,
 source_system text not null,
 metric_key text not null,
 explanation text not null,
 proof jsonb not null check(octet_length(proof::text)<=1048576)
);
alter table public.learn_team_work_measurement_runs enable row level security;
revoke all on public.learn_team_work_measurement_runs from public,anon,authenticated,service_role;
grant select on public.learn_team_work_measurement_runs to authenticated;
create policy learn_team_work_measurement_runs_read on public.learn_team_work_measurement_runs for select to authenticated
 using(tenant_id=current_tenant_id() and coalesce(current_user_role(),'') in ('owner','admin'));
create trigger learn_team_work_measurement_runs_immutable before update or delete on public.learn_team_work_measurement_runs
 for each row execute function public.learn_member_history_immutable();
create trigger learn_team_work_measurement_runs_no_truncate before truncate on public.learn_team_work_measurement_runs
 for each statement execute function public.learn_member_history_immutable();

-- Keep every deployed append guard; extend its one evidence allowlist only.
do $patch$ declare d text; old_list text; new_list text; begin
 select pg_get_functiondef('public.learn_performance_append(uuid,jsonb,text)'::regprocedure) into d;
 old_list:=$old$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs')$old$;
 new_list:=$new$('interactions','email_messages','phone_calls','phone_recordings','jobs','team_members','learn_work_measurement_runs','learn_team_work_measurement_runs')$new$;
 if array_length(string_to_array(d,old_list),1) is distinct from 2 then
   raise exception 'Unexpected performance evidence contract'; end if;
 execute replace(d,old_list,new_list);
end $patch$;

-- Source-owned elapsed item-minutes; no calendar or productivity claim.
-- Uses preserved capture history without modifying source records.
create function public.learn_team_work_residence_collect(p_tenant uuid,p_team uuid,p_policy uuid,p_revision int,
 p_start timestamptz,p_end timestamptz,p_request uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid:=auth.uid(); descriptor jsonb; prior learn_team_work_measurement_runs%rowtype;
 roster jsonb; history jsonb; o intelligence_objects%rowtype; first_capture object_state_history%rowtype;
 policy jsonb; rule jsonb; ev jsonb; next_ev jsonb; owner text;
 owner_team uuid; membership_event jsonb; member_capture jsonb;
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
 if p_team is null or p_policy is null or p_request is null or p_revision is null or p_revision<1
   or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
   or p_start>=p_end or p_end>observed or p_end-p_start>interval '366 days'
   or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
   raise exception 'A team, policy, completed period and reason are required' using errcode='22023'; end if;
 descriptor:=jsonb_build_object('teamId',p_team,'policyId',p_policy,'policyVersion',p_revision,
   'start',p_start,'end',p_end,'reason',btrim(p_reason),'actorId',actor,'algorithm','team-work-residence@1');
 perform pg_advisory_xact_lock(hashtextextended('learn-work-collect:'||p_request::text,0));
 select * into prior from learn_team_work_measurement_runs where id=p_request;
 if found then
   if prior.tenant_id<>p_tenant or prior.request is distinct from descriptor then
     raise exception 'Collection request identity changed' using errcode='PT409'; end if;
   if not exists(select 1 from measurements where id=p_request and tenant_id=p_tenant) then
     raise exception 'Collection receipt is incomplete' using errcode='55000'; end if;
   return jsonb_build_object('measurementId',p_request,'reused',true);
 end if;
 perform 1 from org_units where id=p_team and tenant_id=p_tenant for share;
 if not found then raise exception 'Team not found in tenant' using errcode='22023'; end if;
 select e.value into policy from operating_profile_entries e join config_versions c on c.id=e.version_id and c.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.namespace='learn_scorecards' and e.scope_kind='tenant'
   and e.key like 'definition.%' and e.value->>'id'=p_policy::text and e.value->>'version'=p_revision::text
   and c.artifact_kind='learn_scorecard' and c.version=p_revision and c.status in ('draft','published');
 if policy is null or policy->>'subjectKind' is distinct from 'team'
   or (policy->>'groupId' is not null and policy->>'groupId' is distinct from p_team::text) then
   raise exception 'Choose team rules covering the selected team' using errcode='22023'; end if;
 select value into rule from jsonb_array_elements(policy->'metrics') where value->>'key'='work.team_owned_item_minutes';
 if rule is null or rule->>'unit' is distinct from 'item_minutes' or not coalesce((rule->'sourceSystems') ? 'serviceos.work.team-residence@1',false) then
   raise exception 'Policy does not define the owned item-minute measure' using errcode='22023'; end if;
 -- Serialize one observation per exact cell. Refreshes must use a separately
 -- reviewed correction workflow, not create two competing independent counts.
 perform pg_advisory_xact_lock(hashtextextended('learn-team-residence-cell:'||p_tenant::text||p_team::text||p_policy::text||p_revision::text||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text,0));
 if exists(select 1 from measurements where tenant_id=p_tenant and subject_kind='team' and subject_id=p_team
   and policy_id=p_policy and policy_revision=p_revision and metric_key='work.team_owned_item_minutes'
   and window_start=p_start and window_end=p_end) then
   raise exception 'An observation already exists for this cell; review or correct it' using errcode='PT409'; end if;
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
       if not exists(select 1 from org_units where id=owner_team and tenant_id=p_tenant and created_at<=segment_start) then
         object_complete:=false; continue;
       end if;
       if owner_team<>p_team then continue; end if;
       item_minutes:=item_minutes+extract(epoch from segment_end-segment_start)/60;
       credited:=credited||jsonb_build_array(jsonb_build_object('objectId',o.id,
         'start',segment_start,'end',segment_end,'itemMinutes',extract(epoch from segment_end-segment_start)/60,
         'owner',owner,'teamId',p_team,'membershipEventId',membership_event->'id','responsible',ev#>'{after,responsible_ref}','status',ev#>'{after,status}',
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
 proof:=jsonb_build_object('contract','team-work-residence@1','population','all retained intelligence objects',
   'value',result_value,'knownItemMinutes',item_minutes,'eligibleItems',eligible,'coveredItems',covered,
   'incompleteObjectIds',issues,'items',items,'credited',credited,'membership',roster);
 if octet_length(proof::text)>1048576 then raise exception 'Calculation evidence exceeds retention limit' using errcode='54000'; end if;
 if exists(select 1 from view_as_context where actor_user_id=actor and ended_at is null
   and (expires_at is null or expires_at>clock_timestamp())) then
   raise exception 'View-As cannot collect performance observations' using errcode='42501'; end if;
 insert into learn_team_work_measurement_runs(id,tenant_id,team_id,actor_id,request,observed_at,explanation,proof,source_system,metric_key)
 values(p_request,p_tenant,p_team,actor,descriptor,observed,
   'Team-owned elapsed item-minutes from direct team assignments and observed member affiliations, across all recorded states including waiting and closed states. Concurrent items add separately; this is not working hours, speed or productivity. One item is counted once per segment. No business calendar, delay exclusion or averaging of member scores applied. '
   ||covered||' of '||eligible||' retained work items have complete history/identity coverage. '
   ||case when result_value is null then 'Value withheld because coverage is incomplete.' else 'Confirmed review is still required.' end,proof,'serviceos.work.team-residence@1','work.team_owned_item_minutes');
 payload:=jsonb_build_object('id',p_request,'tenantId',p_tenant,'subject',jsonb_build_object('kind','team','id',p_team),
   'metricKey','work.team_owned_item_minutes','policyId',p_policy,'policyVersion',p_revision,
   'period',jsonb_build_object('start',p_start,'end',p_end),'value',result_value,'unit','item_minutes',
   'sampleCount',covered,'coveredCount',covered,'eligibleCount',eligible,'observedAt',observed,
   'sourceThrough',case when covered=eligible then source_through end,'sourceSystem','serviceos.work.team-residence@1',
   'review','inferred','evidence',jsonb_build_array(jsonb_build_object('table','learn_team_work_measurement_runs','id',p_request)),
   'exclusions','[]'::jsonb);
 ack:=learn_performance_append(p_tenant,payload,btrim(p_reason));
 return ack;
end $$;
revoke all on function public.learn_team_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_team_work_residence_collect(uuid,uuid,uuid,int,timestamptz,timestamptz,uuid,text) to authenticated;
