-- TEST-only shared operator health foundation; no activation, access grants or source imports.
begin;
set local lock_timeout='3s';set local statement_timeout='30s';set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((jsonb_build_object(
 'runtime',jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('email_ingestion_account_guard_v2','email_ingestion_checkpoint_json_v2','email_ingestion_count_v2','email_ingestion_evidence_v2','email_ingestion_keys_v2','email_ingestion_payload_v2','email_ingestion_recovery_v2','email_ingestion_run_guard_v2','email_ingestion_transition_result_v2','email_ingestion_transition_v2','learn_operator_input_access','learn_operator_input_immutable','learn_slack_claim_jobs','platform_jobs_claim','platform_jobs_complete_email_v1','phone_retry_state','phone_pending_readiness','phone_select_pending','learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job','learn_email_transition_immutable','learn_email_transition_prepare','learn_email_transition_pending','learn_email_transition_apply','learn_email_job_attempt','learn_email_attempt_lease','learn_email_store_guard','learn_email_store_existing','learn_email_store_page','learn_email_job_fail','learn_email_enqueue')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.policyname),'[]') from pg_policies x where x.schemaname='public' and x.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('tenants','profiles','feature_flags','platform_jobs','slack_workspace_pacing','email_accounts','email_sync_runs','email_threads','email_messages','email_ingestion_checkpoints','email_ingestion_transitions','email_oauth_tokens','google_workspace_connections','google_workspace_mailboxes','phone_recordings','phone_transcripts','phone_ai_insights','phone_sync_runs','learn_capture_control_requests','learn_email_transition_requests','learn_email_transition_settlements','learn_email_job_attempts') and c.relkind='r'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state'),
 'ledger',(select jsonb_agg(jsonb_build_object('migration_name',migration_name,'source_sha256',source_sha256,'project_ref',project_ref) order by migration_name) from of_test_deploy.migrations)
),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('client_portal_access','client_programmes','client_programme_revisions','client_programme_notes','receptionist_workspaces','receptionist_access','receptionist_feedback','client_notification_outbox') and c.relkind='r'),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('current_user_is_openfolk_operator','client_programme_stamp','client_programme_record_revision','receptionist_feedback_stamp','queue_client_feedback','claim_client_notifications','client_portal_write_context')),
 'defaultPrivileges',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by d.defaclrole::regrole::text,n.nspname,d.defaclobjtype),'[]') from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname='public')
))::text) <> '6e706d18f0515ae74e6d44ae2bca55d7' then raise exception 'Exact operator health prerequisites required';end if;
end $$;
create temporary table serviceos_operator_health_preserved on commit drop as select 'public.email_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_messages s union all select 'public.phone_calls' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_calls s union all select 'public.phone_recordings' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_recordings s union all select 'public.phone_transcripts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_transcripts s union all select 'public.slack_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_messages s union all select 'public.slack_message_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_message_versions s union all select 'public.interactions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.interactions s union all select 'public.people' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.people s union all select 'public.companies' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.companies s union all select 'public.customer_cards' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.customer_cards s union all select 'public.sites' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.sites s union all select 'public.jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.jobs s union all select 'public.provider_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connections s union all select 'public.tenant_connectors' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenant_connectors s union all select 'public.connector_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.connector_accounts s union all select 'public.platform_jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_jobs s union all select 'public.feature_flags' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.feature_flags s union all select 'public.learn_business_input_pages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_pages s union all select 'public.learn_business_input_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_versions s union all select 'public.learn_business_input_observations' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_observations s union all select 'public.provider_connection_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connection_events s union all select 'public.platform_authority_grants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_authority_grants s union all select 'public.learn_operator_input_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_operator_input_requests s union all select 'public.profiles' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.profiles s union all select 'public.authority_permissions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.authority_permissions s union all select 'public.learn_business_input_request_gates' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_gates s union all select 'public.learn_business_input_request_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_permits s union all select 'vault.secrets' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from vault.secrets s union all select 'public.tenants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenants s union all select 'public.view_as_context' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.view_as_context s union all select 'public.config_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.config_versions s union all select 'public.learn_commusoft_connection_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_connection_requests s union all select 'public.learn_commusoft_verification_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_requests s union all select 'public.learn_commusoft_verification_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_permits s union all select 'public.learn_commusoft_verification_results' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_results s union all select 'public.learn_business_input_links' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_links s union all select 'public.learn_business_input_projection_attempts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_attempts s union all select 'public.learn_business_input_projection_batches' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_batches s union all select 'public.contact_points' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.contact_points s union all select 'public.graph_nodes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_nodes s union all select 'public.graph_edges' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_edges s union all select 'public.graph_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_events s union all select 'public.email_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_accounts s union all select 'public.email_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_sync_runs s union all select 'public.email_threads' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_threads s union all select 'public.email_ingestion_checkpoints' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_checkpoints s union all select 'public.email_ingestion_transitions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_transitions s union all select 'public.google_workspace_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_connections s union all select 'public.google_workspace_mailboxes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_mailboxes s union all select 'public.phone_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_sync_runs s union all select 'public.phone_ai_insights' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_ai_insights s union all select 'public.slack_workspace_pacing' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_workspace_pacing s union all select 'public.learn_capture_control_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_capture_control_requests s union all select 'public.learn_email_transition_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_email_transition_requests s union all select 'public.learn_email_transition_settlements' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_email_transition_settlements s union all select 'public.learn_email_job_attempts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_email_job_attempts s;
-- Client-facing outcome programmes. Independent of operational ingestion/activation.
-- Portal membership never grants tenant/profile or Control Plane authority.
create table public.client_portal_access (
  tenant_id uuid not null references public.tenants(id),
  profile_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, profile_id)
);
alter table public.client_portal_access enable row level security;
revoke all on public.client_portal_access from anon, authenticated;
grant select on public.client_portal_access to authenticated;
grant all on public.client_portal_access to service_role;
create policy portal_access_self on public.client_portal_access for select to authenticated
using (profile_id = auth.uid() or public.current_user_is_openfolk_operator());

create table public.client_programmes (
  tenant_id uuid primary key references public.tenants(id),
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) < 200000),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
alter table public.client_programmes enable row level security;
revoke all on public.client_programmes from anon, authenticated;
grant select, insert, update on public.client_programmes to authenticated;
grant all on public.client_programmes to service_role;
create policy programme_read on public.client_programmes for select to authenticated
using (public.current_user_is_openfolk_operator() or exists (
  select 1 from public.client_portal_access a where a.tenant_id = client_programmes.tenant_id and a.profile_id = auth.uid()
));
create policy programme_insert on public.client_programmes for insert to authenticated
with check (public.current_user_is_openfolk_operator('platform.controlplane.admin'));
create policy programme_update on public.client_programmes for update to authenticated
using (public.current_user_is_openfolk_operator('platform.controlplane.admin'))
with check (public.current_user_is_openfolk_operator('platform.controlplane.admin'));

create table public.client_programme_revisions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id),
  version integer not null,
  content jsonb not null,
  actor_id uuid,
  recorded_at timestamptz not null default now(),
  unique(tenant_id, version)
);
alter table public.client_programme_revisions enable row level security;
revoke all on public.client_programme_revisions from anon, authenticated;
grant select on public.client_programme_revisions to authenticated;
grant all on public.client_programme_revisions to service_role;
create policy programme_revisions_operator on public.client_programme_revisions for select to authenticated
using (public.current_user_is_openfolk_operator());

create function public.client_programme_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id then raise exception 'Programme tenant cannot change'; end if;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger client_programme_stamp before insert or update on public.client_programmes
for each row execute function public.client_programme_stamp();
create function public.client_programme_record_revision() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.client_programme_revisions(tenant_id,version,content,actor_id)
    values (new.tenant_id,new.version,new.content,auth.uid());
  return new;
end $$;
create trigger client_programme_revision after insert or update on public.client_programmes
for each row execute function public.client_programme_record_revision();
revoke all on function public.client_programme_stamp() from public, anon, authenticated;
revoke all on function public.client_programme_record_revision() from public, anon, authenticated;

create table public.client_programme_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.client_programmes(tenant_id),
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (length(btrim(body)) between 1 and 10000),
  created_at timestamptz not null default now()
);
alter table public.client_programme_notes enable row level security;
revoke all on public.client_programme_notes from anon, authenticated;
grant select on public.client_programme_notes to authenticated;
grant insert (tenant_id, body) on public.client_programme_notes to authenticated;
grant all on public.client_programme_notes to service_role;
create policy programme_notes_read on public.client_programme_notes for select to authenticated
using (exists (select 1 from public.client_programmes p where p.tenant_id = client_programme_notes.tenant_id));
create policy programme_notes_insert on public.client_programme_notes for insert to authenticated
with check (author_id = auth.uid() and exists (
  select 1 from public.client_programmes p where p.tenant_id = client_programme_notes.tenant_id
));

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

-- Client preview is read-only, including direct PostgREST writes. Existing
-- membership/operator policies remain mandatory; this only restricts writes.
create function public.client_portal_write_context() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and not exists (
  select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>now())
 );
$$;
revoke all on function public.client_portal_write_context() from public,anon,authenticated;
grant execute on function public.client_portal_write_context() to authenticated;

create policy programme_preview_insert_guard on public.client_programmes
 as restrictive for insert to authenticated with check(public.client_portal_write_context());
create policy programme_preview_update_guard on public.client_programmes
 as restrictive for update to authenticated using(public.client_portal_write_context())
 with check(public.client_portal_write_context());
create policy programme_note_preview_guard on public.client_programme_notes
 as restrictive for insert to authenticated with check(public.client_portal_write_context());
create policy feedback_preview_insert_guard on public.receptionist_feedback
 as restrictive for insert to authenticated with check(public.client_portal_write_context());
create policy feedback_preview_update_guard on public.receptionist_feedback
 as restrictive for update to authenticated using(public.client_portal_write_context())
 with check(public.client_portal_write_context());

do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_operator_health_preserved x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (select 'public.email_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_messages s union all select 'public.phone_calls' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_calls s union all select 'public.phone_recordings' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_recordings s union all select 'public.phone_transcripts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_transcripts s union all select 'public.slack_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_messages s union all select 'public.slack_message_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_message_versions s union all select 'public.interactions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.interactions s union all select 'public.people' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.people s union all select 'public.companies' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.companies s union all select 'public.customer_cards' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.customer_cards s union all select 'public.sites' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.sites s union all select 'public.jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.jobs s union all select 'public.provider_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connections s union all select 'public.tenant_connectors' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenant_connectors s union all select 'public.connector_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.connector_accounts s union all select 'public.platform_jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_jobs s union all select 'public.feature_flags' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.feature_flags s union all select 'public.learn_business_input_pages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_pages s union all select 'public.learn_business_input_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_versions s union all select 'public.learn_business_input_observations' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_observations s union all select 'public.provider_connection_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connection_events s union all select 'public.platform_authority_grants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_authority_grants s union all select 'public.learn_operator_input_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_operator_input_requests s union all select 'public.profiles' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.profiles s union all select 'public.authority_permissions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.authority_permissions s union all select 'public.learn_business_input_request_gates' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_gates s union all select 'public.learn_business_input_request_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_permits s union all select 'vault.secrets' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from vault.secrets s union all select 'public.tenants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenants s union all select 'public.view_as_context' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.view_as_context s union all select 'public.config_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.config_versions s union all select 'public.learn_commusoft_connection_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_connection_requests s union all select 'public.learn_commusoft_verification_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_requests s union all select 'public.learn_commusoft_verification_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_permits s union all select 'public.learn_commusoft_verification_results' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_results s union all select 'public.learn_business_input_links' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_links s union all select 'public.learn_business_input_projection_attempts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_attempts s union all select 'public.learn_business_input_projection_batches' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_batches s union all select 'public.contact_points' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.contact_points s union all select 'public.graph_nodes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_nodes s union all select 'public.graph_edges' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_edges s union all select 'public.graph_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_events s union all select 'public.email_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_accounts s union all select 'public.email_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_sync_runs s union all select 'public.email_threads' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_threads s union all select 'public.email_ingestion_checkpoints' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_checkpoints s union all select 'public.email_ingestion_transitions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_transitions s union all select 'public.google_workspace_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_connections s union all select 'public.google_workspace_mailboxes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_mailboxes s union all select 'public.phone_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_sync_runs s union all select 'public.phone_ai_insights' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_ai_insights s union all select 'public.slack_workspace_pacing' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_workspace_pacing s union all select 'public.learn_capture_control_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_capture_control_requests s union all select 'public.learn_email_transition_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_email_transition_requests s union all select 'public.learn_email_transition_settlements' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_email_transition_settlements s union all select 'public.learn_email_job_attempts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_email_job_attempts s)x) then raise exception 'Retained sources changed during operator health release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_operator_health_base_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
select 'learn-operator-health/1' as marker,jsonb_build_object(
 'runtime',jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('email_ingestion_account_guard_v2','email_ingestion_checkpoint_json_v2','email_ingestion_count_v2','email_ingestion_evidence_v2','email_ingestion_keys_v2','email_ingestion_payload_v2','email_ingestion_recovery_v2','email_ingestion_run_guard_v2','email_ingestion_transition_result_v2','email_ingestion_transition_v2','learn_operator_input_access','learn_operator_input_immutable','learn_slack_claim_jobs','platform_jobs_claim','platform_jobs_complete_email_v1','phone_retry_state','phone_pending_readiness','phone_select_pending','learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job','learn_email_transition_immutable','learn_email_transition_prepare','learn_email_transition_pending','learn_email_transition_apply','learn_email_job_attempt','learn_email_attempt_lease','learn_email_store_guard','learn_email_store_existing','learn_email_store_page','learn_email_job_fail','learn_email_enqueue')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.policyname),'[]') from pg_policies x where x.schemaname='public' and x.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('tenants','profiles','feature_flags','platform_jobs','slack_workspace_pacing','email_accounts','email_sync_runs','email_threads','email_messages','email_ingestion_checkpoints','email_ingestion_transitions','email_oauth_tokens','google_workspace_connections','google_workspace_mailboxes','phone_recordings','phone_transcripts','phone_ai_insights','phone_sync_runs','learn_capture_control_requests','learn_email_transition_requests','learn_email_transition_settlements','learn_email_job_attempts') and c.relkind='r'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state'),
 'ledger',(select jsonb_agg(jsonb_build_object('migration_name',migration_name,'source_sha256',source_sha256,'project_ref',project_ref) order by migration_name) from of_test_deploy.migrations)
),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('client_portal_access','client_programmes','client_programme_revisions','client_programme_notes','receptionist_workspaces','receptionist_access','receptionist_feedback','client_notification_outbox') and c.relkind='r'),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('current_user_is_openfolk_operator','client_programme_stamp','client_programme_record_revision','receptionist_feedback_stamp','queue_client_feedback','claim_client_notifications','client_portal_write_context')),
 'defaultPrivileges',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by d.defaclrole::regrole::text,n.nspname,d.defaclobjtype),'[]') from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname='public')
) as catalog,md5((jsonb_build_object(
 'runtime',jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('email_ingestion_account_guard_v2','email_ingestion_checkpoint_json_v2','email_ingestion_count_v2','email_ingestion_evidence_v2','email_ingestion_keys_v2','email_ingestion_payload_v2','email_ingestion_recovery_v2','email_ingestion_run_guard_v2','email_ingestion_transition_result_v2','email_ingestion_transition_v2','learn_operator_input_access','learn_operator_input_immutable','learn_slack_claim_jobs','platform_jobs_claim','platform_jobs_complete_email_v1','phone_retry_state','phone_pending_readiness','phone_select_pending','learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job','learn_email_transition_immutable','learn_email_transition_prepare','learn_email_transition_pending','learn_email_transition_apply','learn_email_job_attempt','learn_email_attempt_lease','learn_email_store_guard','learn_email_store_existing','learn_email_store_page','learn_email_job_fail','learn_email_enqueue')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.policyname),'[]') from pg_policies x where x.schemaname='public' and x.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('tenants','profiles','feature_flags','platform_jobs','slack_workspace_pacing','email_accounts','email_sync_runs','email_threads','email_messages','email_ingestion_checkpoints','email_ingestion_transitions','email_oauth_tokens','google_workspace_connections','google_workspace_mailboxes','phone_recordings','phone_transcripts','phone_ai_insights','phone_sync_runs','learn_capture_control_requests','learn_email_transition_requests','learn_email_transition_settlements','learn_email_job_attempts') and c.relkind='r'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state'),
 'ledger',(select jsonb_agg(jsonb_build_object('migration_name',migration_name,'source_sha256',source_sha256,'project_ref',project_ref) order by migration_name) from of_test_deploy.migrations)
),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.policyname),'[]') from pg_policies p where p.schemaname='public' and p.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('client_portal_access','client_programmes','client_programme_revisions','client_programme_notes','receptionist_workspaces','receptionist_access','receptionist_feedback','client_notification_outbox') and c.relkind='r'),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('current_user_is_openfolk_operator','client_programme_stamp','client_programme_record_revision','receptionist_feedback_stamp','queue_client_feedback','claim_client_notifications','client_portal_write_context')),
 'defaultPrivileges',(select coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by d.defaclrole::regrole::text,n.nspname,d.defaclobjtype),'[]') from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname='public')
))::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_operator_health_preserved x) as preserved;
commit;
