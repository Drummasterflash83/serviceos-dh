-- Slack-only durable execution on the existing queue. No schedules, credentials,
-- source deletion or activation. Deploy together with the fenced Slack worker.
begin;

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
commit;
