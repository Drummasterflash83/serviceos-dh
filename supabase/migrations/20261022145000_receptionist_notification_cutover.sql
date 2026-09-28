-- Explicit verified cutover, not an automatic change to any customer's notifications.
begin;
create table public.care_worker_readiness (
 id uuid primary key default gen_random_uuid(), version text not null check(version='care-worker-v1'),
 observed_at timestamptz not null default clock_timestamp()
);
create table public.client_notification_handoffs (
 outbox_id uuid primary key references public.client_notification_outbox(id),
 tenant_id uuid not null references public.tenants(id),
 issue_id uuid not null, care_alert_id uuid not null references public.receptionist_alert_outbox(id),
 handed_off_at timestamptz not null default now(),
 foreign key(tenant_id,issue_id) references public.receptionist_care_issues(tenant_id,id)
);
alter table public.care_worker_readiness enable row level security;
alter table public.client_notification_handoffs enable row level security;
revoke all on public.care_worker_readiness,public.client_notification_handoffs from public,anon,authenticated;
grant select on public.care_worker_readiness,public.client_notification_handoffs to authenticated;
grant all on public.care_worker_readiness,public.client_notification_handoffs to service_role;
create policy care_readiness_operator on public.care_worker_readiness for select to authenticated using(public.current_user_is_openfolk_operator());
create policy care_handoff_operator on public.client_notification_handoffs for select to authenticated using(public.current_user_is_openfolk_operator());
alter table public.client_notification_outbox drop constraint client_notification_outbox_state_check;
alter table public.client_notification_outbox add constraint client_notification_outbox_state_check check(state in ('queued','sending','sent','failed','superseded'));

create function public.care_record_worker_readiness(p_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare receipt uuid;
begin
 if p_version is distinct from 'care-worker-v1' then raise exception 'Unsupported care worker';end if;
 insert into public.care_worker_readiness(version) values(p_version) returning id into receipt;
 return receipt;
end $$;

-- The legacy dispatcher retained only its LAST error, not attempt history.
-- A pre-send failure on attempt two cannot prove that attempt one did not send.
create function public.care_legacy_handoff_safe(p_state text,p_attempts integer,p_error text,p_sent_at timestamptz)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_sent_at is null and (
  (p_state='queued' and p_attempts=0 and p_error is null) or
  (p_state='failed' and p_attempts=1 and p_error in (
   'Notification routing could not be verified','Slack delivery not configured','Invalid Slack destination',
   'Feedback context unavailable','Practice report binding unavailable','Practice provider unavailable',
   'Practice call unavailable','Practice call scope mismatch','Practice call still processing'
  ))
 ),false);
$$;

-- Internal helper: handoff is not a Slack delivery receipt.
create function public.care_handoff_notification(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n public.client_notification_outbox; issue public.receptionist_care_issues; alert uuid;
begin
 select * into n from public.client_notification_outbox where id=p_id for update;
 if n.id is null or n.source_type<>'receptionist_feedback' or n.state='sent' then return false;end if;
 if n.state='superseded' then return true;end if;
 if not public.care_legacy_handoff_safe(n.state,n.attempts,n.last_error,n.sent_at) then
  raise exception 'legacy_delivery_uncertain' using errcode='55000',hint='An earlier Slack send may have succeeded. Reconcile its receipt before switching delivery.';
 end if;
 select * into issue from public.receptionist_care_issues where tenant_id=n.tenant_id and feedback_id=n.source_id;
 if issue.id is null then raise exception 'No governed issue for notification handoff';end if;
 select id into alert from public.receptionist_alert_outbox where tenant_id=n.tenant_id and issue_id=issue.id order by created_at desc,id limit 1;
 if alert is null then raise exception 'No durable care alert for notification handoff';end if;
 insert into public.client_notification_handoffs(outbox_id,tenant_id,issue_id,care_alert_id)
 values(n.id,n.tenant_id,issue.id,alert) on conflict(outbox_id) do nothing;
 update public.client_notification_outbox set state='superseded',last_error=null where id=n.id;
 return true;
end $$;

create function public.care_enable_notifications(p_tenant uuid,p_worker_receipt uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare n record; handed integer:=0;
begin
 perform public.care_require_admin();
 if not exists(select 1 from public.care_worker_readiness where id=p_worker_receipt and version='care-worker-v1' and observed_at>=clock_timestamp()-interval '15 minutes')
 then raise exception 'A fresh deployed-worker readiness receipt is required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tenant::text,22145000));
 insert into public.receptionist_review_settings(tenant_id) values(p_tenant) on conflict do nothing;
 perform 1 from public.receptionist_review_settings where tenant_id=p_tenant for update;
 perform 1 from public.module_alert_routes where tenant_id=p_tenant and module='receptionist' for share;
 if (select count(*) from public.module_alert_routes where tenant_id=p_tenant and module='receptionist' and enabled and verified_at is not null and verification_receipt is not null)<>3
 then raise exception 'Verify all three OpenFolk alert routes before switching delivery';end if;
 if exists(select 1 from public.client_notification_outbox where tenant_id=p_tenant and source_type='receptionist_feedback' and state<>'superseded'
 and not (state='sent' and sent_at is not null)
 and not public.care_legacy_handoff_safe(state,attempts,last_error,sent_at)) then
  raise exception 'legacy_delivery_uncertain' using errcode='55000',hint='An older delivery is in flight or may have reached Slack. Reconcile its receipt before switching.';
 end if;
 -- Existing legacy receipts do not become new-lane receipts. Suppress only the
 -- initial issue notification they already delivered; newer progress stays queued.
 update public.receptionist_alert_outbox a set state='superseded',last_error='legacy_delivery_already_confirmed',updated_at=now()
 from public.receptionist_care_issues i
 where a.tenant_id=p_tenant and a.issue_id=i.id and a.tenant_id=i.tenant_id and a.reason='event' and a.issue_version=1
 and a.state in ('queued','retry') and exists(select 1 from public.client_notification_outbox o
 where o.tenant_id=p_tenant and o.source_type='receptionist_feedback' and o.source_id=i.feedback_id and o.state='sent' and o.sent_at is not null);
 for n in select id from public.client_notification_outbox where tenant_id=p_tenant and source_type='receptionist_feedback' and state in ('queued','failed') order by created_at,id for update loop
  if public.care_handoff_notification(n.id) then handed:=handed+1;end if;
 end loop;
 update public.receptionist_review_settings set care_notifications_enabled=true,updated_by=auth.uid(),updated_at=now() where tenant_id=p_tenant;
 return handed;
end $$;

create or replace function public.claim_client_notifications() returns setof public.client_notification_outbox
language plpgsql security definer set search_path='' as $$
declare n public.client_notification_outbox; claimed integer:=0;
begin
 for n in select * from public.client_notification_outbox where state in ('queued','failed','sending') and available_at<=now() and attempts<10 order by created_at,id for update skip locked loop
  if n.source_type='receptionist_feedback' then
   if not pg_try_advisory_xact_lock_shared(hashtextextended(n.tenant_id::text,22145000)) then continue;end if;
   if exists(select 1 from public.receptionist_review_settings where tenant_id=n.tenant_id and care_notifications_enabled) then
    perform public.care_handoff_notification(n.id);continue;
   end if;
  end if;
  update public.client_notification_outbox set state='sending',attempts=attempts+1,available_at=now()+interval '5 minutes' where id=n.id returning * into n;
  return next n;claimed:=claimed+1;if claimed>=20 then exit;end if;
 end loop;
end $$;

create function public.care_legacy_notification_allowed(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare n public.client_notification_outbox;
begin
 select * into n from public.client_notification_outbox where id=p_id;
 if n.id is null then return false;end if;
 if n.source_type<>'receptionist_feedback' then return true;end if;
 perform pg_advisory_xact_lock_shared(hashtextextended(n.tenant_id::text,22145000));
 if exists(select 1 from public.receptionist_review_settings where tenant_id=n.tenant_id and care_notifications_enabled) then
  perform public.care_handoff_notification(n.id);return false;
 end if;
 return n.state='sending';
end $$;

create or replace function public.queue_client_feedback() returns trigger
language plpgsql security definer set search_path='' as $$
declare queued uuid;
begin
 if tg_table_name='receptionist_feedback' then
  perform pg_advisory_xact_lock_shared(hashtextextended(new.tenant_id::text,22145000));
  insert into public.client_notification_outbox(tenant_id,source_type,source_id,source_version,priority)
  values(new.tenant_id,'receptionist_feedback',new.id,new.version,new.priority) returning id into queued;
  if exists(select 1 from public.receptionist_review_settings where tenant_id=new.tenant_id and care_notifications_enabled) then
   perform public.care_handoff_notification(queued);
  end if;
 elsif tg_table_name='client_programmes' then
  insert into public.client_notification_outbox(tenant_id,source_type,source_id,source_version) values(new.tenant_id,'programme_updated',new.tenant_id,new.version);
 else
  insert into public.client_notification_outbox(tenant_id,source_type,source_id) values(new.tenant_id,'programme_note',new.id);
 end if;
 return new;
end $$;

revoke all on function public.care_record_worker_readiness(text),public.care_legacy_handoff_safe(text,integer,text,timestamptz),public.care_handoff_notification(uuid),public.care_legacy_notification_allowed(uuid),public.care_enable_notifications(uuid,uuid),public.claim_client_notifications(),public.queue_client_feedback() from public,anon,authenticated;
grant execute on function public.care_record_worker_readiness(text),public.care_legacy_handoff_safe(text,integer,text,timestamptz),public.care_handoff_notification(uuid),public.care_legacy_notification_allowed(uuid),public.claim_client_notifications() to service_role;
grant execute on function public.care_enable_notifications(uuid,uuid) to authenticated;
commit;
