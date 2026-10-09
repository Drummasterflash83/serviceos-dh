-- Add thread jobs to the existing bounded Slack executor. No schedule or import.
begin;
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
commit;
