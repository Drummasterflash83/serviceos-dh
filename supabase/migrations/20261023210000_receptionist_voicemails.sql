-- Private voicemail foundation. No provider connection or manager grants are inferred.
-- Ingestion and explicit mailbox grants are service-role-only.
begin;
create table public.receptionist_mailboxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  provider text not null default 'birchills',
  provider_mailbox_id text not null,
  display_name text not null,
  extension text not null,
  owner_user_id uuid references auth.users(id),
  notification_email text,
  email_enabled boolean,
  sync_state text not null default 'awaiting_connection' check(sync_state in ('awaiting_connection','current','error')),
  last_synced_at timestamptz,
  unique(tenant_id,provider,provider_mailbox_id), unique(tenant_id,id),
  check(sync_state <> 'current' or last_synced_at is not null)
);
create table public.receptionist_mailbox_managers (
  tenant_id uuid not null,
  mailbox_id uuid not null,
  user_id uuid not null references auth.users(id),
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key(mailbox_id,user_id),
  foreign key(tenant_id,mailbox_id) references public.receptionist_mailboxes(tenant_id,id)
);
create table public.receptionist_voicemails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  mailbox_id uuid not null,
  provider_message_id text not null,
  -- Snapshot the owner: repurposing Alan's extension must NOT give Rob old messages.
  owner_user_id uuid references auth.users(id),
  received_at timestamptz not null,
  caller_number text, caller_name text,
  duration_seconds integer check(duration_seconds >= 0),
  transcript text,
  email_status text not null default 'unknown' check(email_status in ('unknown','pending','sent','delivered','failed')),
  email_evidence_at timestamptz,
  email_evidence_reference text,
  email_recipient text,
  recording_path text,
  recording_available boolean generated always as (recording_path is not null) stored,
  created_at timestamptz not null default now(),
  foreign key(tenant_id,mailbox_id) references public.receptionist_mailboxes(tenant_id,id),
  unique(mailbox_id,provider_message_id),
  check(email_status = 'unknown' or (email_evidence_at is not null and nullif(email_evidence_reference,'') is not null)),
  check(recording_path is null or recording_path = tenant_id::text || '/' || mailbox_id::text || '/' || id::text)
);
create index on public.receptionist_voicemails(tenant_id,mailbox_id,received_at desc,id desc);
create table public.receptionist_voicemail_access_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  message_id uuid not null references public.receptionist_voicemails(id),
  actor_id uuid not null references auth.users(id),
  action text not null check(action = 'playback_link_requested'),
  created_at timestamptz not null default now()
);
alter table public.receptionist_mailboxes enable row level security;
alter table public.receptionist_mailbox_managers enable row level security;
alter table public.receptionist_voicemails enable row level security;
alter table public.receptionist_voicemail_access_log enable row level security;
revoke all on public.receptionist_mailboxes, public.receptionist_mailbox_managers,
  public.receptionist_voicemails, public.receptionist_voicemail_access_log from anon, authenticated;
grant select on public.receptionist_mailboxes, public.receptionist_voicemails to authenticated;
grant all on public.receptionist_mailboxes, public.receptionist_mailbox_managers,
  public.receptionist_voicemails, public.receptionist_voicemail_access_log to service_role;

-- NO blanket tenant-admin or OpenFolk-operator bypass. Each manager is explicitly granted
-- one mailbox. No users are granted access by this migration.
create function public.can_manage_voicemail(p_tenant uuid,p_mailbox uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
   select 1 from public.receptionist_mailbox_managers g
   where g.tenant_id=p_tenant and g.mailbox_id=p_mailbox and g.user_id=auth.uid()
 );
$$;
revoke all on function public.can_manage_voicemail(uuid,uuid) from public,anon;
grant execute on function public.can_manage_voicemail(uuid,uuid) to authenticated;
create policy voicemail_mailbox_read on public.receptionist_mailboxes for select to authenticated using (
  public.can_manage_voicemail(tenant_id,id) or (tenant_id=public.current_tenant_id() and owner_user_id=auth.uid())
);
create policy voicemail_message_read on public.receptionist_voicemails for select to authenticated using (
  public.can_manage_voicemail(tenant_id,mailbox_id) or (tenant_id=public.current_tenant_id() and owner_user_id=auth.uid())
);
-- SECURITY INVOKER: both the rows AND counts use caller RLS.
create function public.voicemail_mailbox_summary(p_tenant uuid)
returns table(id uuid,display_name text,extension text,notification_email text,email_enabled boolean,
 sync_state text,last_synced_at timestamptz,message_count bigint)
language sql stable security invoker set search_path='' as $$
 select b.id,b.display_name,b.extension,b.notification_email,b.email_enabled,b.sync_state,b.last_synced_at,
   (select count(*) from public.receptionist_voicemails v where v.tenant_id=b.tenant_id and v.mailbox_id=b.id)
 from public.receptionist_mailboxes b where b.tenant_id=p_tenant order by b.extension,b.display_name;
$$;
revoke all on function public.voicemail_mailbox_summary(uuid) from public,anon;
grant execute on function public.voicemail_mailbox_summary(uuid) to authenticated;
-- Only the server signs short-lived playback after a user-RLS check.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('receptionist-voicemails','receptionist-voicemails',false,26214400,
 array['audio/mpeg','audio/wav','audio/x-wav','audio/ogg','audio/mp4'])
on conflict(id) do nothing;
do $$begin
 if exists(select 1 from storage.buckets where id='receptionist-voicemails' and public)
 then raise exception 'Voicemail bucket must be private'; end if;
end $$;
-- Restrictive policy prevents a future broad storage policy from exposing this bucket.
create policy voicemail_no_direct_storage_access on storage.objects as restrictive
for all to anon,authenticated using(bucket_id <> 'receptionist-voicemails')
with check(bucket_id <> 'receptionist-voicemails');
commit;
