-- TEST-only capture controls and durable mailbox runtime. No provider activation.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path=public,pg_catalog;
lock table of_test_deploy.migrations in share row exclusive mode;
do $$begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy' or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target and checksum required';end if;
 if md5((jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('email_ingestion_account_guard_v2','email_ingestion_checkpoint_json_v2','email_ingestion_count_v2','email_ingestion_evidence_v2','email_ingestion_keys_v2','email_ingestion_payload_v2','email_ingestion_recovery_v2','email_ingestion_run_guard_v2','email_ingestion_transition_result_v2','email_ingestion_transition_v2','learn_operator_input_access','learn_operator_input_immutable','learn_slack_claim_jobs','platform_jobs_claim','platform_jobs_complete_email_v1','phone_retry_state','phone_pending_readiness','phone_select_pending','learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job','learn_email_transition_immutable','learn_email_transition_prepare','learn_email_transition_pending','learn_email_transition_apply','learn_email_job_attempt','learn_email_attempt_lease','learn_email_store_guard','learn_email_store_existing','learn_email_store_page','learn_email_job_fail','learn_email_enqueue')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.policyname),'[]') from pg_policies x where x.schemaname='public' and x.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('tenants','profiles','feature_flags','platform_jobs','slack_workspace_pacing','email_accounts','email_sync_runs','email_threads','email_messages','email_ingestion_checkpoints','email_ingestion_transitions','email_oauth_tokens','google_workspace_connections','google_workspace_mailboxes','phone_recordings','phone_transcripts','phone_ai_insights','phone_sync_runs','learn_capture_control_requests','learn_email_transition_requests','learn_email_transition_settlements','learn_email_job_attempts') and c.relkind='r'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state'),
 'ledger',(select jsonb_agg(jsonb_build_object('migration_name',migration_name,'source_sha256',source_sha256,'project_ref',project_ref) order by migration_name) from of_test_deploy.migrations)
))::text) <> 'd795a3420ec0f7a44b66238311b58e5a' then raise exception 'Exact email runtime prerequisites required';end if;
end $$;
create temporary table serviceos_email_preserved_before on commit drop as select 'public.email_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_messages s union all select 'public.phone_calls' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_calls s union all select 'public.phone_recordings' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_recordings s union all select 'public.phone_transcripts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_transcripts s union all select 'public.slack_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_messages s union all select 'public.slack_message_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_message_versions s union all select 'public.interactions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.interactions s union all select 'public.people' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.people s union all select 'public.companies' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.companies s union all select 'public.customer_cards' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.customer_cards s union all select 'public.sites' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.sites s union all select 'public.jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.jobs s union all select 'public.provider_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connections s union all select 'public.tenant_connectors' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenant_connectors s union all select 'public.connector_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.connector_accounts s union all select 'public.platform_jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_jobs s union all select 'public.feature_flags' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.feature_flags s union all select 'public.learn_business_input_pages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_pages s union all select 'public.learn_business_input_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_versions s union all select 'public.learn_business_input_observations' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_observations s union all select 'public.provider_connection_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connection_events s union all select 'public.platform_authority_grants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_authority_grants s union all select 'public.learn_operator_input_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_operator_input_requests s union all select 'public.profiles' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.profiles s union all select 'public.authority_permissions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.authority_permissions s union all select 'public.learn_business_input_request_gates' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_gates s union all select 'public.learn_business_input_request_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_permits s union all select 'vault.secrets' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from vault.secrets s union all select 'public.tenants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenants s union all select 'public.view_as_context' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.view_as_context s union all select 'public.config_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.config_versions s union all select 'public.learn_commusoft_connection_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_connection_requests s union all select 'public.learn_commusoft_verification_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_requests s union all select 'public.learn_commusoft_verification_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_permits s union all select 'public.learn_commusoft_verification_results' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_results s union all select 'public.learn_business_input_links' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_links s union all select 'public.learn_business_input_projection_attempts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_attempts s union all select 'public.learn_business_input_projection_batches' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_batches s union all select 'public.contact_points' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.contact_points s union all select 'public.graph_nodes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_nodes s union all select 'public.graph_edges' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_edges s union all select 'public.graph_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_events s union all select 'public.email_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_accounts s union all select 'public.email_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_sync_runs s union all select 'public.email_threads' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_threads s union all select 'public.email_ingestion_checkpoints' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_checkpoints s union all select 'public.email_ingestion_transitions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_transitions s union all select 'public.google_workspace_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_connections s union all select 'public.google_workspace_mailboxes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_mailboxes s union all select 'public.phone_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_sync_runs s union all select 'public.phone_ai_insights' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_ai_insights s union all select 'public.slack_workspace_pacing' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_workspace_pacing s;
create or replace view phone_recording_pipeline_state
with (security_invoker = on) as
select
  r.id,
  r.tenant_id,
  r.provider,
  r.provider_recording_id,
  r.provider_call_id,
  r.recording_uri,
  r.storage_path,
  r.started_at,
  r.created_at,
  coalesce(r.started_at, r.created_at)               as sort_at,
  (r.provider_recording_id is not null)              as has_provider_id,
  (r.storage_path is not null)                       as has_download,
  (ct.recording_id is not null)                      as has_transcript,
  (ins.recording_id is not null)                     as has_insight,
  case
    when r.storage_path is null            then 'download'
    when ct.recording_id is null           then 'transcribe'
    when ins.recording_id is null          then 'analyse'
    else 'complete'
  end                                                as stage,
  (
    r.storage_path is null
    or ct.recording_id is null
    or ins.recording_id is null
  )                                                  as is_incomplete
from phone_recordings r
left join lateral (
  select t.recording_id
  from phone_transcripts t
  where t.recording_id = r.id
    and t.tenant_id = r.tenant_id
    and t.status = 'completed'
  limit 1
) ct on true
left join lateral (
  select i.recording_id
  from phone_ai_insights i
  where i.recording_id = r.id
    and i.tenant_id = r.tenant_id
  limit 1
) ins on true;
revoke all on public.phone_recording_pipeline_state from public,anon,authenticated,service_role;
grant select on public.phone_recording_pipeline_state to service_role;
-- Per-recording recovery, not per-batch retries. No records are deleted or
-- falsely completed. Held work remains in existing backlog/failure diagnostics.
create or replace function phone_retry_state(p_stage text, p_runs jsonb, p_now timestamptz)
returns text language plpgsql immutable as $$
declare
  latest jsonb := p_runs->0;
  item jsonb;
  failures int := 0;
  delay_seconds int;
begin
  if latest is null then return 'ready'; end if;
  if latest->>'status' = 'running' then
    if (latest->>'started_at')::timestamptz > p_now - interval '5 minutes' then
      return 'in_progress';
    end if;
    return 'ready';
  end if;
  if latest->>'status' <> 'failed' or latest->>'failed_step' is distinct from p_stage then
    return 'ready';
  end if;
  if latest->>'error_code' = any(array[
    'invalid_audio','audio_too_short','audio_too_large','openai_invalid_request',
    'openai_quota_exhausted','openai_auth_failed','unsupported_format',
    'provider_recording_missing','invalid_recording','malformed_provider_id',
    'cross_tenant_mismatch','config_error','empty_audio'
  ]) then return 'needs_review'; end if;
  for item in select value from jsonb_array_elements(p_runs) loop
    exit when item->>'status' <> 'failed' or item->>'failed_step' is distinct from p_stage;
    failures := failures + 1;
    exit when failures >= 5;
  end loop;
  if failures >= 5 then return 'needs_review'; end if;
  delay_seconds := case failures when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end;
  if (latest->>'started_at')::timestamptz > p_now - make_interval(secs => delay_seconds) then
    return 'cooldown';
  end if;
  return 'ready';
end;
$$;

create index if not exists phone_sync_runs_recording_retry_idx
on phone_sync_runs (tenant_id, (metadata->>'recording_id'), started_at desc)
where sync_type = 'pipeline';

create or replace function phone_pending_readiness(p_tenant_id uuid)
returns table(recording_id uuid, stage text, sort_at timestamptz, retry_state text)
language sql stable as $$
  select s.id, s.stage, s.sort_at,
    phone_retry_state(s.stage, coalesce(r.runs,'[]'::jsonb), now())
  from phone_recording_pipeline_state s
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'status', x.status, 'started_at', x.started_at,
      'failed_step', x.metadata->>'failed_step',
      'error_code', x.metadata->>'error_code'
    ) order by x.started_at desc) runs
    from (
      select status, started_at, metadata from phone_sync_runs
      where tenant_id = s.tenant_id and sync_type = 'pipeline'
        and metadata->>'recording_id' = s.id::text
      order by started_at desc limit 5
    ) x
  ) r on true
  where s.tenant_id = p_tenant_id and s.is_incomplete;
$$;

create or replace function phone_select_pending(
  p_tenant_id uuid, p_limit int default 5, p_min_download_age_seconds int default 120
)
returns setof phone_recording_pipeline_state language sql stable as $$
  with eligible as (
    select s.*, s.sort_at >= now()-interval '24 hours' as recent
    from phone_recording_pipeline_state s
    join phone_pending_readiness(p_tenant_id) r on r.recording_id = s.id
    where s.tenant_id = p_tenant_id and r.retry_state = 'ready'
      and (s.stage <> 'download' or
        (s.has_provider_id and s.sort_at <= now()-make_interval(secs => greatest(0,p_min_download_age_seconds))))
  ), ranked as (
    select id, recent, sort_at,
      row_number() over(partition by recent order by sort_at, id) lane_position
    from eligible
  )
  select s.* from phone_recording_pipeline_state s join ranked r on r.id=s.id
  where s.tenant_id = p_tenant_id
  order by case
    when r.recent and r.lane_position <= greatest(1,least(50,p_limit)-1) then 0
    when not r.recent and r.lane_position = 1 then 1
    else 2 end, r.sort_at, r.id
  limit greatest(1,least(50,p_limit));
$$;

revoke all on function phone_retry_state(text,jsonb,timestamptz) from public;
revoke all on function phone_pending_readiness(uuid) from public;
revoke all on function phone_select_pending(uuid,int,int) from public;
grant execute on function phone_retry_state(text,jsonb,timestamptz) to service_role;
grant execute on function phone_pending_readiness(uuid) to service_role;
grant execute on function phone_select_pending(uuid,int,int) to service_role;

revoke all on function public.phone_retry_state(text,jsonb,timestamptz),public.phone_pending_readiness(uuid),public.phone_select_pending(uuid,integer,integer) from anon,authenticated;
create table public.learn_capture_control_requests (
 id uuid primary key,tenant_id uuid not null references public.tenants(id),
 actor_id uuid not null references public.profiles(id),definition jsonb not null,
 receipt jsonb not null,previous_state jsonb,created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_capture_control_requests enable row level security;
revoke all on public.learn_capture_control_requests from public,anon,authenticated,service_role;
create trigger learn_capture_control_immutable before update or delete on public.learn_capture_control_requests
 for each row execute function public.learn_operator_input_immutable();

create function public.learn_capture_allowed(p_tenant uuid,p_source text) returns boolean
language plpgsql volatile security definer set search_path=pg_catalog as $$
begin
 if p_tenant is null or p_source is null or p_source not in ('email','phone','slack') then
  raise exception 'learn_capture_source_invalid' using errcode='22023';end if;
 return exists(select 1 from public.tenants where id=p_tenant and status='active')
  and not exists(select 1 from public.feature_flags where tenant_id=p_tenant
   and flag in ('learn.enabled','learn.inputs.'||p_source||'.enabled')
   and (jsonb_typeof(value) is distinct from 'boolean' or value is distinct from 'true'::jsonb));
end $$;

-- Operator data contains only normalized booleans and an opaque revision. A corrupt
-- flag blocks admission, but its raw value is never returned as diagnostic content.
create function public.learn_capture_control_state(p_tenant uuid) returns jsonb
language sql volatile security definer set search_path=pg_catalog as $$
 with names(flag) as (values('learn.enabled'),('learn.inputs.email.enabled'),('learn.inputs.phone.enabled'),('learn.inputs.slack.enabled')),
 raw as (select n.flag,f.value,f.tenant_id is not null as present from names n left join public.feature_flags f on f.tenant_id=p_tenant and f.flag=n.flag)
 select jsonb_build_object('version','learn-capture-controls/1','tenant_id',p_tenant,
  'revision',md5((select jsonb_agg(jsonb_build_object('flag',flag,'value',value,'present',present) order by flag)::text from raw)),
  'flags',(select jsonb_object_agg(flag,case when jsonb_typeof(value)='boolean' then value else 'null'::jsonb end) from raw),
  'sources',(select jsonb_object_agg(s,jsonb_build_object('allowed',public.learn_capture_allowed(p_tenant,s),
   'inherited',not exists(select 1 from public.feature_flags where tenant_id=p_tenant and flag='learn.inputs.'||s||'.enabled'),
   'invalid',exists(select 1 from public.feature_flags where tenant_id=p_tenant and flag in ('learn.enabled','learn.inputs.'||s||'.enabled') and jsonb_typeof(value) is distinct from 'boolean')))
   from unnest(array['email','phone','slack'])s));
$$;
create function public.learn_operator_capture_controls(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 return public.learn_capture_control_state(p_tenant);
end $$;
create function public.learn_operator_capture_control_request(p_tenant uuid,p_request uuid,p_actor uuid,p_definition jsonb,p_mode text default 'apply') returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare prior public.learn_capture_control_requests%rowtype;previous jsonb;answer jsonb;k text;begin
 perform public.learn_operator_input_access(p_tenant,p_actor,true);
 if p_request is null or p_mode is null or p_mode not in ('apply','check','cancel') or jsonb_typeof(p_definition) is distinct from 'object'
  or octet_length(p_definition::text)>4000 then raise exception 'learn_capture_request_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-capture-request:'||p_request::text,0));
 select * into prior from public.learn_capture_control_requests where id=p_request;
 if found then
  if prior.tenant_id<>p_tenant or prior.actor_id<>p_actor or prior.definition<>p_definition then
   raise exception 'learn_capture_request_conflict' using errcode='PT409';end if;
  return prior.receipt;
 end if;
 if p_mode='check' then return jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','pending');end if;
 if p_mode='cancel' then answer:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','cancelled');
 else
  if not p_definition ?& array['reason','revision','values'] or (p_definition-array['reason','revision','values'])<>'{}'::jsonb
   or jsonb_typeof(p_definition->'reason') is distinct from 'string' or length(btrim(p_definition->>'reason')) not between 1 and 1000
   or jsonb_typeof(p_definition->'revision') is distinct from 'string' or p_definition->>'revision'!~'^[a-f0-9]{32}$'
   or jsonb_typeof(p_definition->'values') is distinct from 'object' or (select count(*) from jsonb_object_keys(p_definition->'values'))<>4 then
   raise exception 'learn_capture_definition_invalid' using errcode='22023';end if;
  foreach k in array array['learn.enabled','learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled'] loop
   if jsonb_typeof(p_definition->'values'->k) is distinct from 'boolean' then raise exception 'learn_capture_flags_invalid' using errcode='22023';end if;
  end loop;
  -- Same lock as existing Commusoft/master controls; concurrent operator edits cannot
  -- silently overwrite each other's master switch or admit a batch mid-update.
  perform pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||p_tenant::text,0));
  previous:=public.learn_capture_control_state(p_tenant);
  if previous->>'revision' is distinct from p_definition->>'revision' then raise exception 'learn_capture_flags_changed' using errcode='PT409';end if;
  foreach k in array array['learn.enabled','learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled'] loop
   update public.feature_flags set value=p_definition->'values'->k where tenant_id=p_tenant and flag=k;
   if not found then insert into public.feature_flags(tenant_id,flag,value) values(p_tenant,k,p_definition->'values'->k);end if;
  end loop;
  answer:=jsonb_build_object('tenant_id',p_tenant,'request_id',p_request,'state','recorded','controls',public.learn_capture_control_state(p_tenant));
 end if;
 insert into public.learn_capture_control_requests(id,tenant_id,actor_id,definition,receipt,previous_state)
  values(p_request,p_tenant,p_actor,p_definition,answer,previous);
 return answer;
end $$;

-- Called once at a server capture boundary before opening a run or obtaining a
-- provider credential. The short admission transaction does not hold an HTTP lock.
create function public.learn_capture_admission(p_tenant uuid,p_source text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare allowed boolean;begin
 if current_user<>'service_role' then raise exception 'learn_capture_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_capture_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 allowed:=public.learn_capture_allowed(p_tenant,p_source);
 return jsonb_build_object('version','learn-capture-admission/1','tenant_id',p_tenant,'source',p_source,'allowed',allowed,'checked_at',clock_timestamp());
end $$;
create function public.learn_capture_job_allowed(p_tenant uuid,p_type text,p_metadata jsonb) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select case
  when p_type in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill','email.mailbox_discovery') then public.learn_capture_allowed(p_tenant,'email')
  when p_type in ('slack.history_sync','slack.thread_sync') then coalesce(p_metadata ? 'slack_page_v1',false) or public.learn_capture_allowed(p_tenant,'slack')
  else true end;
$$;
-- Filter before claiming: deliberate pauses never burn an attempt. Retain existing
-- dedicated-worker exclusions and every other part of the installed claim functions.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='and (p_job_types is null or c.job_type = any(p_job_types))';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_queue_shape_changed';end if;
 execute replace(d,needle,needle||E'\n      and public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata)');
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='and q.status in (''queued'',''retrying'',''running'') and coalesce(q.available_at,''-infinity'')<=clock_timestamp()';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_slack_shape_changed';end if;
 execute replace(d,needle,needle||E'\n  and public.learn_capture_job_allowed(q.tenant_id,q.job_type,q.metadata)');
 -- Recheck a selected row under its lock, before exhaustion/pacing accounting.
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='if not found then continue;end if;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_slack_lock_shape_changed';end if;
 execute replace(d,needle,needle||E'\n  if not public.learn_capture_job_allowed(j.tenant_id,j.job_type,j.metadata) then continue;end if;');
 -- Apply the pause before the bounded phone selection, so waiting downloads do
 -- not starve transcription/analysis of audio already retained in this company.
 d:=pg_get_functiondef('public.phone_select_pending(uuid,integer,integer)'::regprocedure);
 needle:='where s.tenant_id = p_tenant_id and r.retry_state = ''ready''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_capture_phone_selector_shape_changed';end if;
 execute replace(d,needle,needle||E'\n      and (s.stage <> ''download'' or public.learn_capture_allowed(p_tenant_id,''phone''))');
end $$;

-- A pause observed after claim returns this exact lease to the queue without
-- burning a retry. This is only for work stopped before provider admission.
create function public.learn_capture_defer_job(p_tenant uuid,p_job uuid,p_claimed_by text,p_attempt integer,p_reason text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;prior jsonb;answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_capture_forbidden' using errcode='42501';end if;
 if p_reason is null or p_reason not in ('paused','unavailable') or p_attempt is null or p_attempt<1 or nullif(p_claimed_by,'') is null then
  raise exception 'learn_capture_defer_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job and tenant_id=p_tenant for update;
 if not found or j.job_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill','email.mailbox_discovery','slack.history_sync','slack.thread_sync') then
  raise exception 'learn_capture_defer_not_owned' using errcode='PT409';end if;
 prior:=j.metadata->'learn_capture_deferred_v1';
 if prior->>'claimed_by'=p_claimed_by and prior->>'attempt'=p_attempt::text then
  if prior->>'reason' is distinct from p_reason then raise exception 'learn_capture_defer_conflict' using errcode='PT409';end if;
  return prior->'answer';
 end if;
 if j.status<>'running' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or coalesce(j.metadata,'{}') ? 'slack_page_v1' then
  raise exception 'learn_capture_defer_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',p_job,'state','waiting','reason',p_reason,'attempt_count',p_attempt-1);
 update public.platform_jobs set status='queued',claimed_by=null,claimed_at=null,lease_expires_at=null,
  attempt_count=p_attempt-1,available_at=clock_timestamp()+interval '60 seconds',
  metadata=coalesce(metadata,'{}')||jsonb_build_object('learn_capture_deferred_v1',jsonb_build_object('claimed_by',p_claimed_by,'attempt',p_attempt,'reason',p_reason,'answer',answer)) where id=j.id;
 if j.job_type in ('slack.history_sync','slack.thread_sync') then
  update public.slack_workspace_pacing set active_job_id=null,last_finished_at=clock_timestamp(),
   next_allowed_at=greatest(blocked_until,clock_timestamp()+interval '60 seconds') where active_job_id=j.id;
 end if;
 return answer;
end $$;

do $$declare name text;signature text;begin
 foreach name in array array['learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job'] loop
  for signature in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name loop
   execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
 end loop;
end $$;
grant execute on function public.learn_operator_capture_controls(uuid),public.learn_operator_capture_control_request(uuid,uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.learn_capture_allowed(uuid,text),public.learn_capture_admission(uuid,text),public.learn_capture_job_allowed(uuid,text,jsonb),public.learn_capture_defer_job(uuid,uuid,text,integer,text) to service_role;
create table public.learn_email_transition_requests (
 id uuid primary key,tenant_id uuid not null,email_account_id uuid not null,
 stream text not null check(stream in ('recent','historical')),attempt_id uuid not null,
 document jsonb not null check(jsonb_typeof(document)='object'),
 check(document @> jsonb_build_object('transitionId',id,'tenantId',tenant_id,'accountId',email_account_id,'stream',stream,'attemptId',attempt_id)),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,attempt_id) references public.email_sync_runs(tenant_id,id) on delete restrict
);
create index learn_email_transition_attempt on public.learn_email_transition_requests(tenant_id,email_account_id,stream,attempt_id,created_at,id);
create table public.learn_email_transition_settlements (
 request_id uuid primary key references public.learn_email_transition_requests(id) on delete restrict,
 result jsonb not null check(jsonb_typeof(result)='object'),
 check(result @> jsonb_build_object('contract_version',2,'transition_id',request_id)),
 check((result->>'disposition'=any(array['applied','replayed','conflict','denied'])) is true),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learn_email_transition_requests enable row level security;
alter table public.learn_email_transition_settlements enable row level security;
revoke all on public.learn_email_transition_requests,public.learn_email_transition_settlements from public,anon,authenticated,service_role;
grant select,insert on public.learn_email_transition_requests,public.learn_email_transition_settlements to service_role;
create function public.learn_email_transition_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 raise exception 'learn_email_transition_immutable' using errcode='42501';end $$;
revoke all on function public.learn_email_transition_immutable() from public,anon,authenticated,service_role;
create trigger learn_email_request_immutable before update or delete on public.learn_email_transition_requests
 for each row execute function public.learn_email_transition_immutable();
create trigger learn_email_settlement_immutable before update or delete on public.learn_email_transition_settlements
 for each row execute function public.learn_email_transition_immutable();

create function public.learn_email_transition_prepare(p_document jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;account uuid;attempt uuid;request uuid;stream text;prior public.learn_email_transition_requests%rowtype;run public.email_sync_runs%rowtype; k text;
begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>65536
  or not p_document ?& array['tenantId','accountId','attemptId','stream','transitionId','operation','expectedGeneration','expectedRevision','expectedOwner','payload']
  or (p_document-array['tenantId','accountId','attemptId','stream','transitionId','operation','expectedGeneration','expectedRevision','expectedOwner','payload'])<>'{}'::jsonb then
  raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 foreach k in array array['tenantId','accountId','attemptId','transitionId'] loop
  if jsonb_typeof(p_document->k) is distinct from 'string' or not coalesce(p_document->>k~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end loop;
 foreach k in array array['expectedGeneration','expectedOwner'] loop
  if p_document->k<>'null'::jsonb and (jsonb_typeof(p_document->k) is distinct from 'string' or not coalesce(p_document->>k~'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end loop;
 if p_document->'expectedRevision'<>'null'::jsonb then
  if jsonb_typeof(p_document->'expectedRevision') is distinct from 'string' or not coalesce(p_document->>'expectedRevision'~'^(0|[1-9][0-9]{0,18})$',false) then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
  if (p_document->>'expectedRevision')::numeric>9223372036854775807 then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 end if;
 if (p_document->'expectedGeneration'='null'::jsonb) is distinct from (p_document->'expectedRevision'='null'::jsonb)
  or (p_document->'expectedGeneration'='null'::jsonb and p_document->'expectedOwner'<>'null'::jsonb)
  or jsonb_typeof(p_document->'payload') is distinct from 'object'
  or not coalesce(p_document->>'stream'=any(array['recent','historical']),false)
  or not coalesce(p_document->>'operation'=any(array['claim','initialize_traversal','checkpoint','release','block','finish_attempt','takeover','restart']),false) then
   raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 tenant:=(p_document->>'tenantId')::uuid;account:=(p_document->>'accountId')::uuid;
 attempt:=(p_document->>'attemptId')::uuid;request:=(p_document->>'transitionId')::uuid;stream:=p_document->>'stream';
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||attempt::text,0));
 select * into prior from public.learn_email_transition_requests where id=request;
 if found then
  if prior.document<>p_document then raise exception 'learn_email_outbox_request_changed' using errcode='PT409';end if;
  return prior.document;
 end if;
 select * into run from public.email_sync_runs where tenant_id=tenant and id=attempt;
 if not found or run.provider<>'gmail' or run.status<>'running' or jsonb_typeof(run.metadata->'email_account_id') is distinct from 'string'
  or not coalesce(run.metadata->>'email_account_id'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false) then
  raise exception 'learn_email_outbox_attempt_mismatch' using errcode='42501';end if;
 if (run.metadata->>'email_account_id')::uuid<>account
  or (stream='recent' and run.sync_type not in ('messages','workspace_messages')) or (stream='historical' and run.sync_type<>'workspace_backfill') then
  raise exception 'learn_email_outbox_attempt_mismatch' using errcode='42501';end if;
 if exists(select 1 from public.learn_email_transition_requests r where r.attempt_id=attempt and not exists(select 1 from public.learn_email_transition_settlements s where s.request_id=r.id)) then
  raise exception 'learn_email_outbox_pending_request' using errcode='PT409';end if;
 insert into public.learn_email_transition_requests(id,tenant_id,email_account_id,stream,attempt_id,document) values(request,tenant,account,stream,attempt,p_document);
 return p_document;
end $$;

create function public.learn_email_transition_pending(p_tenant uuid,p_account uuid,p_stream text,p_attempt uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_attempt is null or p_stream is null or p_stream not in ('recent','historical') then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||p_attempt::text,0));
 select r.document into answer from public.learn_email_transition_requests r
 where r.tenant_id=p_tenant and r.email_account_id=p_account and r.stream=p_stream and r.attempt_id=p_attempt
 and not exists(select 1 from public.learn_email_transition_settlements s where s.request_id=r.id) order by r.created_at,r.id limit 1;
 return answer;
end $$;

create function public.learn_email_transition_apply(p_tenant uuid,p_account uuid,p_stream text,p_attempt uuid,p_request uuid) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare r public.learn_email_transition_requests%rowtype; prior jsonb;answer jsonb;d jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_outbox_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_attempt is null or p_request is null or p_stream is null or p_stream not in ('recent','historical') then raise exception 'learn_email_outbox_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||p_attempt::text,0));
 select * into r from public.learn_email_transition_requests where id=p_request and tenant_id=p_tenant and email_account_id=p_account and stream=p_stream and attempt_id=p_attempt;
 if not found then raise exception 'learn_email_outbox_request_missing' using errcode='42501';end if;
 select result into prior from public.learn_email_transition_settlements where request_id=r.id;
 -- A refused request has a final decision. It cannot apply later simply because
 -- account eligibility or checkpoint state changes; a new reviewed request is needed.
 if found and prior->>'disposition' in ('conflict','denied') then return prior;end if;
 d:=r.document;
 answer:=public.email_ingestion_transition_v2(r.tenant_id,r.email_account_id,r.stream,r.attempt_id,r.id,
  d->>'operation',(d->>'expectedGeneration')::uuid,(d->>'expectedRevision')::bigint,(d->>'expectedOwner')::uuid,d->'payload');
 if prior is null then
  insert into public.learn_email_transition_settlements(request_id,result) values(r.id,answer);
 end if;
 -- Replaying the protocol reads today's checkpoint alongside its historical
 -- receipt. Never return a cached successful response as current ownership.
 return answer;
end $$;
revoke all on function public.learn_email_transition_prepare(jsonb),public.learn_email_transition_pending(uuid,uuid,text,uuid),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_transition_prepare(jsonb),public.learn_email_transition_pending(uuid,uuid,text,uuid),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid) to service_role;
create table public.learn_email_job_attempts (
 job_id uuid primary key references public.platform_jobs(id) on delete restrict,
 tenant_id uuid not null,email_account_id uuid not null,attempt_id uuid not null unique,
 stream text not null check(stream in ('recent','historical')),
 sync_type text not null check(sync_type in ('messages','workspace_messages','workspace_backfill')),
 definition jsonb not null check(jsonb_typeof(definition)='object'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,email_account_id) references public.email_accounts(tenant_id,id) on delete restrict,
 foreign key(tenant_id,attempt_id) references public.email_sync_runs(tenant_id,id) on delete restrict
);
alter table public.learn_email_job_attempts enable row level security;
revoke all on public.learn_email_job_attempts from public,anon,authenticated,service_role;
grant select,insert on public.learn_email_job_attempts to service_role;
create trigger learn_email_job_attempt_immutable before update or delete on public.learn_email_job_attempts
 for each row execute function public.learn_email_transition_immutable();

create function public.learn_email_job_attempt(p_tenant uuid,p_job uuid,p_claimed_by text,p_claim integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;run public.email_sync_runs%rowtype;
 account uuid;kind text;stream_name text;definition jsonb;recovered boolean;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or nullif(p_claimed_by,'') is null or p_claim is null or p_claim<1 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found or j.status<>'running' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 if j.job_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill')
  or jsonb_typeof(j.payload) is distinct from 'object' or octet_length(j.payload::text)>4000
  or jsonb_typeof(j.payload->'email_account_id') is distinct from 'string'
  or not coalesce(j.payload->>'email_account_id'~*'^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$',false)
  or (j.payload-array['email_account_id','max_results','force','restart'])<>'{}'::jsonb then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 if j.payload ? 'max_results' then
  if jsonb_typeof(j.payload->'max_results') is distinct from 'number' or not coalesce(j.payload->>'max_results'~'^[0-9]{1,3}$',false) then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
  if (j.payload->>'max_results')::integer not between 1 and 500 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 end if;
 if (j.payload ? 'force' and jsonb_typeof(j.payload->'force') is distinct from 'boolean')
  or (j.payload ? 'restart' and jsonb_typeof(j.payload->'restart') is distinct from 'boolean') then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 account:=(j.payload->>'email_account_id')::uuid;
 if j.job_key is distinct from j.job_type||':'||(j.payload->>'email_account_id') then raise exception 'learn_email_job_identity' using errcode='22023';end if;
 perform 1 from public.email_accounts where id=account and tenant_id=p_tenant and provider='gmail';
 if not found then raise exception 'learn_email_job_identity' using errcode='42501';end if;
 kind:=case j.job_type when 'email.gmail_sync' then 'messages' when 'email.workspace_sync' then 'workspace_messages' else 'workspace_backfill' end;
 stream_name:=case when j.job_type='email.workspace_backfill' then 'historical' else 'recent' end;
 definition:=jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id);
 select * into b from public.learn_email_job_attempts where job_id=j.id;
 recovered:=found;
 if recovered then
  if b.tenant_id<>p_tenant or b.email_account_id<>account or b.stream<>stream_name or b.sync_type<>kind or b.definition<>definition then raise exception 'learn_email_job_definition_changed' using errcode='PT409';end if;
 else
  b.attempt_id:=gen_random_uuid();
  insert into public.email_sync_runs(id,tenant_id,provider,sync_type,status,metadata)
   values(b.attempt_id,p_tenant,'gmail',kind,'running',jsonb_build_object('email_account_id',account,'learn_email_job_id',j.id));
  insert into public.learn_email_job_attempts(job_id,tenant_id,email_account_id,attempt_id,stream,sync_type,definition)
   values(j.id,p_tenant,account,b.attempt_id,stream_name,kind,definition);
 end if;
 select * into run from public.email_sync_runs where id=b.attempt_id and tenant_id=p_tenant;
 if not found or run.provider<>'gmail' or run.sync_type<>kind or run.status not in ('running','success','failed')
  or (run.metadata->>'email_account_id')::uuid is distinct from account then raise exception 'learn_email_job_attempt_mismatch' using errcode='PT409';end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return jsonb_build_object('version','learn-email-job-attempt/1','tenant_id',p_tenant,'job_id',j.id,'email_account_id',account,
  'attempt_id',b.attempt_id,'stream',stream_name,'sync_type',kind,'status',run.status,'records_processed',run.records_processed,
  'recovered',recovered,'claimed_by',p_claimed_by,'claim',p_claim,'lease_expires_at',j.lease_expires_at,'payload',j.payload);
end $$;

-- Job lock precedes the outbox attempt lock and the protocol's account/run locks.
-- Standalone attempts retain their original server-only behavior.
create function public.learn_email_attempt_lease(p_attempt uuid,p_claimed_by text,p_claim integer) returns void
language plpgsql security invoker set search_path=pg_catalog as $$declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 select * into b from public.learn_email_job_attempts where attempt_id=p_attempt;
 if not found then
  if p_claimed_by is not null or p_claim is not null then raise exception 'learn_email_job_binding_missing' using errcode='PT409';end if;
  return;
 end if;
 select * into j from public.platform_jobs where id=b.job_id and tenant_id=b.tenant_id for update;
 if not found or j.status<>'running' or nullif(p_claimed_by,'') is null or p_claim is null
  or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_claim
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp()
  or b.definition is distinct from jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id)
 then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
end $$;

-- Add lease arguments to the two outbox mutation APIs. Remove the old signatures
-- so job-bound callers cannot accidentally use an entrypoint without lease checks.
do $$declare d text;needle text;signature text;begin
 d:=pg_get_functiondef('public.learn_email_transition_prepare(jsonb)'::regprocedure);
 needle:='p_document jsonb)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_shape_changed';end if;
 d:=replace(d,needle,'p_document jsonb, p_claimed_by text DEFAULT NULL, p_claim integer DEFAULT NULL)');
 needle:='perform pg_advisory_xact_lock(hashtextextended(''learn-email-attempt:''||attempt::text,0));';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_lock_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 needle:='return p_document;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_prepare_return_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 drop function public.learn_email_transition_prepare(jsonb);
 execute d;
 d:=pg_get_functiondef('public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid)'::regprocedure);
 needle:='p_request uuid)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_shape_changed';end if;
 d:=replace(d,needle,'p_request uuid, p_claimed_by text DEFAULT NULL, p_claim integer DEFAULT NULL)');
 needle:='perform pg_advisory_xact_lock(hashtextextended(''learn-email-attempt:''||p_attempt::text,0));';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_lock_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 -- A long-running transition that outlives its lease must roll back, not settle.
 needle:='return answer;';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_apply_return_changed';end if;
 d:=replace(d,needle,'perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);'||E'\n '||needle);
 drop function public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid);
 execute d;
end $$;
revoke all on function public.learn_email_job_attempt(uuid,uuid,text,integer),public.learn_email_attempt_lease(uuid,text,integer),public.learn_email_transition_prepare(jsonb,text,integer),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_job_attempt(uuid,uuid,text,integer),public.learn_email_attempt_lease(uuid,text,integer),public.learn_email_transition_prepare(jsonb,text,integer),public.learn_email_transition_apply(uuid,uuid,text,uuid,uuid,text,integer) to service_role;
create function public.learn_email_store_guard(p_context jsonb,p_claimed_by text,p_claim integer) returns void
language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.email_accounts%rowtype;r public.email_sync_runs%rowtype;c public.email_ingestion_checkpoints%rowtype;
 v_tenant uuid;v_account uuid;v_attempt uuid;v_generation uuid;v_revision bigint;v_stream text;
begin
 if current_user<>'service_role' then raise exception 'learn_email_store_forbidden' using errcode='42501';end if;
 if jsonb_typeof(p_context) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_context))<>8
  or not (p_context ?& array['tenant_id','email_account_id','attempt_id','stream','generation','revision','mailbox','fetch_policy'])
  or exists(select 1 from jsonb_each(p_context) e where jsonb_typeof(e.value)<>'string')
  or not coalesce(p_context->>'revision'~'^(0|[1-9][0-9]{0,18})$',false)
  or p_context->>'stream' not in ('recent','historical') or p_context->>'fetch_policy' not in ('missing_only','refetch_all')
  or nullif(btrim(p_context->>'mailbox'),'') is null
 then raise exception 'learn_email_store_context_invalid' using errcode='22023';end if;
 v_tenant:=(p_context->>'tenant_id')::uuid;v_account:=(p_context->>'email_account_id')::uuid;
 v_attempt:=(p_context->>'attempt_id')::uuid;v_generation:=(p_context->>'generation')::uuid;v_revision:=(p_context->>'revision')::bigint;v_stream:=p_context->>'stream';
 perform public.learn_email_attempt_lease(v_attempt,p_claimed_by,p_claim);
 perform pg_advisory_xact_lock(hashtextextended('learn-email-attempt:'||v_attempt::text,0));
 select * into a from public.email_accounts where id=v_account and tenant_id=v_tenant and provider='gmail' for update;
 if not found or lower(a.email_address) is distinct from lower(p_context->>'mailbox') then raise exception 'learn_email_store_account_mismatch' using errcode='PT409';end if;
 -- The account row serializes this read with all protocol transitions. The
 -- service role retains SELECT-only checkpoint access; no new progress privilege.
 select * into c from public.email_ingestion_checkpoints where tenant_id=v_tenant and email_account_id=v_account and email_ingestion_checkpoints.stream=v_stream;
 if not found or c.contract_version<>2 or c.state<>'claimed' or c.owner_attempt_id is distinct from v_attempt
  or c.generation is distinct from v_generation or c.revision is distinct from v_revision then raise exception 'learn_email_store_checkpoint_changed' using errcode='PT409';end if;
 select * into r from public.email_sync_runs where id=v_attempt and tenant_id=v_tenant for update;
 if not found or r.provider<>'gmail' or r.status<>'running' or (r.metadata->>'email_account_id')::uuid is distinct from v_account
  or (v_stream='historical' and r.sync_type<>'workspace_backfill') or (v_stream='recent' and r.sync_type not in ('messages','workspace_messages'))
 then raise exception 'learn_email_store_attempt_invalid' using errcode='PT409';end if;
 if not coalesce(case when r.sync_type='messages' then a.status='active' and a.auth_state in ('ok','unknown') else a.status in ('pending_tokenless_dwd','active_dwd') end,false)
 then raise exception 'learn_email_store_ineligible' using errcode='PT409';end if;
 if (v_stream='recent' and (c.continuation->>'phase' is distinct from 'initialized' or c.continuation->>'fetch_policy' is distinct from p_context->>'fetch_policy'))
  or (v_stream='historical' and p_context->>'fetch_policy'<>'missing_only') then raise exception 'learn_email_store_policy_changed' using errcode='PT409';end if;
end $$;

create function public.learn_email_store_existing(p_context jsonb,p_ids jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$declare result jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids)>2000
  or exists(select 1 from jsonb_array_elements(p_ids)e where jsonb_typeof(e)<>'string' or (not (e#>>'{}')~'^[a-zA-Z0-9_-]+$' or length(e#>>'{}')>256))
 then raise exception 'learn_email_store_ids_invalid' using errcode='22023';end if;
 select coalesce(jsonb_agg(provider_message_id order by provider_message_id),'[]') into result from public.email_messages
  where tenant_id=(p_context->>'tenant_id')::uuid and provider='gmail' and provider_message_id in (select jsonb_array_elements_text(p_ids));
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'existing_ids',result);
end $$;

create function public.learn_email_store_page(p_context jsonb,p_threads jsonb,p_messages jsonb,p_claimed_by text default null,p_claim integer default null) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare tenant uuid;thread_count integer;message_count integer;v jsonb;begin
 perform public.learn_email_store_guard(p_context,p_claimed_by,p_claim);
 tenant:=(p_context->>'tenant_id')::uuid;
 if jsonb_typeof(p_threads) is distinct from 'array' or jsonb_typeof(p_messages) is distinct from 'array'
  or jsonb_array_length(p_threads)>2000 or jsonb_array_length(p_messages)>2000
  or octet_length(p_threads::text)+octet_length(p_messages::text)>67108864
 then raise exception 'learn_email_store_rows_invalid' using errcode='22023';end if;
 for v in select value from jsonb_array_elements(p_threads) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>7
   or not(v ?& array['tenant_id','provider','provider_thread_id','subject','participants','last_message_at','updated_at'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'participants') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements(v->'participants')e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'subject') not in ('string','null') or jsonb_typeof(v->'last_message_at') is distinct from 'string'
  then raise exception 'learn_email_store_thread_invalid' using errcode='22023';end if;
 end loop;
 for v in select value from jsonb_array_elements(p_messages) loop
  if jsonb_typeof(v) is distinct from 'object' or (select count(*) from jsonb_object_keys(v))<>16
   or not(v ?& array['tenant_id','provider','provider_message_id','provider_thread_id','from_email','from_name','to_emails','cc_emails','subject','snippet','body_text','body_html','sent_at','received_at','direction','raw_payload'])
   or v->>'tenant_id' is distinct from tenant::text or v->>'provider' is distinct from 'gmail'
   or (not coalesce(v->>'provider_message_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_message_id')>256)
   or (not coalesce(v->>'provider_thread_id'~'^[a-zA-Z0-9_-]+$',false) or length(v->>'provider_thread_id')>256)
   or jsonb_typeof(v->'to_emails') is distinct from 'array' or jsonb_typeof(v->'cc_emails') is distinct from 'array'
   or exists(select 1 from jsonb_array_elements((v->'to_emails')||(v->'cc_emails'))e where jsonb_typeof(e)<>'string')
   or jsonb_typeof(v->'raw_payload') is distinct from 'object' or jsonb_typeof(v->'direction') is distinct from 'string' or v->>'direction' not in ('inbound','outbound')
   or exists(select 1 from jsonb_each(v)e where e.key=any(array['from_email','from_name','subject','snippet','body_text','body_html','sent_at','received_at']) and jsonb_typeof(e.value) not in ('string','null'))
  then raise exception 'learn_email_store_message_invalid' using errcode='22023';end if;
 end loop;
 -- Each thread summary must come from a message in this page and vice versa.
 if exists(select 1 from jsonb_array_elements(p_messages)m where not exists(select 1 from jsonb_array_elements(p_threads)t where t->>'provider_thread_id'=m->>'provider_thread_id'))
  or exists(select 1 from jsonb_array_elements(p_threads)t where not exists(select 1 from jsonb_array_elements(p_messages)m where m->>'provider_thread_id'=t->>'provider_thread_id'))
  or (select count(distinct elem->>'provider_thread_id') from jsonb_array_elements(p_threads)elem)<>jsonb_array_length(p_threads)
  or (select count(distinct elem->>'provider_message_id') from jsonb_array_elements(p_messages)elem)<>jsonb_array_length(p_messages)
 then raise exception 'learn_email_store_page_mismatch' using errcode='22023';end if;
 insert into public.email_threads as retained(tenant_id,provider,provider_thread_id,subject,participants,last_message_at)
 select tenant,'gmail',x.provider_thread_id,x.subject,x.participants,x.last_message_at
 from jsonb_populate_recordset(null::public.email_threads,p_threads)x order by x.provider_thread_id
 on conflict(tenant_id,provider,provider_thread_id) do update set
  subject=case when retained.last_message_at is null or excluded.last_message_at>retained.last_message_at then coalesce(excluded.subject,retained.subject) else retained.subject end,
  last_message_at=greatest(retained.last_message_at,excluded.last_message_at),
  participants=(select coalesce(jsonb_agg(distinct e order by e),'[]') from jsonb_array_elements(retained.participants||excluded.participants)e);
 get diagnostics thread_count=row_count;
 insert into public.email_messages as retained(tenant_id,provider,provider_message_id,provider_thread_id,from_email,from_name,to_emails,cc_emails,subject,snippet,body_text,body_html,sent_at,received_at,direction,raw_payload)
 select tenant,'gmail',x.provider_message_id,x.provider_thread_id,x.from_email,x.from_name,x.to_emails,x.cc_emails,x.subject,x.snippet,x.body_text,x.body_html,x.sent_at,x.received_at,x.direction,x.raw_payload
 from jsonb_populate_recordset(null::public.email_messages,p_messages)x order by x.provider_message_id
 on conflict(tenant_id,provider,provider_message_id) do update set
  provider_thread_id=excluded.provider_thread_id,from_email=coalesce(excluded.from_email,retained.from_email),from_name=coalesce(excluded.from_name,retained.from_name),
  to_emails=excluded.to_emails,cc_emails=excluded.cc_emails,subject=coalesce(excluded.subject,retained.subject),snippet=coalesce(excluded.snippet,retained.snippet),
  body_text=coalesce(excluded.body_text,retained.body_text),body_html=coalesce(excluded.body_html,retained.body_html),sent_at=coalesce(excluded.sent_at,retained.sent_at),received_at=coalesce(excluded.received_at,retained.received_at),direction=excluded.direction,raw_payload=retained.raw_payload||excluded.raw_payload
 where p_context->>'fetch_policy'='refetch_all'
  and case when retained.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
    then case when excluded.raw_payload->>'history_id'~'^(0|[1-9][0-9]{0,19})$'
      then (excluded.raw_payload->>'history_id')::numeric >= (retained.raw_payload->>'history_id')::numeric else false end
    else true end;
 get diagnostics message_count=row_count;
 perform public.learn_email_attempt_lease((p_context->>'attempt_id')::uuid,p_claimed_by,p_claim);
 return jsonb_build_object('version','learn-email-store/1','context',p_context,'message_upsert_count',message_count,'thread_upsert_count',thread_count);
end $$;
revoke all on function public.learn_email_store_guard(jsonb,text,integer),public.learn_email_store_existing(jsonb,jsonb,text,integer),public.learn_email_store_page(jsonb,jsonb,jsonb,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_store_guard(jsonb,text,integer),public.learn_email_store_existing(jsonb,jsonb,text,integer),public.learn_email_store_page(jsonb,jsonb,jsonb,text,integer) to service_role;
create function public.learn_email_job_fail(p_tenant uuid,p_job uuid,p_attempt uuid,p_claimed_by text,p_claim integer) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;b public.learn_email_job_attempts%rowtype;r public.email_sync_runs%rowtype;receipt jsonb;code text;answer jsonb;begin
 if current_user<>'service_role' then raise exception 'learn_email_job_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_job is null or p_attempt is null or nullif(p_claimed_by,'') is null or p_claim is null or p_claim<1 then raise exception 'learn_email_job_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where tenant_id=p_tenant and id=p_job for update;
 if not found then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'learn_email_failure_v1';
 if j.status='dead_letter' and j.claimed_by=p_claimed_by and j.attempt_count=p_claim
  and receipt->>'attempt_id'=p_attempt::text and receipt->>'claimed_by'=p_claimed_by and receipt->>'claim'=p_claim::text
  and receipt->>'version'='learn-email-job-failure/1' then return receipt->'answer'||jsonb_build_object('disposition','replayed');end if;
 select * into b from public.learn_email_job_attempts where job_id=p_job and tenant_id=p_tenant and attempt_id=p_attempt;
 if not found then raise exception 'learn_email_job_binding_missing' using errcode='PT409';end if;
 perform public.learn_email_attempt_lease(p_attempt,p_claimed_by,p_claim);
 select * into r from public.email_sync_runs where id=b.attempt_id and tenant_id=b.tenant_id for key share;
 if not found or r.provider<>'gmail' or r.sync_type<>b.sync_type or r.status<>'failed' or r.completed_at is null
  or (r.metadata->>'email_account_id')::uuid is distinct from b.email_account_id then raise exception 'learn_email_attempt_not_failed' using errcode='PT409';end if;
 code:=case when r.error_message=any(array['history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure']) then r.error_message else 'capture_failed' end;
 answer:=jsonb_build_object('version','learn-email-job-failure/1','disposition','applied','job_id',j.id,'attempt_id',r.id,'code',code);
 receipt:=jsonb_build_object('version','learn-email-job-failure/1','attempt_id',r.id,'claimed_by',p_claimed_by,'claim',p_claim,'answer',answer);
 update public.platform_jobs set status='dead_letter',completed_at=clock_timestamp(),lease_expires_at=null,error_code=code,
  result=jsonb_build_object('sync_run_id',r.id,'error_code',code),metadata=coalesce(metadata,'{}')||jsonb_build_object('learn_email_failure_v1',receipt) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'learn_email_job_not_owned' using errcode='PT409';end if;
 return answer;
end $$;
revoke all on function public.learn_email_job_fail(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_job_fail(uuid,uuid,uuid,text,integer) to service_role;
create function public.learn_capture_job_allowed(p_tenant uuid,p_type text,p_metadata jsonb,p_job uuid) returns boolean
language sql volatile security definer set search_path=pg_catalog as $$
 select public.learn_capture_job_allowed(p_tenant,p_type,p_metadata)
 or (p_type in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill') and exists(
  select 1 from public.learn_email_job_attempts b
  join public.platform_jobs j on j.id=b.job_id and j.tenant_id=b.tenant_id
  join public.email_sync_runs r on r.id=b.attempt_id and r.tenant_id=b.tenant_id
  where b.job_id=p_job and b.tenant_id=p_tenant and j.job_type=p_type
   and b.definition=jsonb_build_object('job_type',j.job_type,'job_key',j.job_key,'payload',j.payload,'connector_id',j.connector_id,'module_id',j.module_id)
   and r.provider='gmail' and r.sync_type=b.sync_type
   and r.metadata->>'email_account_id'=b.email_account_id::text
   and ((r.status in ('success','failed') and r.completed_at is not null)
    or (r.status='running' and exists(
     select 1 from public.learn_email_transition_requests pending
     where pending.tenant_id=b.tenant_id and pending.email_account_id=b.email_account_id
      and pending.attempt_id=b.attempt_id and pending.stream=b.stream
      and not exists(select 1 from public.learn_email_transition_settlements settled where settled.request_id=pending.id)
    )))
 ));
$$;
revoke all on function public.learn_capture_job_allowed(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.learn_capture_job_allowed(uuid,text,jsonb,uuid) to service_role;

-- Keep priority, due/lease checks, locking and dedicated-worker exclusions intact.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata)';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'learn_email_recovery_queue_shape_changed';end if;
 execute replace(d,needle,'public.learn_capture_job_allowed(c.tenant_id,c.job_type,c.metadata,c.id)');
end $$;
create function public.learn_email_enqueue(p_tenant uuid,p_account uuid,p_type text,p_options jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog as $$
declare a public.email_accounts%rowtype;j public.platform_jobs%rowtype;
 payload jsonb;connector text;key text;duplicate boolean;n integer;begin
 if current_user<>'service_role' then raise exception 'learn_email_enqueue_forbidden' using errcode='42501';end if;
 if p_tenant is null or p_account is null or p_type is null or p_type not in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill')
  or jsonb_typeof(p_options) is distinct from 'object' or (p_options-array['max_results','force','restart'])<>'{}'::jsonb then
  raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 if (p_options ? 'force' and jsonb_typeof(p_options->'force') is distinct from 'boolean')
  or (p_options ? 'restart' and jsonb_typeof(p_options->'restart') is distinct from 'boolean')
  or (p_type='email.workspace_backfill' and p_options ? 'force')
  or (p_type<>'email.workspace_backfill' and p_options ? 'restart') then
  raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 if p_options ? 'max_results' then
  if jsonb_typeof(p_options->'max_results') is distinct from 'number' or not coalesce(p_options->>'max_results'~'^[0-9]{1,3}$',false) then
   raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
  if (p_options->>'max_results')::integer not between 1 and 500 then raise exception 'learn_email_enqueue_invalid' using errcode='22023';end if;
 end if;
 if p_options->'restart'='true'::jsonb then raise exception 'learn_email_explicit_recovery_required' using errcode='PT409';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'learn_capture_snapshot_invalid' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-input-setup:'||p_tenant::text,0));
 if not public.learn_capture_allowed(p_tenant,'email') then raise exception 'learn_capture_paused' using errcode='PT409';end if;
 select * into a from public.email_accounts where id=p_account and tenant_id=p_tenant and provider='gmail';
 if not found or (p_type='email.gmail_sync' and (a.status<>'active' or a.auth_state not in ('ok','unknown') or a.auth_state is null))
  or (p_type<>'email.gmail_sync' and a.status not in ('pending_tokenless_dwd','active_dwd')) then
  raise exception 'learn_email_source_ineligible' using errcode='PT409';end if;
 -- The worker rechecks all current mailbox/connection authority before tokens.
 payload:=jsonb_build_object('email_account_id',p_account);
 if p_type<>'email.workspace_backfill' or p_options ? 'max_results' then
  payload:=payload||jsonb_build_object('max_results',coalesce((p_options->>'max_results')::integer,25));end if;
 if p_options->'force'='true'::jsonb then payload:=payload||'{"force":true}'::jsonb;end if;
 connector:=case when p_type='email.gmail_sync' then 'gmail' else 'google-workspace' end;
 key:=p_type||':'||p_account::text;
 -- The unique active-job key arbitrates concurrent schedulers and requests.
 -- Never overwrite an existing payload, including a different rescan intent.
 for n in 1..3 loop
  insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,priority,max_attempts,payload)
   values(p_tenant,connector,'communications.email',p_type,key,case when p_type='email.workspace_backfill' then 200 else 100 end,5,payload)
   on conflict(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying') do nothing returning * into j;
  duplicate:=not found;
  if duplicate then
   select * into j from public.platform_jobs where tenant_id=p_tenant and job_key=key and status in ('queued','running','retrying') for share;
   if not found then continue;end if;
   if j.job_type is distinct from p_type or j.connector_id is distinct from connector or j.module_id is distinct from 'communications.email' or j.payload is distinct from payload then
    raise exception 'learn_email_active_request_conflict' using errcode='PT409';end if;
  end if;
  return jsonb_build_object('version','learn-email-enqueue/1','success',true,'state','queued','job_id',j.id,'duplicate',duplicate,'provider','gmail','email_account_id',p_account);
 end loop;
 raise exception 'learn_email_enqueue_busy' using errcode='PT409';
end $$;
revoke all on function public.learn_email_enqueue(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.learn_email_enqueue(uuid,uuid,text,jsonb) to service_role;
do $$begin
 if (select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_email_preserved_before x) is distinct from (select jsonb_agg(to_jsonb(x) order by x.name) from (select 'public.email_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_messages s union all select 'public.phone_calls' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_calls s union all select 'public.phone_recordings' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_recordings s union all select 'public.phone_transcripts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_transcripts s union all select 'public.slack_messages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_messages s union all select 'public.slack_message_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_message_versions s union all select 'public.interactions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.interactions s union all select 'public.people' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.people s union all select 'public.companies' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.companies s union all select 'public.customer_cards' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.customer_cards s union all select 'public.sites' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.sites s union all select 'public.jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.jobs s union all select 'public.provider_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connections s union all select 'public.tenant_connectors' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenant_connectors s union all select 'public.connector_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.connector_accounts s union all select 'public.platform_jobs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_jobs s union all select 'public.feature_flags' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.feature_flags s union all select 'public.learn_business_input_pages' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_pages s union all select 'public.learn_business_input_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_versions s union all select 'public.learn_business_input_observations' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_observations s union all select 'public.provider_connection_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.provider_connection_events s union all select 'public.platform_authority_grants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.platform_authority_grants s union all select 'public.learn_operator_input_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_operator_input_requests s union all select 'public.profiles' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.profiles s union all select 'public.authority_permissions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.authority_permissions s union all select 'public.learn_business_input_request_gates' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_gates s union all select 'public.learn_business_input_request_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_request_permits s union all select 'vault.secrets' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from vault.secrets s union all select 'public.tenants' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.tenants s union all select 'public.view_as_context' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.view_as_context s union all select 'public.config_versions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.config_versions s union all select 'public.learn_commusoft_connection_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_connection_requests s union all select 'public.learn_commusoft_verification_requests' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_requests s union all select 'public.learn_commusoft_verification_permits' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_permits s union all select 'public.learn_commusoft_verification_results' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_commusoft_verification_results s union all select 'public.learn_business_input_links' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_links s union all select 'public.learn_business_input_projection_attempts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_attempts s union all select 'public.learn_business_input_projection_batches' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.learn_business_input_projection_batches s union all select 'public.contact_points' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.contact_points s union all select 'public.graph_nodes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_nodes s union all select 'public.graph_edges' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_edges s union all select 'public.graph_events' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.graph_events s union all select 'public.email_accounts' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_accounts s union all select 'public.email_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_sync_runs s union all select 'public.email_threads' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_threads s union all select 'public.email_ingestion_checkpoints' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_checkpoints s union all select 'public.email_ingestion_transitions' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.email_ingestion_transitions s union all select 'public.google_workspace_connections' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_connections s union all select 'public.google_workspace_mailboxes' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.google_workspace_mailboxes s union all select 'public.phone_sync_runs' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_sync_runs s union all select 'public.phone_ai_insights' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.phone_ai_insights s union all select 'public.slack_workspace_pacing' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from public.slack_workspace_pacing s)x) then raise exception 'Existing TEST sources changed during email release';end if;
end $$;
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref) values(current_setting('serviceos.release_source_sha256'),'learn_email_runtime_v1','saatxzwxvdvqevbnskxy');
notify pgrst,'reload schema';
select 'learn-email-runtime/1' as marker,jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('email_ingestion_account_guard_v2','email_ingestion_checkpoint_json_v2','email_ingestion_count_v2','email_ingestion_evidence_v2','email_ingestion_keys_v2','email_ingestion_payload_v2','email_ingestion_recovery_v2','email_ingestion_run_guard_v2','email_ingestion_transition_result_v2','email_ingestion_transition_v2','learn_operator_input_access','learn_operator_input_immutable','learn_slack_claim_jobs','platform_jobs_claim','platform_jobs_complete_email_v1','phone_retry_state','phone_pending_readiness','phone_select_pending','learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job','learn_email_transition_immutable','learn_email_transition_prepare','learn_email_transition_pending','learn_email_transition_apply','learn_email_job_attempt','learn_email_attempt_lease','learn_email_store_guard','learn_email_store_existing','learn_email_store_page','learn_email_job_fail','learn_email_enqueue')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.policyname),'[]') from pg_policies x where x.schemaname='public' and x.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('tenants','profiles','feature_flags','platform_jobs','slack_workspace_pacing','email_accounts','email_sync_runs','email_threads','email_messages','email_ingestion_checkpoints','email_ingestion_transitions','email_oauth_tokens','google_workspace_connections','google_workspace_mailboxes','phone_recordings','phone_transcripts','phone_ai_insights','phone_sync_runs','learn_capture_control_requests','learn_email_transition_requests','learn_email_transition_settlements','learn_email_job_attempts') and c.relkind='r'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state'),
 'ledger',(select jsonb_agg(jsonb_build_object('migration_name',migration_name,'source_sha256',source_sha256,'project_ref',project_ref) order by migration_name) from of_test_deploy.migrations)
) as catalog,md5((jsonb_build_object(
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('email_ingestion_account_guard_v2','email_ingestion_checkpoint_json_v2','email_ingestion_count_v2','email_ingestion_evidence_v2','email_ingestion_keys_v2','email_ingestion_payload_v2','email_ingestion_recovery_v2','email_ingestion_run_guard_v2','email_ingestion_transition_result_v2','email_ingestion_transition_v2','learn_operator_input_access','learn_operator_input_immutable','learn_slack_claim_jobs','platform_jobs_claim','platform_jobs_complete_email_v1','phone_retry_state','phone_pending_readiness','phone_select_pending','learn_capture_allowed','learn_capture_control_state','learn_operator_capture_controls','learn_operator_capture_control_request','learn_capture_admission','learn_capture_job_allowed','learn_capture_defer_job','learn_email_transition_immutable','learn_email_transition_prepare','learn_email_transition_pending','learn_email_transition_apply','learn_email_job_attempt','learn_email_attempt_lease','learn_email_store_guard','learn_email_store_existing','learn_email_store_page','learn_email_job_fail','learn_email_enqueue')),
 'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname),'[]') from pg_constraint where conrelid=c.oid),
 'indexes',(select coalesce(jsonb_agg(indexdef order by indexname),'[]') from pg_indexes where schemaname='public' and tablename=c.relname),
 'policies',(select coalesce(jsonb_agg(to_jsonb(x) order by x.policyname),'[]') from pg_policies x where x.schemaname='public' and x.tablename=c.relname),
 'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid) order by tgname),'[]') from pg_trigger where tgrelid=c.oid and not tgisinternal)) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('tenants','profiles','feature_flags','platform_jobs','slack_workspace_pacing','email_accounts','email_sync_runs','email_threads','email_messages','email_ingestion_checkpoints','email_ingestion_transitions','email_oauth_tokens','google_workspace_connections','google_workspace_mailboxes','phone_recordings','phone_transcripts','phone_ai_insights','phone_sync_runs','learn_capture_control_requests','learn_email_transition_requests','learn_email_transition_settlements','learn_email_job_attempts') and c.relkind='r'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid),'options',c.reloptions,'acl',c.relacl::text) order by c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='phone_recording_pipeline_state'),
 'ledger',(select jsonb_agg(jsonb_build_object('migration_name',migration_name,'source_sha256',source_sha256,'project_ref',project_ref) order by migration_name) from of_test_deploy.migrations)
))::text) as fingerprint,(select jsonb_agg(to_jsonb(x) order by x.name) from serviceos_email_preserved_before x) as preserved;
commit;
