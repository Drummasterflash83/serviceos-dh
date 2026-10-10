-- Operator-only scheduled Phone capture evidence and company-wide processing
-- counts. Original content, credentials, provider identifiers and errors stay private.
begin;
-- Reuse the existing retry selector safely from the restricted operator context.
-- Only qualify its dependencies; retry semantics and existing grants are retained.
create or replace function public.phone_pending_readiness(p_tenant_id uuid)
returns table(recording_id uuid, stage text, sort_at timestamptz, retry_state text)
language sql stable set search_path=pg_catalog as $$
  select s.id, s.stage, s.sort_at,
    public.phone_retry_state(s.stage, coalesce(r.runs,'[]'::jsonb), now())
  from public.phone_recording_pipeline_state s
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'status', x.status, 'started_at', x.started_at,
      'failed_step', x.metadata->>'failed_step',
      'error_code', x.metadata->>'error_code'
    ) order by x.started_at desc) runs
    from (
      select status, started_at, metadata from public.phone_sync_runs
      where tenant_id = s.tenant_id and sync_type = 'pipeline'
        and metadata->>'recording_id' = s.id::text
      order by started_at desc limit 5
    ) x
  ) r on true
  where s.tenant_id = p_tenant_id and s.is_incomplete;
$$;

create index learn_phone_schedule_health_lookup on public.phone_sync_runs
 (tenant_id,(metadata->>'connector_account_id'),started_at desc,id desc)
 where provider='simwood' and sync_type='scheduled_sync';

create function public.learn_phone_account_evidence(p_tenant uuid,p_account uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
 with account as (
  select a.*,c.id as connector from public.connector_accounts a join public.tenant_connectors c
   on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id
  where a.id=p_account and a.tenant_id=p_tenant and c.connector_id='simwood' and c.provider='simwood'
 ), attempts as not materialized (
  select r.*,s.receipt,q.id as job_id,q.status as job_status,q.lease_expires_at,
   coalesce(q.status='running' and q.claimed_by=r.metadata->>'job_owner' and q.attempt_count=1 and q.lease_expires_at>now()
    and q.connector_id='simwood' and q.payload->>'provider_customer_id'=r.metadata->>'provider_customer_id'
    and q.payload->>'from'=r.metadata->>'from' and q.payload->>'to'=r.metadata->>'to'
    and r.metadata->>'tenant_connector_id'=a.connector::text
    and r.metadata->'include_local'=to_jsonb(coalesce(a.settings->'include_local_calls'='true'::jsonb,false)),false) as ownership_current,
   coalesce(s.tenant_id=p_tenant and s.receipt->>'version'='learn-phone-schedule/1'
    and s.receipt->>'tenantId'=p_tenant::text and s.receipt->>'runId'=r.id::text
    and s.receipt->>'accountId'=a.id::text and s.receipt->>'connectorId'=a.connector::text
    and s.receipt->>'customerId'=coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key)
    and r.metadata->>'tenant_connector_id'=a.connector::text
    and r.metadata->'include_local'=to_jsonb(coalesce(a.settings->'include_local_calls'='true'::jsonb,false))
    and s.receipt->>'outcome'=r.status and s.receipt->>'jobId'=q.id::text
    and r.completed_at is not null and r.completed_at>=r.started_at
    and ((r.status='success' and q.status='succeeded' and s.receipt->'cursorAdvanced'='true'::jsonb)
     or (r.status='failed' and q.status='failed' and s.receipt->'cursorAdvanced'='false'::jsonb)
     or (r.status='paused' and q.status='cancelled' and s.receipt->'cursorAdvanced'='false'::jsonb)),false) as confirmed
  from account a join public.phone_sync_runs r on r.tenant_id=a.tenant_id and r.provider='simwood' and r.sync_type='scheduled_sync'
   and r.metadata->>'connector_account_id'=a.id::text
   and r.metadata->>'provider_customer_id'=coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key)
  left join public.learn_phone_schedule_settlements s on s.run_id=r.id and s.tenant_id=r.tenant_id
  left join public.platform_jobs q on q.id=case when r.metadata->>'job_id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (r.metadata->>'job_id')::uuid end
   and q.tenant_id=r.tenant_id and q.job_type='phone.scheduled_sync'
 ), latest as (select * from attempts order by started_at desc,id desc limit 1),
 successful as (select * from attempts where confirmed and status='success' order by started_at desc,id desc limit 1)
 select jsonb_build_object('version','learn-phone-account-evidence/1','tenant_id',p_tenant,'account_id',p_account,
  'scope','scheduled_capture','capture_allowed',public.learn_capture_allowed(p_tenant,'phone'),
  'latest_attempt',(select jsonb_build_object('id',id,'status',case when status in ('running','success','failed','paused') then status else 'unknown' end,
   'started_at',started_at,'completed_at',completed_at,'confirmed',confirmed,
   'job',case when job_id is null then null else jsonb_build_object('id',job_id,'status',case when job_status in ('queued','running','retrying','succeeded','failed','dead_letter','cancelled') then job_status else 'unknown' end,
    'lease_expires_at',lease_expires_at,'ownership_current',ownership_current) end) from latest),
  'last_confirmed',(select jsonb_build_object('id',id,'completed_at',completed_at,'from',receipt->>'from','to',receipt->>'to',
   'calls_processed',receipt->'callsProcessed','recordings_processed',receipt->'recordingsProcessed') from successful));
$$;
revoke all on function public.learn_phone_account_evidence(uuid,uuid) from public,anon,authenticated,service_role;

create function public.learn_phone_processing_evidence(p_tenant uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
 with source as materialized (select * from public.phone_recording_pipeline_state where tenant_id=p_tenant),
 readiness as materialized (select * from public.phone_pending_readiness(p_tenant)),
 counts as (select count(*)::int as total,count(*) filter(where s.stage='complete')::int as complete,
  count(*) filter(where s.stage='download')::int as download_pending,
  count(*) filter(where s.stage='transcribe')::int as transcribe_pending,
  count(*) filter(where s.stage='analyse')::int as analyse_pending,
  count(*) filter(where r.retry_state='needs_review')::int as needs_review,
  count(*) filter(where r.retry_state='cooldown')::int as cooling_down,
  count(*) filter(where r.retry_state='in_progress')::int as recent_processing,
  count(*) filter(where r.retry_state='ready' and (s.stage<>'download' or (s.has_provider_id and s.sort_at<=now()-interval '120 seconds')))::int as ready,
  count(*) filter(where r.retry_state='ready' and s.stage='download' and (not s.has_provider_id or s.sort_at>now()-interval '120 seconds'))::int as waiting_provider,
  count(*) filter(where s.is_incomplete and (r.retry_state is null or r.retry_state not in ('needs_review','cooldown','in_progress','ready')))::int as unknown_retry
  from source s left join readiness r on r.recording_id=s.id)
 select jsonb_build_object('version','learn-phone-processing-evidence/1','tenant_id',p_tenant,'scope','company')||to_jsonb(counts) from counts;
$$;
revoke all on function public.learn_phone_processing_evidence(uuid) from public,anon,authenticated,service_role;

create or replace function public.learn_operator_capture_health(p_tenant uuid,p_after text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare rows jsonb;more boolean;last_key text;begin
 perform public.learn_operator_input_access(p_tenant,auth.uid(),false);
 if p_after is not null and p_after!~'^(email|phone|slack):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
  raise exception 'learn_operator_health_cursor_invalid' using errcode='22023';end if;
 with candidates as (
  select 'email:'||a.id::text as key,jsonb_build_object(
   'id',a.id,'source','email','provider',case when a.provider='gmail' and a.status in ('active_dwd','pending_tokenless_dwd') then 'google_workspace' when a.provider in ('gmail','google_workspace') then a.provider else 'other_email' end,
   'label',left(coalesce(nullif(a.display_name,''),'Mailbox'),120),
   'enabled',null,'account_state',case when a.status in ('active','active_dwd','pending_tokenless_dwd','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state',case when a.status in ('active_dwd','pending_tokenless_dwd') or a.provider='google_workspace' then 'unknown' when a.auth_state in ('ok','expired','revoked','needs_reconnect') then a.auth_state else 'unknown' end,
   'last_success_at',greatest(a.last_incremental_success_at,case when er.status='success' and er.completed_at>=er.started_at then er.completed_at end),
   'last_attempt_at',greatest(a.last_incremental_attempt_at,er.started_at),
   'last_failure_at',greatest(
    case when a.last_sync_error is not null and a.last_incremental_attempt_at>=coalesce(a.last_incremental_success_at,'-infinity') then a.last_incremental_attempt_at end,
    case when er.status='failed' then coalesce(er.completed_at,er.started_at)
     when er.status='success' and (er.completed_at is null or er.completed_at<er.started_at) then er.started_at end),
   'latest_job',null,'bounded_complete',null) as row
  from public.email_accounts a
  left join lateral (
   select r.status,r.started_at,r.completed_at from public.email_sync_runs r
   where a.provider in ('gmail','google_workspace') and r.tenant_id=a.tenant_id
    and r.metadata->>'email_account_id'=a.id::text and r.provider='gmail'
    and r.sync_type in ('messages','workspace_messages')
    and r.sync_type=case when a.provider='google_workspace' or a.status in ('active_dwd','pending_tokenless_dwd') then 'workspace_messages' else 'messages' end
    and r.status in ('success','failed')
   order by r.started_at desc,r.id desc limit 1
  ) er on true
  where a.tenant_id=p_tenant
  union all
  select (case when tc.connector_id='slack' then 'slack:' else 'phone:' end)||a.id::text as key,jsonb_build_object(
   'id',a.id,'source',case when tc.connector_id='slack' then 'slack' else 'phone' end,'provider',tc.connector_id,
   'label',left(coalesce(nullif(a.display_name,''),case when tc.connector_id='slack' then 'Slack channel' else 'Phone account' end),120),
   'enabled',tc.enabled and (case when tc.connector_id='slack' then tc.status='active' else tc.status in ('active','error') end),
   'account_state',case when a.status in ('active','disabled','paused','revoked') then a.status else 'unknown' end,
   'auth_state','unknown','last_success_at',a.last_successful_sync_at,'last_attempt_at',null,'last_failure_at',a.last_failed_sync_at,
   'latest_job',case when j.id is null then null else jsonb_build_object('id',j.id,
    'status',case when j.status in ('queued','running','retrying','succeeded','dead_letter','cancelled') then j.status else 'unknown' end,
    'available_at',j.available_at,'lease_expires_at',j.lease_expires_at,'completed_at',j.completed_at) end,
   'phone_evidence',case when tc.connector_id='simwood' then public.learn_phone_account_evidence(p_tenant,a.id) else null end,
   'bounded_complete',case when tc.connector_id='slack' then coalesce(
    j.status='succeeded' and j.completed_at is not null
    and j.result->>'stopReason'='window_pages_complete'
    and j.result->'complete'='true'::jsonb and a.sync_cursor->'complete'='true'::jsonb
    and jsonb_typeof(a.sync_cursor->'scopeKey')='string' and a.sync_cursor->>'scopeKey'<>''
    and j.result->'scopeKey'=a.sync_cursor->'scopeKey'
    and j.result->'pages'=a.sync_cursor->'pages',false) else null end) as row
  from public.connector_accounts a join public.tenant_connectors tc on tc.id=a.tenant_connector_id and tc.tenant_id=a.tenant_id
  left join lateral(select q.id,q.status,q.available_at,q.lease_expires_at,q.completed_at,q.result from public.platform_jobs q
   where tc.connector_id='slack' and q.tenant_id=p_tenant and q.job_type='slack.history_sync' and q.payload->>'connector_account_id'=a.id::text
   order by q.created_at desc,q.id desc limit 1) j on true
  where a.tenant_id=p_tenant and ((tc.connector_id='simwood' and tc.provider='simwood') or (tc.connector_id='slack' and tc.provider='slack'))
 ), bounded as (select * from candidates where p_after is null or key>p_after order by key limit 51), page as (select * from bounded order by key limit 50)
 select coalesce((select jsonb_agg(row||jsonb_build_object('key',key) order by key) from page),'[]'),
  (select count(*)>50 from bounded),(select key from page order by key desc limit 1) into rows,more,last_key;
 return jsonb_build_object('version','learn-operator-capture-health/1','tenant_id',p_tenant,'checked_at',clock_timestamp(),'phone_processing',public.learn_phone_processing_evidence(p_tenant),'rows',rows,'next_cursor',case when more then last_key else null end);
end $$;
revoke all on function public.learn_operator_capture_health(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.learn_operator_capture_health(uuid,text) to authenticated;
commit;
