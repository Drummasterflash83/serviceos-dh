-- Operator task desk; no provider mutations or automatic releases.
begin;
create function public.care_desk_operator() returns boolean language sql stable security definer set search_path='' as $$
 select public.current_user_is_openfolk_operator('platform.controlplane.admin')
 and exists(select 1 from auth.users where id=auth.uid() and lower(email)='chris@openfolk.ai')
 and not exists(select 1 from public.view_as_context where actor_user_id=auth.uid() and ended_at is null and (expires_at is null or expires_at>now()));
$$;
revoke all on function public.care_desk_operator() from public,anon;
grant execute on function public.care_desk_operator() to authenticated,service_role;
create or replace function public.care_require_admin() returns void language plpgsql security definer set search_path='' as $$
begin if not coalesce(public.care_desk_operator(),false) then raise exception 'OpenFolk administrator required; leave client preview before editing' using errcode='42501'; end if; end $$;
drop policy care_operator on public.receptionist_care_issues;
drop policy care_event_operator on public.receptionist_care_events;
drop policy care_review_operator on public.receptionist_call_reviews;
drop policy care_settings_operator on public.receptionist_review_settings;
drop policy care_alert_operator on public.module_alert_routes;
create policy care_operator on public.receptionist_care_issues for select to authenticated using(public.care_desk_operator());
create policy care_event_operator on public.receptionist_care_events for select to authenticated using(public.care_desk_operator());
create policy care_review_operator on public.receptionist_call_reviews for select to authenticated using(public.care_desk_operator());
create policy care_settings_operator on public.receptionist_review_settings for select to authenticated using(public.care_desk_operator());
create policy care_alert_operator on public.module_alert_routes for select to authenticated using(public.care_desk_operator());

-- Publish only the safe progress message to the existing client feedback record.
-- Its existing outbox trigger delivers that update using Notifications' saved route.
create function public.care_desk_publish_progress() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.feedback_id is not null and (new.stage is distinct from old.stage or new.customer_update is distinct from old.customer_update) then
  update public.receptionist_feedback set response=new.customer_update,
   status=case new.stage when 'received' then 'New' when 'reviewing' then 'Reviewing' when 'approval' then 'Reviewing' when 'approved' then 'In progress' when 'verifying' then 'Ready to test' when 'resolved' then 'Resolved' end
  where id=new.feedback_id and tenant_id=new.tenant_id;
 end if;
 return new;
end $$;
create trigger care_desk_publish_progress after update on public.receptionist_care_issues for each row execute function public.care_desk_publish_progress();
revoke all on function public.care_desk_publish_progress() from public,anon,authenticated;

create table public.receptionist_task_reviews (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null,
 issue_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 state text not null default 'running' check(state in ('running','completed','failed')),
 assessment jsonb,
 evidence_hash text,
 assistant_version text,
 call_id uuid,
 model text,
 safe_error text,
 created_at timestamptz not null default now(),
 finished_at timestamptz,
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id)
);
alter table public.receptionist_task_reviews enable row level security;
revoke all on public.receptionist_task_reviews from public,anon,authenticated;
grant select on public.receptionist_task_reviews to authenticated;
grant all on public.receptionist_task_reviews to service_role;
create policy task_review_operator on public.receptionist_task_reviews for select to authenticated using(public.care_desk_operator());
create index task_reviews_issue on public.receptionist_task_reviews(tenant_id,issue_id,created_at desc);
create function public.care_desk_reserve_review(p_tenant uuid,p_issue uuid,p_actor uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 perform public.notification_require_actor(p_actor);
 if not exists(select 1 from auth.users where id=p_actor and lower(email)='chris@openfolk.ai') then raise exception 'Administrator required' using errcode='42501'; end if;
 -- Workspace lock makes quotas/concurrency atomic across different tasks.
 perform 1 from public.receptionist_workspaces where tenant_id=p_tenant for update;
 if not found then raise exception 'Workspace unavailable'; end if;
 if not exists(select 1 from public.receptionist_care_issues where id=p_issue and tenant_id=p_tenant and stage<>'resolved') then raise exception 'Open task required'; end if;
 if exists(select 1 from public.receptionist_task_reviews where tenant_id=p_tenant and state='running' and created_at>now()-interval '2 minutes') then raise exception 'A review is already running'; end if;
 if exists(select 1 from public.receptionist_task_reviews where tenant_id=p_tenant and issue_id=p_issue and created_at>now()-interval '1 minute') then raise exception 'Wait a minute before reviewing again'; end if;
 if (select count(*) from public.receptionist_task_reviews where tenant_id=p_tenant and created_at>now()-interval '1 day')>=30 then raise exception 'Daily review safeguard reached'; end if;
 update public.receptionist_task_reviews set state='failed',safe_error='Review interrupted. Retry when ready.',finished_at=now() where tenant_id=p_tenant and state='running' and created_at<=now()-interval '2 minutes';
 insert into public.receptionist_task_reviews(tenant_id,issue_id,actor_id) values(p_tenant,p_issue,p_actor) returning id into r;
 return r;
end $$;
revoke all on function public.care_desk_reserve_review(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.care_desk_reserve_review(uuid,uuid,uuid) to service_role;
commit;
