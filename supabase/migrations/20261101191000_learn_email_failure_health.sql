-- Operator-only safe mailbox failure diagnostics; no raw provider errors.
-- Replace the latest health reader without changing its owner or ACL.
begin;
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
   'email_failure',case when er.status='failed' then jsonb_build_object('attempt_id',er.id,
    'occurred_at',coalesce(er.completed_at,er.started_at),'code',case when er.error_message=any(array['sa_config_missing','sa_credentials_invalid','admin_delegation_missing','scopes_missing','delegation_grant_invalid','delegation_denied','history_expired','continuation_expired','pagination_no_progress','fetch_failed','parse_failed','persistence_failed','checkpoint_conflict','source_ineligible','unexpected_failure']) then er.error_message else 'capture_failed' end) else null end,
   'latest_job',null,'bounded_complete',null) as row
  from public.email_accounts a
  left join lateral (
   select r.id,r.status,r.started_at,r.completed_at,r.error_message from public.email_sync_runs r
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
commit;
