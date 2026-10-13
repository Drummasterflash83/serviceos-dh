begin;
set local search_path=pg_catalog;set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'b40a4549a11381913bbe0f4e89a74c3b2c296f9cb69bd2efada031cd97b72dd1' then raise exception 'Exact continuation release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure) is distinct from '1858a7e3b1714fbd4ccf35208ac9fd5d|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure) is distinct from '383ee9a76dee87a499e43f69df1480f4|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_claim_allowed(uuid,uuid)'::regprocedure) is distinct from 'e06723e3b884bbf56e38efdb86e0c2ab|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
end$guard$;
CREATE OR REPLACE FUNCTION public.learn_slack_finish_job(p_tenant_id uuid, p_job_id uuid, p_claimed_by text, p_attempt_count integer, p_outcome jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
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
 if j.payload ? 'source_replay_id' and p_outcome->'success'='true'::jsonb then
  if p_outcome<>'{"success":true}'::jsonb then raise exception 'slack_queue_invalid' using errcode='22023';end if;
  page:=j.metadata->'slack_page_v1';
  if page is null then raise exception 'slack_queue_page_missing' using errcode='PT409';end if;
  if page->>'kind' is distinct from 'source_replay' or page->>'replay_id' is distinct from j.payload->>'source_replay_id'
   or page->>'account_id' is distinct from j.payload->>'connector_account_id'
   or page->>'state' not in('exact_source_verified','source_unavailable','source_changed')
   or j.job_key is distinct from 'slack.source-replay:'||(j.payload->>'source_replay_id')
  then raise exception 'slack_queue_identity' using errcode='PT409';end if;
  result_doc:=jsonb_build_object('coverage','one_retained_source_revalidation','state',page->>'state','replayId',page->>'replay_id','ingestion_complete',false);
  next_status:='succeeded';
  update public.platform_jobs set status='succeeded',completed_at=clock_timestamp(),lease_expires_at=null,error_code=null,result=result_doc,
   records_processed=(page->>'records_processed')::integer where id=j.id;
 elsif p_outcome->'success'='true'::jsonb then
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
    greatest(clock_timestamp(),(page->>'committed_at')::timestamptz)+make_interval(secs=>public.learn_slack_job_cooldown(j)),j.id,j.payload)
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

 -- Shared workspace pacing is infrastructure-only. Ownership and unexpired
 -- lease were verified above. No caller-supplied team or budget participates.
 if j.metadata->'slack_workspace_v1'->>'teamId' is not null then
  perform pg_advisory_xact_lock(hashtextextended('learn-slack-workspace:'||(j.metadata->'slack_workspace_v1'->>'teamId'),0));
  update public.slack_workspace_pacing set
   blocked_until=case when p_outcome->>'code'='slack_history_rate_limited' then greatest(blocked_until,clock_timestamp()+make_interval(secs=>greatest(60,(p_outcome->>'retry_after_seconds')::integer))) else blocked_until end,
   next_allowed_at=greatest(clock_timestamp()+make_interval(secs=>public.learn_slack_job_cooldown(j)),blocked_until,
    case when p_outcome->>'code'='slack_history_rate_limited' then clock_timestamp()+make_interval(secs=>greatest(60,(p_outcome->>'retry_after_seconds')::integer)) else '-infinity'::timestamptz end),
   active_job_id=null,last_finished_at=clock_timestamp()
   where team_id=j.metadata->'slack_workspace_v1'->>'teamId' and active_job_id=j.id;
 end if;
 if j.lease_expires_at<=clock_timestamp() then raise exception 'slack_queue_not_owned' using errcode='PT409';end if;
 return answer;
end $function$
;
do $guard$begin
if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz' or current_setting('serviceos.release_sha256',true) is distinct from 'b40a4549a11381913bbe0f4e89a74c3b2c296f9cb69bd2efada031cd97b72dd1' then raise exception 'Exact continuation release target/source/role required';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure) is distinct from '311290e85ab8c30b9e81079a71156fc5|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_job_allowed(uuid,uuid)'::regprocedure) is distinct from '383ee9a76dee87a499e43f69df1480f4|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_claim_allowed(uuid,uuid)'::regprocedure) is distinct from 'e06723e3b884bbf56e38efdb86e0c2ab|postgres|{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
if (select md5(pg_get_functiondef(p.oid))||'|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'NULL') from pg_proc p where p.oid='public.learn_slack_campaign_recover_page(uuid,uuid,jsonb,text)'::regprocedure) is distinct from '29fc3bba92be4e9346dc49cc3ef9fe65|postgres|{postgres=X/postgres}' then raise exception 'Reviewed continuation function/access differs';end if;
end$guard$;
notify pgrst,'reload schema';
commit;
