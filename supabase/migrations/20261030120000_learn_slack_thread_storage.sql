-- Retained, explicitly approved thread windows. No approval, credential, job,
-- schedule or provider request is created by applying this migration.
begin;

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
commit;
