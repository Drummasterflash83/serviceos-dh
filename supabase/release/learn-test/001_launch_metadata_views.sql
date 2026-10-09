-- Proposed TEST-only metadata read surface. Not in the automatic migration path.
-- Execute only as an explicitly reviewed TEST release, with the target setting
-- in the same session. No existing source row, policy or grant is replaced.
begin;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' then
  raise exception 'Explicit existing TEST target required'; end if;
 if not exists(select 1 from of_test_deploy.migrations where project_ref='saatxzwxvdvqevbnskxy'
   and migration_name='openfolk_test_learn_bootstrap_v5' and source_sha256='821515d9b8034b74826e1a81837c64d1b02804402da223715404d84b307a34d6') then
  raise exception 'Existing TEST bootstrap provenance differs'; end if;
 if exists(select 1 from pg_roles where rolname='learn_launch_metadata_reader') then
  raise exception 'Metadata reader role already exists; inspect release state before retrying'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname=any(array['email_messages','phone_calls','phone_recordings','phone_transcripts',
    'email_accounts','google_workspace_mailboxes','email_sync_runs','phone_sync_runs','profiles']) and not c.relrowsecurity) then
  raise exception 'Existing TEST RLS precondition differs'; end if;
end $$;
create role learn_launch_metadata_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema public,auth to learn_launch_metadata_reader;
grant execute on function auth.uid() to learn_launch_metadata_reader;
grant select(id,tenant_id,role) on public.profiles to learn_launch_metadata_reader;
create policy learn_launch_metadata_profile on public.profiles for select to learn_launch_metadata_reader
 using(id=(select auth.uid()));
-- Temporary schema CREATE lets the restricted role own these views. It is revoked below.
grant create on schema public to learn_launch_metadata_reader;

grant select(id,tenant_id,created_at,raw_payload) on public.email_messages to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.email_messages for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_email_messages with(security_barrier=true,security_invoker=false) as
 select id,tenant_id,created_at,jsonb_build_object('label_ids',to_jsonb(array(select label from unnest(array['INBOX','SENT','DRAFT']) label where raw_payload @> jsonb_build_object('label_ids',jsonb_build_array(label))))) as raw_payload from public.email_messages;
alter view public.learn_launch_email_messages owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_email_messages from public,anon,authenticated,service_role;
grant select on public.learn_launch_email_messages to authenticated;

grant select(id,tenant_id,created_at,provider_call_id,linked_id,direction,started_at,duration_seconds) on public.phone_calls to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.phone_calls for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_phone_calls with(security_barrier=true,security_invoker=false) as
 select id,tenant_id,created_at,provider_call_id,linked_id,direction,started_at,duration_seconds from public.phone_calls;
alter view public.learn_launch_phone_calls owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_phone_calls from public,anon,authenticated,service_role;
grant select on public.learn_launch_phone_calls to authenticated;

grant select(id,tenant_id,created_at,provider_call_id,linked_id) on public.phone_recordings to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.phone_recordings for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_phone_recordings with(security_barrier=true,security_invoker=false) as
 select id,tenant_id,created_at,provider_call_id,linked_id from public.phone_recordings;
alter view public.learn_launch_phone_recordings owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_phone_recordings from public,anon,authenticated,service_role;
grant select on public.learn_launch_phone_recordings to authenticated;

grant select(id,tenant_id,status) on public.phone_transcripts to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.phone_transcripts for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_phone_transcripts with(security_barrier=true,security_invoker=false) as
 select id,tenant_id,status from public.phone_transcripts;
alter view public.learn_launch_phone_transcripts owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_phone_transcripts from public,anon,authenticated,service_role;
grant select on public.learn_launch_phone_transcripts to authenticated;

grant select(tenant_id,status) on public.email_accounts to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.email_accounts for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_email_accounts with(security_barrier=true,security_invoker=false) as
 select tenant_id,status from public.email_accounts;
alter view public.learn_launch_email_accounts owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_email_accounts from public,anon,authenticated,service_role;
grant select on public.learn_launch_email_accounts to authenticated;

grant select(id,tenant_id,sync_enabled,status) on public.google_workspace_mailboxes to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.google_workspace_mailboxes for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_google_workspace_mailboxes with(security_barrier=true,security_invoker=false) as
 select id,tenant_id,sync_enabled,status from public.google_workspace_mailboxes;
alter view public.learn_launch_google_workspace_mailboxes owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_google_workspace_mailboxes from public,anon,authenticated,service_role;
grant select on public.learn_launch_google_workspace_mailboxes to authenticated;

grant select(tenant_id,status,sync_type,started_at,completed_at,records_processed,error_message) on public.email_sync_runs to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.email_sync_runs for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_email_sync_runs with(security_barrier=true,security_invoker=false) as
 select tenant_id,status,sync_type,started_at,completed_at,records_processed,case when error_message is null then null when error_message='' then '' else '[redacted]' end as error_message from public.email_sync_runs;
alter view public.learn_launch_email_sync_runs owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_email_sync_runs from public,anon,authenticated,service_role;
grant select on public.learn_launch_email_sync_runs to authenticated;

grant select(tenant_id,status,sync_type,started_at,completed_at,records_processed,error_message) on public.phone_sync_runs to learn_launch_metadata_reader;
create policy learn_launch_metadata_select on public.phone_sync_runs for select to learn_launch_metadata_reader
 using(tenant_id in (select p.tenant_id from public.profiles p where p.id=(select auth.uid()) and p.role in ('owner','admin')));
create view public.learn_launch_phone_sync_runs with(security_barrier=true,security_invoker=false) as
 select tenant_id,status,sync_type,started_at,completed_at,records_processed,case when error_message is null then null when error_message='' then '' else '[redacted]' end as error_message from public.phone_sync_runs;
alter view public.learn_launch_phone_sync_runs owner to learn_launch_metadata_reader;
revoke all on public.learn_launch_phone_sync_runs from public,anon,authenticated,service_role;
grant select on public.learn_launch_phone_sync_runs to authenticated;

revoke create on schema public from learn_launch_metadata_reader;
-- No membership in this role is granted. The signed-in user's auth.uid() still
-- drives the base-table RLS evaluated through the view owner.
commit;
