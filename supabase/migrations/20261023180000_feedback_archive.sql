-- Recoverable removal of obsolete test reports, without deleting call evidence.
begin;
alter table public.receptionist_care_issues add column archived_at timestamptz, add column archive_reason text;
alter table public.receptionist_feedback add column archived_at timestamptz;
create policy active_care_only on public.receptionist_care_issues as restrictive for select to authenticated using(archived_at is null);
create policy active_feedback_only on public.receptionist_feedback as restrictive for select to authenticated using(archived_at is null);
create or replace function public.care_customer_progress(p_tenant uuid)
returns table(feedback_id uuid,stage text,message text,updated_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not (public.current_user_is_openfolk_operator() or
 exists(select 1 from public.receptionist_access where tenant_id=p_tenant and profile_id=auth.uid()) or
 exists(select 1 from public.client_portal_access where tenant_id=p_tenant and profile_id=auth.uid())) then raise exception 'Workspace unavailable' using errcode='42501'; end if;
 return query select i.feedback_id,i.stage,i.customer_update,i.updated_at from public.receptionist_care_issues i where i.tenant_id=p_tenant and i.feedback_id is not null and i.archived_at is null order by i.created_at desc;
end $$;
create or replace function public.queue_client_feedback() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='receptionist_feedback' then
  if new.archived_at is not null then return new; end if;
  insert into public.client_notification_outbox(tenant_id,source_type,source_id,source_version,priority)
  values(new.tenant_id,'receptionist_feedback',new.id,new.version,new.priority);
 elsif tg_table_name='client_programmes' then
  insert into public.client_notification_outbox(tenant_id,source_type,source_id,source_version)
  values(new.tenant_id,'programme_updated',new.tenant_id,new.version);
 else
  insert into public.client_notification_outbox(tenant_id,source_type,source_id) values(new.tenant_id,'programme_note',new.id);
 end if;
 return new;
end $$;
-- Explicit operator acceptance is distinct from a recorded verification pass.
-- Service-only: no new browser authority or automatic closure is introduced.
create function public.care_close_accepted_report(p_tenant uuid,p_issue uuid,p_actor uuid,p_version integer,p_action text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare i public.receptionist_care_issues;
begin
 perform public.care_release_actor(p_actor);
 if p_reason is null or length(btrim(p_reason))<15 then raise exception 'Acceptance or archive reason required'; end if;
 select * into i from public.receptionist_care_issues where tenant_id=p_tenant and id=p_issue for update;
 if not found or i.version is distinct from p_version or i.archived_at is not null then raise exception 'Task changed'; end if;
 if exists(select 1 from public.receptionist_releases where tenant_id=p_tenant and state in ('publishing','rolling_back','uncertain')) then raise exception 'Unconfirmed provider change must be checked first'; end if;
 if p_action='accept' then
  if i.stage<>'verifying' or not exists(select 1 from public.receptionist_releases where id::text=i.release_ref and tenant_id=p_tenant and issue_id=i.id and state='applied') then raise exception 'Confirmed publication required'; end if;
  update public.receptionist_care_issues set stage='resolved',verification='Operator acceptance (not an acoustic or recorded-call verification): '||p_reason,
   customer_update='OpenFolk has published the change and closed this report following operator acceptance. A fresh test can be recorded separately.',version=version+1,updated_at=now() where id=i.id;
 elsif p_action='archive' then
  if i.release_ref is not null then raise exception 'A released report must not be archived as an unused test'; end if;
  update public.receptionist_feedback set archived_at=now() where id=i.feedback_id and tenant_id=p_tenant;
  update public.receptionist_care_issues set archived_at=now(),archive_reason=p_reason,version=version+1,updated_at=now() where id=i.id;
 else raise exception 'Unsupported action'; end if;
 insert into public.receptionist_care_events(tenant_id,issue_id,actor_id,action,version,detail)
 values(p_tenant,i.id,p_actor,'operator_'||p_action,i.version+1,jsonb_build_object('reason',p_reason,'previous_stage',i.stage,'recorded_verification',false));
end $$;
revoke all on function public.care_close_accepted_report(uuid,uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.care_close_accepted_report(uuid,uuid,uuid,integer,text,text) to service_role;
commit;
