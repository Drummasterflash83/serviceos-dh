-- Keep the exact Phone proof checks, but derive candidates from the latest
-- scheduled run and immutable successful settlement receipts. The previous reader
-- joined every historical run twice before LIMIT 1, causing cold-cache timeouts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.learn_phone_account_evidence(uuid,uuid)'::regprocedure))
    is distinct from '5f5450fa87b0459188c811807a966133'
 then raise exception 'phone_evidence_reader_changed';end if;
end$$;
create or replace function public.learn_phone_account_evidence(p_tenant uuid,p_account uuid)
returns jsonb language sql stable set search_path=pg_catalog as $$
 with account as (
  select a.*,c.id as connector from public.connector_accounts a join public.tenant_connectors c
   on c.id=a.tenant_connector_id and c.tenant_id=a.tenant_id
  where a.id=p_account and a.tenant_id=p_tenant and c.connector_id='simwood' and c.provider='simwood'
 ), latest_run as materialized (
  select r.* from public.phone_sync_runs r
  where r.tenant_id=p_tenant and r.provider='simwood' and r.sync_type='scheduled_sync'
   and r.metadata->>'connector_account_id'=p_account::text
   and r.metadata->>'provider_customer_id'=(select coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key) from account a)
  order by r.started_at desc,r.id desc limit 1
 ), settled_runs as materialized (
  select r.* from public.learn_phone_schedule_settlements s
  join account a on s.tenant_id=a.tenant_id and s.receipt->>'accountId'=a.id::text
   and s.receipt->>'outcome'='success'
  join lateral (select r.* from public.phone_sync_runs r
   where r.id=s.run_id and r.tenant_id=a.tenant_id
    and r.provider='simwood' and r.sync_type='scheduled_sync' and r.status='success'
    and r.metadata->>'connector_account_id'=a.id::text
    and r.metadata->>'provider_customer_id'=coalesce(nullif(btrim(a.settings->>'provider_customer_id'),''),a.account_key)
   limit 1) r on true
 ), candidate_runs as (
  select * from latest_run
  union all select * from settled_runs
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
    and q.connector_id='simwood' and q.attempt_count=1
    and q.payload->>'provider_customer_id'=r.metadata->>'provider_customer_id'
    and q.payload->>'from'=r.metadata->>'from' and q.payload->>'to'=r.metadata->>'to'
    and s.receipt->>'from'=r.metadata->>'from' and s.receipt->>'to'=r.metadata->>'to'
    and q.completed_at=r.completed_at
    and r.completed_at is not null and r.completed_at>=r.started_at
    and ((r.status='success' and q.status='succeeded' and s.receipt->'cursorAdvanced'='true'::jsonb)
     or (r.status='failed' and q.status='failed' and s.receipt->'cursorAdvanced'='false'::jsonb)
     or (r.status='paused' and q.status='cancelled' and s.receipt->'cursorAdvanced'='false'::jsonb)),false) as confirmed
  from account a join candidate_runs r on true
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
-- The original owner and restricted execute ACL are preserved by replacement.
commit;
