-- Client receptionist workspace. No phone routing changes or invitations.
create table public.receptionist_workspaces (
  tenant_id uuid primary key references public.tenants(id),
  company text not null,
  name text not null,
  role text not null default 'AI receptionist',
  assistant_id uuid not null unique,
  phone_number text,
  launch_stage text not null default 'Testing' check (launch_stage in ('Testing','Live','Paused')),
  launch_note text not null default 'Production routing has not been verified.',
  knowledge_version text,
  reviewed_at timestamptz,
  vapi_secret_name text not null check (vapi_secret_name ~ '^RECEPTIONIST_VAPI_[A-Z0-9_]+$'),
  slack_secret_name text check (slack_secret_name ~ '^RECEPTIONIST_SLACK_[A-Z0-9_]+$'),
  build_task_id uuid,
  created_at timestamptz not null default now()
);
create table public.receptionist_access (
  tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
  profile_id uuid not null references public.profiles(id),
  primary key(tenant_id,profile_id)
);
alter table public.receptionist_workspaces enable row level security;
alter table public.receptionist_access enable row level security;
revoke all on public.receptionist_workspaces,public.receptionist_access from anon,authenticated;
grant select on public.receptionist_workspaces,public.receptionist_access to authenticated;
grant all on public.receptionist_workspaces,public.receptionist_access to service_role;
create policy receptionist_access_self on public.receptionist_access for select to authenticated
using(profile_id=auth.uid() or public.current_user_is_openfolk_operator());
create policy receptionist_workspace_read on public.receptionist_workspaces for select to authenticated using (
 public.current_user_is_openfolk_operator() or
 exists(select 1 from public.receptionist_access a where a.tenant_id=receptionist_workspaces.tenant_id and a.profile_id=auth.uid()) or
 exists(select 1 from public.client_portal_access a where a.tenant_id=receptionist_workspaces.tenant_id and a.profile_id=auth.uid())
);

create table public.receptionist_feedback (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.receptionist_workspaces(tenant_id),
 call_id uuid,
 author_id uuid not null default auth.uid() references public.profiles(id),
 title text not null check(length(btrim(title)) between 1 and 160),
 body text not null check(length(btrim(body)) between 1 and 10000),
 priority text not null default 'normal' check(priority in ('normal','high','urgent')),
 category text not null default 'improvement' check(category in ('improvement','routing','knowledge','caller-experience','technical','praise')),
 status text not null default 'New' check(status in ('New','Reviewing','In progress','Ready to test','Resolved')),
 response text not null default '' check(length(response)<=10000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index receptionist_feedback_tenant on public.receptionist_feedback(tenant_id,created_at desc);
alter table public.receptionist_feedback enable row level security;
revoke all on public.receptionist_feedback from anon,authenticated;
grant select on public.receptionist_feedback to authenticated;
grant insert(tenant_id,call_id,title,body,priority,category) on public.receptionist_feedback to authenticated;
grant update(status,response) on public.receptionist_feedback to authenticated;
grant all on public.receptionist_feedback to service_role;
create policy receptionist_feedback_read on public.receptionist_feedback for select to authenticated using(
 exists(select 1 from public.receptionist_workspaces w where w.tenant_id=receptionist_feedback.tenant_id)
);
create policy receptionist_feedback_insert on public.receptionist_feedback for insert to authenticated with check(
 author_id=auth.uid() and exists(select 1 from public.receptionist_workspaces w where w.tenant_id=receptionist_feedback.tenant_id)
);
create policy receptionist_feedback_update on public.receptionist_feedback for update to authenticated
using(public.current_user_is_openfolk_operator('platform.controlplane.admin'))
with check(public.current_user_is_openfolk_operator('platform.controlplane.admin'));

-- Durable notification queue: no delivery is claimed until the dispatcher confirms it.
create table public.client_notification_outbox (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 source_type text not null,
 source_id uuid not null,
 source_version integer not null default 1,
 priority text not null default 'normal',
 state text not null default 'queued' check(state in ('queued','sending','sent','failed')),
 attempts integer not null default 0,
 available_at timestamptz not null default now(),
 sent_at timestamptz,
 last_error text,
 created_at timestamptz not null default now(),
 unique(source_type,source_id,source_version)
);
alter table public.client_notification_outbox enable row level security;
revoke all on public.client_notification_outbox from anon,authenticated;
grant select on public.client_notification_outbox to authenticated;
grant all on public.client_notification_outbox to service_role;
create policy client_notification_read on public.client_notification_outbox for select to authenticated using(
 public.current_user_is_openfolk_operator() or
 (source_type='receptionist_feedback' and exists(select 1 from public.receptionist_workspaces w where w.tenant_id=client_notification_outbox.tenant_id)) or
 (source_type='programme_note' and exists(select 1 from public.client_programmes p where p.tenant_id=client_notification_outbox.tenant_id))
);
create function public.receptionist_feedback_stamp() returns trigger language plpgsql set search_path='' as $$
begin new.version:=old.version+1; new.updated_at:=now(); return new; end $$;
create trigger receptionist_feedback_stamp before update on public.receptionist_feedback for each row execute function public.receptionist_feedback_stamp();
create function public.queue_client_feedback() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='receptionist_feedback' then
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
create trigger receptionist_feedback_notify after insert or update on public.receptionist_feedback for each row execute function public.queue_client_feedback();
create trigger programme_note_notify after insert on public.client_programme_notes for each row execute function public.queue_client_feedback();
create trigger programme_update_notify after insert or update on public.client_programmes for each row execute function public.queue_client_feedback();
revoke all on function public.receptionist_feedback_stamp(),public.queue_client_feedback() from public,anon,authenticated;

create function public.claim_client_notifications() returns setof public.client_notification_outbox
language sql security definer set search_path='' as $$
 update public.client_notification_outbox set state='sending',attempts=attempts+1,available_at=now()+interval '5 minutes'
 where id in(select id from public.client_notification_outbox where
 (state in ('queued','failed','sending')) and available_at<=now() and attempts<10
 order by created_at for update skip locked limit 20) returning *;
$$;
revoke all on function public.claim_client_notifications() from public,anon,authenticated;
grant execute on function public.claim_client_notifications() to service_role;
