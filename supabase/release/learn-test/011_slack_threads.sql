-- Generated TEST-only retained Slack thread windows. No source imports or schedules.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_durable_worker_v1' and source_sha256='74bfa2f96e5ad2b40fb40b1e6b03f1cdd6f605f3d8d57a598a541222f8a1955e' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified durable worker prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_threads_v1') then raise exception 'Slack thread release already exists';end if;
 if to_regclass('public.slack_thread_imports') is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_slack_store_records','learn_slack_thread_immutable','learn_slack_start_thread_import','slack_thread_commit_page','learn_slack_read_thread_credential','learn_slack_finish_thread_job'])) then raise exception 'Thread objects already exist';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_claim_jobs') is distinct from '8efe1969e03f302d42472b9d3227987b' then raise exception 'Reviewed learn_slack_claim_jobs differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_commit_page_private') is distinct from '93c29a7d7db1c610b7b05cd2f5be40ba' then raise exception 'Reviewed learn_slack_commit_page_private differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_finish_job') is distinct from '81d5f1054a3a67d137f419b86bd22584' then raise exception 'Reviewed learn_slack_finish_job differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='learn_slack_read_credential') is distinct from '33baf10ed6a97e135a511514a61e80c6' then raise exception 'Reviewed learn_slack_read_credential differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='platform_jobs_claim') is distinct from '33871e87998572faec89664a3db7ac67' then raise exception 'Reviewed platform_jobs_claim differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='platform_jobs_complete_email_v1') is distinct from '78103231f68fcbdd9fc2f21c3639ee62' then raise exception 'Reviewed platform_jobs_complete_email_v1 differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='slack_history_commit_page') is distinct from '1a899d4787d1b5f0d9db0b690562b9af' then raise exception 'Reviewed slack_history_commit_page differs';end if;
end $$;
-- SOURCE supabase/migrations/20261030120000_learn_slack_thread_storage.sql
-- SHA-256 c04cb34944a5ca00c6c1f438f42e00937dd767d8fab359a4290234c3b0a04968
-- Retained, explicitly approved thread windows. No approval, credential, job,
-- schedule or provider request is created by applying this migration.

-- Share the existing source/version/interaction transaction with thread pages.
-- Extract only the reviewed validation/upsert block; preserve its semantics.
do $migration$ declare d text;block text;original_block text;start_at integer;end_at integer;begin
 d:=pg_get_functiondef('public.learn_slack_commit_page_private(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 start_at:=strpos(d,' if jsonb_typeof(p_records) is distinct from ''array''');
 end_at:=strpos(d,' update public.connector_accounts set sync_cursor=p_next');
 if start_at=0 or end_at<=start_at or
  strpos(substr(d,start_at,end_at-start_at),'insert into public.slack_message_versions')=0 then
  raise exception 'Reviewed Slack source writer differs';end if;
 block:=substr(d,start_at,end_at-start_at);
 original_block:=block;
 if strpos(block,'''coverage'',''bounded_history_page'',''threads'',''unverified''')=0 then
  raise exception 'Reviewed Slack interaction provenance differs';end if;
 block:=replace(block,'''coverage'',''bounded_history_page'',''threads'',''unverified''',
  '''coverage'',case when p_parent_timestamp is null then ''bounded_history_page'' else ''observed_thread_page'' end,''threads'',''unverified''');
 execute $head$create function public.learn_slack_store_records(p_tenant_id uuid,cfg jsonb,p_records jsonb,p_parent_timestamp text)
 returns void language plpgsql security invoker set search_path=public,pg_temp as $body$
 declare r jsonb;sid uuid;version_hash text;provider_updated numeric;current_version text;seen text[]:=array[]::text[];
 begin
  if p_parent_timestamp is not null then
   if p_parent_timestamp !~ '^\d{1,12}\.\d{1,6}$' then raise exception 'thread_parent_invalid';end if;
   for r in select value from jsonb_array_elements(p_records) loop
    if r->>'provider_timestamp'=p_parent_timestamp then
     if r->>'thread_timestamp' is not null and r->>'thread_timestamp'<>p_parent_timestamp then raise exception 'thread_record_mismatch';end if;
    elsif r->>'thread_timestamp' is distinct from p_parent_timestamp then raise exception 'thread_record_mismatch';end if;
    if (r->>'provider_timestamp')::numeric<p_parent_timestamp::numeric then raise exception 'thread_record_mismatch';end if;
   end loop;
  end if;
 $head$||block||E'\nend $body$;';
 execute replace(d,original_block,E' perform public.learn_slack_store_records(p_tenant_id,cfg,p_records,null);\n');
end $migration$;
revoke all on function public.learn_slack_store_records(uuid,jsonb,jsonb,text) from public,anon,authenticated,service_role;

create table public.slack_thread_imports(
 id uuid primary key,
 tenant_id uuid not null references public.tenants(id),
 account_id uuid not null references public.connector_accounts(id),
 source_message_id uuid not null references public.slack_messages(id),
 initial_job_id uuid not null references public.platform_jobs(id),
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default clock_timestamp(),
 definition jsonb not null,
 scope jsonb not null,
 checkpoint jsonb not null default '{}'::jsonb
);
alter table public.slack_thread_imports enable row level security;
create policy slack_threads_read on public.slack_thread_imports for select to authenticated
 using(tenant_id=public.current_tenant_id());
revoke all on public.slack_thread_imports from public,anon,authenticated,service_role;
grant select on public.slack_thread_imports to authenticated,service_role;
create trigger learn_thread_reference_guard before insert or update on public.slack_thread_imports
 for each row execute function public.learn_foundation_reference_guard();
create trigger learn_thread_retain before delete on public.slack_thread_imports
 for each row execute function public.slack_version_immutable();
create trigger learn_thread_retain_truncate before truncate on public.slack_thread_imports
 for each statement execute function public.slack_version_immutable();
create function public.learn_slack_thread_immutable() returns trigger language plpgsql set search_path=pg_catalog as $$begin
 if to_jsonb(old)-'checkpoint' is distinct from to_jsonb(new)-'checkpoint' then
  raise exception 'Thread approval evidence is immutable' using errcode='55000';end if;
 return new;
end $$;
revoke all on function public.learn_slack_thread_immutable() from public,anon,authenticated,service_role;
create trigger learn_thread_approval_immutable before update on public.slack_thread_imports
 for each row execute function public.learn_slack_thread_immutable();

create function public.learn_slack_start_thread_import(
 p_tenant_id uuid,p_request_id uuid,p_account_id uuid,p_source_message_id uuid,p_source_version text,
 p_connection_revision timestamptz,p_start timestamptz,p_end timestamptz,p_max_pages integer,p_reason text
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare a public.connector_accounts%rowtype;m public.slack_messages%rowtype;c public.provider_connections%rowtype;
 prior public.slack_thread_imports%rowtype;definition jsonb;scope jsonb;parent text;job_id uuid:=gen_random_uuid();key text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Thread approval requires a fresh snapshot' using errcode='22023';end if;
 perform pg_advisory_xact_lock_shared(hashtextextended('learn-work-registry',0));
 perform pg_advisory_xact_lock(hashtextextended('learn-roster:'||p_tenant_id::text,0));
 if auth.uid() is null or p_tenant_id is distinct from public.current_tenant_id()
  or coalesce(public.current_user_role(),'') not in ('owner','admin')
  or exists(select 1 from public.view_as_context where actor_user_id=auth.uid()
   and ended_at is null and (expires_at is null or expires_at>clock_timestamp())) then
  raise exception 'Company owner/admin access required outside preview' using errcode='42501';end if;
 if p_request_id is null or p_account_id is null or p_source_message_id is null
  or coalesce(p_source_version,'') !~ '^[a-f0-9]{64}$' or p_connection_revision is null
  or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
  or p_start<to_timestamp(0) or p_end<=p_start or p_end>clock_timestamp() or p_end-p_start>interval '24 hours'
  or p_max_pages is null or p_max_pages not between 1 and 10 or length(btrim(coalesce(p_reason,''))) not between 1 and 1000 then
  raise exception 'Invalid thread approval' using errcode='22023';end if;
 definition:=jsonb_build_object('accountId',p_account_id,'sourceMessageId',p_source_message_id,'sourceVersion',p_source_version,
  'connectionRevision',p_connection_revision,'start',p_start,'end',p_end,'maxPages',p_max_pages,'reason',btrim(p_reason));
 perform pg_advisory_xact_lock(hashtextextended('learn-slack-thread-request:'||p_request_id::text,0));
 select * into prior from public.slack_thread_imports where id=p_request_id;
 if found then
  if prior.tenant_id<>p_tenant_id or prior.definition<>definition then raise exception 'Thread request identity changed' using errcode='PT409';end if;
  return jsonb_build_object('requestId',prior.id,'accountId',prior.account_id,'jobId',prior.initial_job_id,'reused',true);
 end if;
 select * into a from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then raise exception 'Thread account unavailable' using errcode='55000';end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
  and connector_id='slack' and enabled and status='active' for share;
 if not found then raise exception 'Slack connector unavailable' using errcode='55000';end if;
 select * into c from public.provider_connections where id=(a.settings->'slack_history'->>'connectionId')::uuid
  and tenant_id=p_tenant_id and provider='slack' and status='configured' and revoked_at is null for share;
 if not found or c.updated_at is distinct from p_connection_revision or not ('bot_token'=any(c.configured_fields))
  or c.secret_refs->>'bot_token' is null then raise exception 'Slack connection changed' using errcode='PT409';end if;
 select * into m from public.slack_messages where id=p_source_message_id and tenant_id=p_tenant_id for share;
 if not found or m.source_version<>p_source_version or m.team_id is distinct from c.non_secret_config->>'team_id'
  or m.channel_id is distinct from a.settings->'slack_history'->>'channelId' then
  raise exception 'Observed thread source changed' using errcode='PT409';end if;
 -- A stored reply or broadcast identifies its parent; a root needs a provider
 -- reply count. Unthreaded messages and guessed timestamps cannot grant access.
 if m.thread_timestamp is not null and m.thread_timestamp<>m.provider_timestamp then parent:=m.thread_timestamp;
 elsif coalesce(m.provider_payload->>'reply_count','') ~ '^[0-9]+$' and (m.provider_payload->>'reply_count')::numeric>0 then parent:=m.provider_timestamp;
 else raise exception 'No observed thread on this source' using errcode='22023';end if;
 if parent !~ '^\d{1,12}\.\d{1,6}$' or parent::numeric>extract(epoch from p_end) or parent::numeric>m.provider_timestamp::numeric then
  raise exception 'Observed thread timestamp invalid' using errcode='22023';end if;
 key:='slack.thread:'||p_account_id::text||':'||parent||':'||extract(epoch from p_start)::text||':'||extract(epoch from p_end)::text;
 perform pg_advisory_xact_lock(hashtextextended(key,0));
 if exists(select 1 from public.platform_jobs where tenant_id=p_tenant_id and job_key=key and status in ('queued','running','retrying')) then
  raise exception 'Thread import already active' using errcode='55000';end if;
 scope:=jsonb_build_object('approved',true,'connectionId',c.id,'teamId',m.team_id,'channelId',m.channel_id,
  'parentTimestamp',parent,'oldest',to_char(extract(epoch from p_start),'FM999999999999.000000'),
  'latest',to_char(extract(epoch from p_end),'FM999999999999.000000'),'consentReference','learn-slack-thread:'||p_request_id::text,
  'expiresAt',clock_timestamp()+interval '24 hours','maxPages',p_max_pages);
 insert into public.platform_jobs(id,tenant_id,connector_id,job_type,job_key,status,max_attempts,available_at,payload,created_by)
  values(job_id,p_tenant_id,'slack','slack.thread_sync',key,'queued',5,clock_timestamp(),jsonb_build_object('thread_import_id',p_request_id,'connector_account_id',p_account_id),auth.uid());
 insert into public.slack_thread_imports(id,tenant_id,account_id,source_message_id,initial_job_id,approved_by,definition,scope)
  values(p_request_id,p_tenant_id,p_account_id,p_source_message_id,job_id,auth.uid(),definition,scope);
 return jsonb_build_object('requestId',p_request_id,'accountId',p_account_id,'jobId',job_id,'reused',false);
end $$;
revoke all on function public.learn_slack_start_thread_import(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,text) from public,anon,service_role;
grant execute on function public.learn_slack_start_thread_import(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,timestamptz,integer,text) to authenticated;

create function public.slack_thread_commit_page(p_tenant_id uuid,p_job_id uuid,p_import_id uuid,p_claimed_by text,p_attempt_count integer,
 p_expected jsonb,p_next jsonb,p_records jsonb) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;
 cfg jsonb;scope_key jsonb;receipt jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.thread_sync' or j.payload->>'thread_import_id' is distinct from p_import_id::text
  or p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or p_attempt_count is null or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_page_v1';
 if receipt is not null then
  if receipt->>'thread_import_id'=p_import_id::text and receipt->'expected'=p_expected and receipt->'next'=p_next and receipt->>'records_hash'=md5(p_records::text) then return true;end if;
  raise exception 'slack_page_already_committed' using errcode='PT409';
 end if;
 select * into t from public.slack_thread_imports where id=p_import_id and tenant_id=p_tenant_id for update;
 if not found or j.payload->>'connector_account_id' is distinct from t.account_id::text then raise exception 'thread_import_unavailable';end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then raise exception 'thread_account_unavailable';end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' and enabled and status='active' for share;
 if not found then raise exception 'thread_connector_unavailable';end if;
 cfg:=t.scope;
 if cfg->'approved' is distinct from 'true'::jsonb or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() then raise exception 'thread_scope_unavailable';end if;
 perform 1 from public.provider_connections where id=(cfg->>'connectionId')::uuid and tenant_id=p_tenant_id and provider='slack'
  and status='configured' and revoked_at is null and non_secret_config->>'team_id'=cfg->>'teamId' for share;
 if not found then raise exception 'thread_connection_unavailable';end if;
 scope_key:=jsonb_build_array(p_tenant_id::text,cfg->>'teamId',cfg->>'channelId',cfg->>'oldest',cfg->>'latest',cfg->>'consentReference',cfg->>'parentTimestamp');
 if jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_next) is distinct from 'object'
  or not(p_expected ?& array['scopeKey','cursor','pages','complete']) or not(p_next ?& array['scopeKey','cursor','pages','complete'])
  or (select count(*) from jsonb_object_keys(p_expected))<>4 or (select count(*) from jsonb_object_keys(p_next))<>4
  or jsonb_typeof(p_expected->'scopeKey') is distinct from 'string' or jsonb_typeof(p_next->'scopeKey') is distinct from 'string'
  or (p_expected->>'scopeKey')::jsonb is distinct from scope_key or p_next->>'scopeKey' is distinct from p_expected->>'scopeKey'
  or jsonb_typeof(p_expected->'pages') is distinct from 'number' or jsonb_typeof(p_next->'pages') is distinct from 'number'
  or (p_expected->>'pages') !~ '^[0-9]+$' or (p_next->>'pages') !~ '^[0-9]+$'
  or (p_next->>'pages')::integer<>(p_expected->>'pages')::integer+1 or (p_next->>'pages')::integer>(cfg->>'maxPages')::integer
  or p_expected->'complete' is distinct from 'false'::jsonb or jsonb_typeof(p_next->'complete') is distinct from 'boolean'
  or jsonb_typeof(p_expected->'cursor') not in ('null','string') or jsonb_typeof(p_next->'cursor') not in ('null','string')
  or p_next->'complete'='true'::jsonb and p_next->>'cursor' is not null
  or p_next->'complete'='false'::jsonb and coalesce(p_next->>'cursor','')=''
  or length(coalesce(p_next->>'cursor',''))>1024 or length(coalesce(p_expected->>'cursor',''))>1024
  or p_next->>'cursor' is not null and p_next->>'cursor'=p_expected->>'cursor' then raise exception 'thread_checkpoint_invalid';end if;
 if t.checkpoint is distinct from p_expected and not(t.checkpoint='{}'::jsonb and p_expected->'pages'='0'::jsonb and p_expected->'cursor'='null'::jsonb) then
  raise exception 'thread_checkpoint_conflict' using errcode='PT409';end if;
 perform public.learn_slack_store_records(p_tenant_id,cfg,p_records,cfg->>'parentTimestamp');
 update public.slack_thread_imports set checkpoint=p_next where id=t.id;
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_page_v1',jsonb_build_object(
  'kind','thread','thread_import_id',t.id,'account_id',t.account_id,'expected',p_expected,'next',p_next,'max_pages',(cfg->>'maxPages')::integer,
  'records_hash',md5(p_records::text),'records_processed',jsonb_array_length(p_records),'committed_at',clock_timestamp())) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return true;
end $$;
revoke all on function public.slack_thread_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.slack_thread_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb) to service_role;

-- SOURCE supabase/migrations/20261030130000_learn_slack_thread_worker.sql
-- SHA-256 05fc686bdf849362ce71a17e511ed1aa8be62ef78ae9d2a38791ecce81627c81
-- Add thread jobs to the existing bounded Slack executor. No schedule or import.

do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 needle:='c.job_type <> ''slack.history_sync''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed generic Slack exclusion differs';end if;
 execute replace(d,needle,'c.job_type not in (''slack.history_sync'',''slack.thread_sync'')');
 d:=pg_get_functiondef('public.learn_slack_claim_jobs(uuid,integer)'::regprocedure);
 needle:='q.job_type=''slack.history_sync''';
 if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Reviewed Slack claim differs';end if;
 execute replace(d,needle,'q.job_type in (''slack.history_sync'',''slack.thread_sync'')');
end $$;

create function public.learn_slack_read_thread_credential(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,
 p_connection_id uuid,p_revision timestamptz,p_secret_id uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;cfg jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_credential_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_credential_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.thread_sync' or
  p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or p_attempt_count is null or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or j.metadata ? 'slack_page_v1' then return null;end if;
 select * into t from public.slack_thread_imports where id=(j.payload->>'thread_import_id')::uuid and tenant_id=p_tenant_id for share;
 if not found or j.payload->>'connector_account_id' is distinct from t.account_id::text then return null;end if;
 select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then return null;end if;
 cfg:=t.scope;
 if cfg->'approved' is distinct from 'true'::jsonb or coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
  or (cfg->>'connectionId')::uuid is distinct from p_connection_id then return null;end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id and connector_id='slack' and enabled and status='active' for share;
 if not found then return null;end if;
 perform 1 from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id and provider='slack'
  and status='configured' and revoked_at is null and updated_at=p_revision and non_secret_config->>'team_id'=cfg->>'teamId'
  and 'bot_token'=any(configured_fields) and secret_refs->>'bot_token'=p_secret_id::text for share;
 if not found then return null;end if;
 select decrypted_secret into secret from vault.decrypted_secrets where id=p_secret_id and name='provider_secret:'||p_tenant_id::text||':slack:bot_token';
 if j.lease_expires_at<=clock_timestamp() then return null;end if;
 return secret;
end $$;

create function public.learn_slack_finish_thread_job(p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_outcome jsonb)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;t public.slack_thread_imports%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;page jsonb;checkpoint jsonb;result_doc jsonb;successor uuid;delay_seconds integer;next_status text;stop_reason text;answer jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 if p_claimed_by is null or p_attempt_count is null or p_attempt_count<1 or jsonb_typeof(p_outcome) is distinct from 'object'
  or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then raise exception 'slack_queue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type<>'slack.thread_sync' or j.claimed_by is distinct from p_claimed_by or j.attempt_count is distinct from p_attempt_count then
  raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_finish_v1';
 if j.status in ('succeeded','retrying','dead_letter') and receipt->>'claimed_by'=p_claimed_by and (receipt->>'attempt_count')::integer=p_attempt_count then
  if receipt->'outcome'=p_outcome then return receipt->'answer';end if;
  raise exception 'slack_queue_replay_conflict' using errcode='PT409';end if;
 if j.status<>'running' or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 if p_outcome->'success'='true'::jsonb then
  if p_outcome<>'{"success":true}'::jsonb then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  select * into t from public.slack_thread_imports where id=(j.payload->>'thread_import_id')::uuid and tenant_id=p_tenant_id for share;
  if not found or j.payload->>'connector_account_id' is distinct from t.account_id::text then raise exception 'slack_queue_identity' using errcode='22023';end if;
  page:=j.metadata->'slack_page_v1';checkpoint:=t.checkpoint;
  if page is null and checkpoint->'complete' is distinct from 'true'::jsonb and coalesce((checkpoint->>'pages')::integer,-1)<(t.scope->>'maxPages')::integer then
   raise exception 'slack_queue_page_missing' using errcode='PT409';end if;
  if page is not null and (page->>'kind' is distinct from 'thread' or page->>'thread_import_id' is distinct from t.id::text or page->'next' is distinct from checkpoint) then
   raise exception 'slack_queue_checkpoint_changed' using errcode='PT409';end if;
  stop_reason:=case when checkpoint->'complete'='true'::jsonb then 'window_pages_complete'
   when (checkpoint->>'pages')::integer>=(t.scope->>'maxPages')::integer then 'page_budget_exhausted' else 'run_page_limit' end;
  select * into a from public.connector_accounts where id=t.account_id and tenant_id=p_tenant_id for share;
  if not found then raise exception 'slack_queue_identity' using errcode='22023';end if;
  if stop_reason='run_page_limit' and (a.status<>'active' or coalesce((t.scope->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or not exists(select 1 from public.tenant_connectors c where c.id=a.tenant_connector_id and c.tenant_id=p_tenant_id and c.connector_id='slack' and c.enabled and c.status='active')
   or not exists(select 1 from public.provider_connections c where c.id=(t.scope->>'connectionId')::uuid and c.tenant_id=p_tenant_id and c.provider='slack' and c.status='configured' and c.revoked_at is null)) then stop_reason:='authorisation_changed';end if;
  result_doc:=checkpoint||jsonb_build_object('stopReason',stop_reason,'coverage','observed_thread_window','parentTimestamp',t.scope->>'parentTimestamp',
   'threadCoverage',case when checkpoint->'complete'='true'::jsonb then 'observed_thread_window_complete' else 'observed_thread_window_incomplete' end,'ingestion_complete',false);
  update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,error_code=null,
   result=result_doc,records_processed=coalesce((page->>'records_processed')::integer,0) where id=j.id;
  if stop_reason='run_page_limit' then
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,available_at,parent_job_id,payload)
    values(j.tenant_id,j.connector_id,j.module_id,j.job_type,j.job_key,'queued',j.priority,j.max_attempts,
     greatest(clock_timestamp(),(page->>'committed_at')::timestamptz)+interval '60 seconds',j.id,j.payload) returning id into successor;
  end if;
  next_status:='succeeded';
 else
  if not(p_outcome ?& array['success','code','retryable','retry_after_seconds']) or (select count(*) from jsonb_object_keys(p_outcome))<>4
   or jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean' or jsonb_typeof(p_outcome->'code') is distinct from 'string'
   or p_outcome->>'code' !~ '^slack_history_[a-z_]{1,80}$' or jsonb_typeof(p_outcome->'retry_after_seconds') is distinct from 'number'
   or p_outcome->>'retry_after_seconds' !~ '^[0-9]{1,8}$' then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=(p_outcome->>'retry_after_seconds')::integer;
  if delay_seconds>31536000 then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=greatest(delay_seconds,case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end);
  next_status:=case when p_outcome->'retryable'='true'::jsonb and j.attempt_count<j.max_attempts then 'retrying' else 'dead_letter' end;
  update public.platform_jobs set status=next_status,lease_expires_at=null,error_code=p_outcome->>'code',error_count=coalesce(error_count,0)+1,
   failed_at=clock_timestamp(),available_at=case when next_status='retrying' then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
   dead_lettered_at=case when next_status='dead_letter' then clock_timestamp() else dead_lettered_at end where id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',j.id,'status',next_status,'successor_id',successor);
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_finish_v1',jsonb_build_object(
  'claimed_by',p_claimed_by,'attempt_count',p_attempt_count,'outcome',p_outcome,'answer',answer)) where id=j.id;
 return answer;
end $$;
revoke all on function public.learn_slack_read_thread_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid),
 public.learn_slack_finish_thread_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_slack_read_thread_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid),
 public.learn_slack_finish_thread_job(uuid,uuid,text,integer,jsonb) to service_role;

insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_slack_threads_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
