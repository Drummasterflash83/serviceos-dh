-- Managed improvement records. No provider changes, cron activation or secrets.
begin;
create table public.receptionist_care_issues (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 feedback_id uuid unique references public.receptionist_feedback(id),
 source_key text not null,
 title text not null check(length(title) between 1 and 200),
 detail text not null default '' check(length(detail)<=12000),
 priority text not null default 'normal' check(priority in ('normal','high','urgent')),
 stage text not null default 'received' check(stage in ('received','reviewing','approval','approved','verifying','resolved')),
 owner_id uuid references public.profiles(id),
 diagnosis text not null default '',
 proposal text not null default '',
 test_plan text not null default '',
 approved_by uuid references public.profiles(id),
 approved_at timestamptz,
 release_ref text,
 verification text,
 customer_update text not null default 'Your report is saved. OpenFolk will review it.',
 due_at timestamptz,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(tenant_id,source_key),
 unique(tenant_id,id)
);
create index receptionist_care_queue on public.receptionist_care_issues(tenant_id,stage,priority,created_at);
create table public.receptionist_care_events (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 issue_id uuid not null,
 actor_id uuid references public.profiles(id),
 action text not null,
 version integer not null,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id),
 unique(issue_id,version)
);
create table public.receptionist_call_reviews (
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 call_id uuid not null,
 evidence_hash text not null,
 reviewer_version text not null,
 state text not null check(state in ('awaiting_evidence','reviewed','failed')),
 assessment jsonb,
 safe_error text,
 reviewed_at timestamptz not null default now(),
 primary key(tenant_id,call_id,evidence_hash,reviewer_version)
);
-- Rules are operator-owned, never learnt implicitly from caller statements.
create table public.receptionist_review_settings (
 tenant_id uuid primary key references public.receptionist_workspaces(tenant_id),
 enabled boolean not null default false,
 approved_rules text not null default '' check(length(approved_rules)<=20000),
 version integer not null default 1,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now(),
 last_scan_at timestamptz,
 scan_state text not null default 'not_started',
 check(not enabled or length(btrim(approved_rules))>0)
);
-- Only verified channel IDs may be activated by a server-side Slack verifier.
create table public.module_alert_routes (
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 module text not null default 'receptionist' check(module='receptionist'),
 kind text not null check(kind in ('updates','attention','urgent')),
 team_id text not null check(team_id ~ '^T[A-Z0-9]+$'),
 channel_id text not null check(channel_id ~ '^C[A-Z0-9]+$'),
 verified_at timestamptz,
 verified_channel_name text,
 verification_receipt jsonb,
 enabled boolean not null default false,
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now(),
 primary key(tenant_id,module,kind),
 check(not enabled or verified_at is not null)
);
alter table public.receptionist_care_issues enable row level security;
alter table public.receptionist_care_events enable row level security;
alter table public.receptionist_call_reviews enable row level security;
alter table public.receptionist_review_settings enable row level security;
alter table public.module_alert_routes enable row level security;
revoke all on public.receptionist_care_issues,public.receptionist_care_events,public.receptionist_call_reviews,public.receptionist_review_settings,public.module_alert_routes from public,anon,authenticated;
grant select on public.receptionist_care_issues,public.receptionist_care_events,public.receptionist_call_reviews,public.receptionist_review_settings,public.module_alert_routes to authenticated;
grant all on public.receptionist_care_issues,public.receptionist_care_events,public.receptionist_call_reviews,public.receptionist_review_settings,public.module_alert_routes to service_role;
create policy care_operator on public.receptionist_care_issues for select to authenticated using(public.current_user_is_openfolk_operator());
create policy care_event_operator on public.receptionist_care_events for select to authenticated using(public.current_user_is_openfolk_operator());
create policy care_review_operator on public.receptionist_call_reviews for select to authenticated using(public.current_user_is_openfolk_operator());
create policy care_settings_operator on public.receptionist_review_settings for select to authenticated using(public.current_user_is_openfolk_operator());
create policy care_alert_operator on public.module_alert_routes for select to authenticated using(public.current_user_is_openfolk_operator());

create function public.care_require_admin() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.current_user_is_openfolk_operator('platform.controlplane.admin') then raise exception 'OpenFolk administrator required' using errcode='42501'; end if;
 if exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>now())) then raise exception 'Leave client preview before editing' using errcode='42501'; end if;
end $$;

create function public.care_feedback_received() returns trigger language plpgsql security definer set search_path='' as $$
declare issue uuid;
begin
 insert into public.receptionist_care_issues(tenant_id,feedback_id,source_key,title,detail,priority,due_at)
 values(new.tenant_id,new.id,'feedback:'||new.id,new.title,new.body,new.priority,now()+case when new.priority='urgent' then interval '15 minutes' else interval '1 day' end)
 on conflict(feedback_id) do nothing returning id into issue;
 if issue is not null then
 insert into public.receptionist_care_events(tenant_id,issue_id,action,version) values(new.tenant_id,issue,'received',1);
 end if;
 return new;
end $$;
create trigger receptionist_care_received after insert on public.receptionist_feedback for each row execute function public.care_feedback_received();
insert into public.receptionist_care_issues(tenant_id,feedback_id,source_key,title,detail,priority)
select tenant_id,id,'feedback:'||id,title,body,priority from public.receptionist_feedback where status<>'Resolved';
insert into public.receptionist_care_events(tenant_id,issue_id,action,version)
select tenant_id,id,'received',1 from public.receptionist_care_issues;

create function public.care_issue_action(p_tenant uuid,p_issue uuid,p_version integer,p_action text,p_content jsonb default '{}'::jsonb)
returns public.receptionist_care_issues language plpgsql security definer set search_path='' as $$
declare r public.receptionist_care_issues; prior text;
begin
 perform public.care_require_admin();
 if p_version is null or p_action is null or p_content is null or jsonb_typeof(p_content)<>'object' or octet_length(p_content::text)>40000 then raise exception 'Invalid action'; end if;
 select * into r from public.receptionist_care_issues where tenant_id=p_tenant and id=p_issue for update;
 if not found then raise exception 'Issue not found'; end if;
 if r.version<>p_version then raise exception 'This issue changed. Reload before continuing.' using errcode='40001'; end if;
 prior:=r.stage;
 if p_action='claim' and r.stage in ('received','reviewing') then
  r.owner_id:=auth.uid(); r.stage:='reviewing'; r.due_at:=now()+interval '4 hours';
  r.customer_update:='OpenFolk has picked this up. We are checking what happened.';
 elsif p_action='propose' and r.stage in ('reviewing','approval','approved') then
  if r.owner_id is distinct from auth.uid() then raise exception 'Take ownership before proposing a change'; end if;
  if coalesce(length(btrim(p_content->>'diagnosis')),0)<5 or coalesce(length(btrim(p_content->>'proposal')),0)<5 or coalesce(length(btrim(p_content->>'test_plan')),0)<5 then raise exception 'Diagnosis, proposed change and test plan required'; end if;
  r.diagnosis:=p_content->>'diagnosis'; r.proposal:=p_content->>'proposal'; r.test_plan:=p_content->>'test_plan';
  r.stage:='approval'; r.approved_by:=null; r.approved_at:=null;
  r.customer_update:='OpenFolk is reviewing an improvement. Your current setup is unchanged.';
 elsif p_action='approve' and r.stage='approval' then
  r.stage:='approved'; r.approved_by:=auth.uid(); r.approved_at:=now();
  r.customer_update:='OpenFolk has approved the improvement. It has not been released yet.';
 elsif p_action='reopen' and r.stage in ('approved','verifying','resolved') then
  if coalesce(length(btrim(p_content->>'reason')),0)<5 then raise exception 'Reason required'; end if;
  r.stage:='reviewing'; r.owner_id:=auth.uid(); r.approved_by:=null; r.approved_at:=null;
  r.release_ref:=null; r.verification:=null; r.due_at:=now()+interval '4 hours';
  r.customer_update:='OpenFolk is checking this again. We will keep you updated.';
 else
  -- No UI/RPC can claim a release or resolution: a verified deployment adapter
  -- must supply immutable provider version and test evidence first.
  raise exception 'This action is not available at this stage';
 end if;
 update public.receptionist_care_issues set stage=r.stage,owner_id=r.owner_id,diagnosis=r.diagnosis,proposal=r.proposal,test_plan=r.test_plan,
 approved_by=r.approved_by,approved_at=r.approved_at,release_ref=r.release_ref,verification=r.verification,
 customer_update=r.customer_update,due_at=r.due_at,version=version+1,updated_at=now()
 where id=r.id returning * into r;
 insert into public.receptionist_care_events(tenant_id,issue_id,actor_id,action,version,detail)
 values(p_tenant,r.id,auth.uid(),p_action,r.version,jsonb_build_object('from',prior,'to',r.stage,'proposal',r.proposal,'test_plan',r.test_plan,'reason',p_content->>'reason'));
 return r;
end $$;

-- Minimal client projection. Never exposes internal analysis, Slack or approval data.
create function public.care_customer_progress(p_tenant uuid)
returns table(feedback_id uuid,stage text,message text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not (public.current_user_is_openfolk_operator() or
 exists(select 1 from public.receptionist_access where tenant_id=p_tenant and profile_id=auth.uid()) or
 exists(select 1 from public.client_portal_access where tenant_id=p_tenant and profile_id=auth.uid())) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 return query select i.feedback_id,i.stage,i.customer_update,i.updated_at from public.receptionist_care_issues i where i.tenant_id=p_tenant and i.feedback_id is not null order by i.created_at desc;
end $$;

create function public.care_save_settings(p_tenant uuid,p_version integer,p_rules text,p_enabled boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare v integer;
begin
 perform public.care_require_admin();
 if p_rules is null or length(p_rules)>20000 or p_enabled is null or (p_enabled and length(btrim(p_rules))=0) then raise exception 'Approved business rules required'; end if;
 perform 1 from public.receptionist_workspaces where tenant_id=p_tenant for update;
 if not found then raise exception 'Workspace not found'; end if;
 select version into v from public.receptionist_review_settings where tenant_id=p_tenant;
 if p_version is null or coalesce(v,0)<>p_version then raise exception 'Settings changed. Reload.' using errcode='40001'; end if;
 insert into public.receptionist_review_settings(tenant_id,approved_rules,enabled,updated_by,version) values(p_tenant,p_rules,p_enabled,auth.uid(),coalesce(v,0)+1)
 on conflict(tenant_id) do update set approved_rules=excluded.approved_rules,enabled=excluded.enabled,updated_by=excluded.updated_by,version=excluded.version,updated_at=now() returning version into v;
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,after,reason,source)
 values(p_tenant,auth.uid()::text,'receptionist.review.settings','receptionist_review_settings',p_tenant::text,jsonb_build_object('version',v,'enabled',p_enabled,'rules',p_rules),'Operator configured call review','openfolk');
 return v;
end $$;

create function public.care_save_alert_route(p_tenant uuid,p_kind text,p_team text,p_channel text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.care_require_admin();
 if p_kind is null or p_team is null or p_channel is null then raise exception 'Route fields required'; end if;
 insert into public.module_alert_routes(tenant_id,kind,team_id,channel_id,updated_by)
 values(p_tenant,p_kind,p_team,p_channel,auth.uid())
 on conflict(tenant_id,module,kind) do update set team_id=excluded.team_id,channel_id=excluded.channel_id,verified_at=null,verified_channel_name=null,verification_receipt=null,enabled=false,updated_by=auth.uid(),updated_at=now();
 insert into public.controlplane_change_log(tenant_id,actor,action,resource_type,resource_id,after,reason,source)
 values(p_tenant,auth.uid()::text,'receptionist.alert.route_requested','module_alert_route',p_kind,jsonb_build_object('team',p_team,'channel',p_channel),'Destination must be verified before delivery','openfolk');
end $$;

-- Atomic review + issue receipt. The model cannot update existing issues or approvals.
create function public.care_store_review(p_tenant uuid,p_call uuid,p_hash text,p_reviewer text,p_assessment jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare f jsonb; issue uuid; inserted integer;
begin
 if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_reviewer is null or length(p_reviewer)>200
 or p_assessment is null or jsonb_typeof(p_assessment->'findings') is distinct from 'array'
 or jsonb_array_length(p_assessment->'findings')>6 or octet_length(p_assessment::text)>30000 then raise exception 'Invalid review'; end if;
 insert into public.receptionist_call_reviews(tenant_id,call_id,evidence_hash,reviewer_version,state,assessment)
 values(p_tenant,p_call,p_hash,p_reviewer,'reviewed',p_assessment) on conflict do nothing;
 get diagnostics inserted = row_count;
 if inserted=0 then return false; end if;
 for f in select value from jsonb_array_elements(p_assessment->'findings') loop
  if f->>'category' not in ('repetition','contradiction','understanding','handover','safety','technical')
  or f->>'severity' not in ('normal','high','urgent') or coalesce(length(f->>'evidence'),0)=0 then raise exception 'Invalid finding'; end if;
  insert into public.receptionist_care_issues(tenant_id,source_key,title,detail,priority,customer_update,due_at)
  values(p_tenant,'call:'||p_call||':'||(f->>'category'),'Review: '||(f->>'category'),
  'Evidence: '||(f->>'evidence')||E'\n\n'||(f->>'explanation')||E'\n\nSuggested improvement: '||(f->>'suggestedChange'),
  f->>'severity','OpenFolk has flagged a conversation for review.',now()+case when f->>'severity'='urgent' then interval '15 minutes' else interval '1 day' end)
  on conflict(tenant_id,source_key) do nothing returning id into issue;
  if issue is not null then
   insert into public.receptionist_care_events(tenant_id,issue_id,action,version,detail)
   values(p_tenant,issue,'automated_finding',1,jsonb_build_object('call_id',p_call,'evidence_hash',p_hash,'reviewer',p_reviewer));
  end if;
 end loop;
 return true;
end $$;
revoke all on function public.care_store_review(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.care_store_review(uuid,uuid,text,text,jsonb) to service_role;
revoke all on function public.care_require_admin(),public.care_feedback_received(),public.care_issue_action(uuid,uuid,integer,text,jsonb),public.care_customer_progress(uuid),public.care_save_settings(uuid,integer,text,boolean),public.care_save_alert_route(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.care_issue_action(uuid,uuid,integer,text,jsonb),public.care_customer_progress(uuid),public.care_save_settings(uuid,integer,text,boolean),public.care_save_alert_route(uuid,text,text,text) to authenticated;

create function public.care_guard_legacy_resolution() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='Resolved' and old.status is distinct from new.status and exists(select 1 from public.receptionist_care_issues where feedback_id=new.id and stage<>'resolved') then
  raise exception 'A verified improvement is required before resolving this report';
 end if;
 return new;
end $$;
create trigger care_guard_legacy_resolution before update on public.receptionist_feedback for each row execute function public.care_guard_legacy_resolution();
revoke all on function public.care_guard_legacy_resolution() from public,anon,authenticated;
commit;
