-- Generated TEST-only durable Slack worker and existing-credential resolver.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_storage_setup_v1' and source_sha256='d4b762ace7c9ccecba29890649e40d7e1501aa5f6e1c2b711970fb55368d305e' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified Slack storage prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_durable_worker_v1') then raise exception 'Slack worker release already exists';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_slack_claim_jobs','learn_slack_finish_job','learn_slack_commit_page_private','learn_slack_read_credential'])) then raise exception 'Worker function already exists';end if;
 if not exists(select 1 from pg_extension where extname='supabase_vault' and extversion='0.3.1') or not has_schema_privilege('postgres','vault','USAGE') or not has_table_privilege('postgres','vault.decrypted_secrets','SELECT') then raise exception 'Reviewed existing Vault prerequisite required';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='platform_jobs_claim') is distinct from '4a6f7c4f01eac6bf5615e4fe2d218501' then raise exception 'Reviewed platform_jobs_claim differs';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='slack_history_commit_page') is distinct from '420780e686ff2c943b3b7e2baadc9693' then raise exception 'Reviewed slack_history_commit_page differs';end if;
end $$;
-- SOURCE supabase/migrations/20261030100000_learn_slack_worker.sql
-- SHA-256 1a06eb01b97cfc314c02abb260a9f398601d1d0ecb08bffa7f4123910a9a2fa1
-- Slack-only durable execution on the existing queue. No schedules, credentials,
-- source deletion or activation. Deploy together with the fenced Slack worker.

-- Preserve the reviewed generic queue implementation, reserving Slack claims for
-- the bounded worker. Other job types retain their existing claim behaviour.
do $$ declare d text;needle text:='where c.status in (''queued'', ''retrying'')';begin
 d:=pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Reviewed generic claim function changed';
 end if;
 execute replace(d,needle,needle||E'\n      and c.job_type <> ''slack.history_sync''');
end $$;

create function public.learn_slack_claim_jobs(p_worker uuid,p_batch integer default 1)
returns setof public.platform_jobs language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;begin
 if current_user<>'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if p_worker is null or p_batch is null or p_batch not between 1 and 5 then
  raise exception 'slack_queue_invalid' using errcode='22023';end if;
 -- One locked scan also recovers crashed workers. Exhausted attempts are retained
 -- as dead letters; no generic unbounded reclaim pass is needed.
 for j in select * from public.platform_jobs q where q.job_type='slack.history_sync'
  and ((q.status in ('queued','retrying') and coalesce(q.available_at,'-infinity')<=clock_timestamp()
    and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp())
   or (q.status='running' and coalesce(q.lease_expires_at,'-infinity')<=clock_timestamp()))
  order by q.priority,q.created_at,q.id for update skip locked limit p_batch
 loop
  if j.attempt_count is null or j.max_attempts is null or j.max_attempts<1 or j.attempt_count>=j.max_attempts then
   update public.platform_jobs set status='dead_letter',dead_lettered_at=clock_timestamp(),
    failed_at=clock_timestamp(),lease_expires_at=null,error_code='slack_history_attempts_exhausted'
    where id=j.id;
  else
   update public.platform_jobs set status='running',claimed_by='learn-slack:'||p_worker::text,
    claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '180 seconds',
    attempt_count=j.attempt_count+1,last_attempt_at=clock_timestamp(),
    started_at=coalesce(started_at,clock_timestamp()) where id=j.id returning * into j;
   return next j;
  end if;
 end loop;
end $$;

-- The original validated source writer becomes private. There must be no
-- service-callable six-argument overload that can bypass ownership fencing.
alter function public.slack_history_commit_page(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 rename to learn_slack_commit_page_private;
revoke all on function public.learn_slack_commit_page_private(uuid,uuid,uuid,jsonb,jsonb,jsonb)
 from public,anon,authenticated,service_role;
create function public.slack_history_commit_page(
 p_tenant_id uuid,p_job_id uuid,p_account_id uuid,p_claimed_by text,p_attempt_count integer,
 p_expected jsonb,p_next jsonb,p_records jsonb
) returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;max_pages integer;receipt jsonb;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.history_sync'
  or p_claimed_by is null or j.claimed_by is distinct from p_claimed_by
  or p_attempt_count is null or j.attempt_count is distinct from p_attempt_count
  or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then
  raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_page_v1';
 if receipt is not null then
  -- Exact publication replay can resolve an uncertain HTTP response. A different
  -- page must run as a delayed successor, never a second page in this job.
  if receipt->>'account_id'=p_account_id::text and receipt->'expected'=p_expected and receipt->'next'=p_next
   and receipt->>'records_hash'=md5(p_records::text) then return true;end if;
  raise exception 'slack_page_already_committed' using errcode='PT409';
 end if;
 perform public.learn_slack_commit_page_private(p_tenant_id,p_job_id,p_account_id,p_expected,p_next,p_records);
 select (settings->'slack_history'->>'maxPages')::integer into max_pages
  from public.connector_accounts where id=p_account_id and tenant_id=p_tenant_id;
 receipt:=jsonb_build_object('account_id',p_account_id,'expected',p_expected,'next',p_next,
  'max_pages',max_pages,'records_hash',md5(p_records::text),'records_processed',jsonb_array_length(p_records),
  'committed_at',clock_timestamp());
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_page_v1',receipt) where id=j.id;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return true;
end $$;

create function public.learn_slack_finish_job(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,p_outcome jsonb
) returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;
 receipt jsonb;page jsonb;checkpoint jsonb;result_doc jsonb;successor uuid;account_id uuid;
 max_pages integer;stop_reason text;delay_seconds integer;next_status text;failure_code text;answer jsonb;
begin
 if current_user<>'service_role' then raise exception 'slack_queue_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_queue_snapshot' using errcode='22023';end if;
 if p_claimed_by is null or p_attempt_count is null or p_attempt_count<1 or jsonb_typeof(p_outcome) is distinct from 'object'
  or jsonb_typeof(p_outcome->'success') is distinct from 'boolean' then
  raise exception 'slack_queue_invalid' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.job_type<>'slack.history_sync' or j.claimed_by is distinct from p_claimed_by
  or j.attempt_count is distinct from p_attempt_count then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 receipt:=j.metadata->'slack_finish_v1';
 if j.status in ('succeeded','retrying','dead_letter') and receipt->>'claimed_by'=p_claimed_by
  and (receipt->>'attempt_count')::integer=p_attempt_count then
  if receipt->'outcome'=p_outcome then return receipt->'answer';end if;
  raise exception 'slack_queue_replay_conflict' using errcode='PT409';
 end if;
 if j.status<>'running' or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() then
  raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 if p_outcome->'success'='true'::jsonb then
  if p_outcome<>'{"success":true}'::jsonb then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  account_id:=(j.payload->>'connector_account_id')::uuid;
  if account_id is null or j.job_key is distinct from 'slack.history:'||account_id::text then
   raise exception 'slack_queue_identity' using errcode='22023';end if;
  select * into a from public.connector_accounts where id=account_id and tenant_id=p_tenant_id for share;
  if not found then raise exception 'slack_queue_identity' using errcode='22023';end if;
  page:=j.metadata->'slack_page_v1';
  if page is not null then
   if page->>'account_id' is distinct from account_id::text or page->'next' is distinct from a.sync_cursor then
    raise exception 'slack_queue_checkpoint_changed' using errcode='PT409';end if;
   checkpoint:=page->'next';max_pages:=(page->>'max_pages')::integer;
  else
   checkpoint:=a.sync_cursor;max_pages:=(a.settings->'slack_history'->>'maxPages')::integer;
   if checkpoint->'complete' is distinct from 'true'::jsonb and
    coalesce((checkpoint->>'pages')::integer,-1)<coalesce(max_pages,1) then
    raise exception 'slack_queue_page_missing' using errcode='PT409';end if;
  end if;
  if max_pages is null or max_pages not between 1 and 10 or
   jsonb_typeof(checkpoint->'pages') is distinct from 'number' or
   jsonb_typeof(checkpoint->'complete') is distinct from 'boolean' then
   raise exception 'slack_queue_checkpoint_invalid' using errcode='22023';end if;
  stop_reason:=case when checkpoint->'complete'='true'::jsonb then 'window_pages_complete'
   when (checkpoint->>'pages')::integer>=max_pages then 'page_budget_exhausted' else 'run_page_limit' end;
  -- Continuation remains subject to the stored consent and connector state. No
  -- token or caller-supplied continuation payload participates in this decision.
  if stop_reason='run_page_limit' and (a.status<>'active' or
   a.settings->'slack_history'->'approved' is distinct from 'true'::jsonb or
   coalesce((a.settings->'slack_history'->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp()
   or not exists(select 1 from public.tenant_connectors c where c.id=a.tenant_connector_id
    and c.tenant_id=p_tenant_id and c.enabled and c.status='active' and c.connector_id='slack')
   or not exists(select 1 from public.provider_connections c where c.id=(a.settings->'slack_history'->>'connectionId')::uuid
    and c.tenant_id=p_tenant_id and c.provider='slack' and c.status='configured' and c.revoked_at is null)) then
   stop_reason:='authorisation_changed';
  end if;
  result_doc:=checkpoint||jsonb_build_object('stopReason',stop_reason,'threadCoverage','unverified',
   'coverage','bounded_channel_history','ingestion_complete',false);
  update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,
   error_code=null,result=result_doc,records_processed=coalesce((page->>'records_processed')::integer,0) where id=j.id;
  if stop_reason='run_page_limit' then
   -- Failure here rolls back completion; replay cannot lose or duplicate the next page.
   insert into public.platform_jobs(tenant_id,connector_id,module_id,job_type,job_key,status,
    priority,max_attempts,available_at,parent_job_id,payload)
   values(j.tenant_id,j.connector_id,j.module_id,j.job_type,j.job_key,'queued',j.priority,j.max_attempts,
    greatest(clock_timestamp(),(page->>'committed_at')::timestamptz)+interval '60 seconds',j.id,j.payload)
   returning id into successor;
  end if;
  next_status:='succeeded';
 else
  if not p_outcome ?& array['success','code','retryable','retry_after_seconds'] or
   (select count(*) from jsonb_object_keys(p_outcome))<>4 or
   jsonb_typeof(p_outcome->'retryable') is distinct from 'boolean' or
   jsonb_typeof(p_outcome->'code') is distinct from 'string' or
   p_outcome->>'code' !~ '^slack_history_[a-z_]{1,80}$' or
   jsonb_typeof(p_outcome->'retry_after_seconds') is distinct from 'number' or
   p_outcome->>'retry_after_seconds' !~ '^[0-9]{1,8}$' then
   raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=(p_outcome->>'retry_after_seconds')::integer;
  if delay_seconds>31536000 then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  delay_seconds:=greatest(delay_seconds,case j.attempt_count when 1 then 60 when 2 then 300 when 3 then 900 else 3600 end);
  next_status:=case when p_outcome->'retryable'='true'::jsonb and j.attempt_count<j.max_attempts then 'retrying' else 'dead_letter' end;
  failure_code:=p_outcome->>'code';
  update public.platform_jobs set status=next_status,lease_expires_at=null,error_code=failure_code,
   error_count=coalesce(error_count,0)+1,failed_at=clock_timestamp(),
   available_at=case when next_status='retrying' then clock_timestamp()+make_interval(secs=>delay_seconds) else available_at end,
   dead_lettered_at=case when next_status='dead_letter' then clock_timestamp() else dead_lettered_at end where id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 answer:=jsonb_build_object('job_id',j.id,'status',next_status,'successor_id',successor);
 update public.platform_jobs set metadata=coalesce(metadata,'{}')||jsonb_build_object('slack_finish_v1',
  jsonb_build_object('claimed_by',p_claimed_by,'attempt_count',p_attempt_count,'outcome',p_outcome,'answer',answer)) where id=j.id;
 return answer;
end $$;

revoke all on function public.learn_slack_claim_jobs(uuid,integer),
 public.slack_history_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb),
 public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.learn_slack_claim_jobs(uuid,integer),
 public.slack_history_commit_page(uuid,uuid,uuid,text,integer,jsonb,jsonb,jsonb),
 public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb) to service_role;

-- SOURCE supabase/migrations/20261030110000_learn_slack_credential_binding.sql
-- SHA-256 727937cc01f04a38e854f5aea48455829e8f7cf31716b69da2674989feb3195c
-- Read an existing credential only for an owned, approved Slack job. This does
-- not create/rotate/revoke credentials, expose Vault to clients, or call Slack.

create function public.learn_slack_read_credential(
 p_tenant_id uuid,p_job_id uuid,p_claimed_by text,p_attempt_count integer,
 p_connection_id uuid,p_revision timestamptz,p_secret_id uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare j public.platform_jobs%rowtype;a public.connector_accounts%rowtype;cfg jsonb;secret text;begin
 if auth.role() is distinct from 'service_role' then raise exception 'slack_credential_forbidden' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'slack_credential_snapshot' using errcode='22023';end if;
 select * into j from public.platform_jobs where id=p_job_id and tenant_id=p_tenant_id for update;
 if not found or j.status<>'running' or j.job_type<>'slack.history_sync' or
  p_claimed_by is null or j.claimed_by is distinct from p_claimed_by or
  p_attempt_count is null or j.attempt_count is distinct from p_attempt_count or
  j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp() or j.metadata ? 'slack_page_v1' then return null;end if;
 select * into a from public.connector_accounts where id=(j.payload->>'connector_account_id')::uuid
  and tenant_id=p_tenant_id for share;
 if not found or a.status<>'active' then return null;end if;
 cfg:=a.settings->'slack_history';
 if cfg->'approved' is distinct from 'true'::jsonb or
  coalesce((cfg->>'expiresAt')::timestamptz,'-infinity')<=clock_timestamp() or
  (cfg->>'connectionId')::uuid is distinct from p_connection_id then return null;end if;
 perform 1 from public.tenant_connectors where id=a.tenant_connector_id and tenant_id=p_tenant_id
  and connector_id='slack' and enabled and status='active' for share;
 if not found then return null;end if;
 perform 1 from public.provider_connections where id=p_connection_id and tenant_id=p_tenant_id
  and provider='slack' and status='configured' and revoked_at is null and updated_at=p_revision
  and non_secret_config->>'team_id'=cfg->>'teamId' and 'bot_token'=any(configured_fields)
  and secret_refs->>'bot_token'=p_secret_id::text for share;
 if not found then return null;end if;
 -- Require both the stored reference and the existing broker's tenant-qualified
 -- name. A foreign/mismatched reference or a stale connection resolves nothing.
 select decrypted_secret into secret from vault.decrypted_secrets
  where id=p_secret_id and name='provider_secret:'||p_tenant_id::text||':slack:bot_token';
 if j.lease_expires_at<=clock_timestamp() then return null;end if;
 return secret;
end $$;
revoke all on function public.learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid)
 from public,anon,authenticated;
grant execute on function public.learn_slack_read_credential(uuid,uuid,text,integer,uuid,timestamptz,uuid) to service_role;

insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'learn_slack_durable_worker_v1','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
