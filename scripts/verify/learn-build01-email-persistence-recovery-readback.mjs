/** Counts-only independent LIVE readback of one reviewed Email recovery batch. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const [mode, batch] = process.argv.slice(2);
if (mode !== "--live-read-only" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(batch) ||
    process.argv.length !== 4)
  throw Error("Exact LIVE read-only mode and recovery batch required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with recovery as (
  select r.id,r.metadata->>'email_account_id' account_id,r.status,r.records_processed,
    r.completed_at
  from public.email_sync_runs r
  where r.tenant_id='${tenant}'::uuid and r.provider='gmail'
    and r.metadata->>'recovery_batch'='${batch}'
), states as (
  select r.id,r.status,r.records_processed,c.state checkpoint_state,
    c.block_code,c.owner_attempt_id,
    (select count(*)::int from public.email_ingestion_transitions x
      where x.tenant_id='${tenant}'::uuid and x.attempt_id=r.id
        and x.operation in ('claim','release')) transition_receipts,
    (select count(*)::int from public.email_sync_runs later
      where later.tenant_id='${tenant}'::uuid and later.provider='gmail'
        and later.sync_type='workspace_messages' and later.status='success'
        and later.metadata->>'email_account_id'=r.account_id
        and later.metadata->>'operator_recovery' is null
        and later.started_at>r.completed_at) ordinary_successes,
    (select max(later.completed_at) from public.email_sync_runs later
      where later.tenant_id='${tenant}'::uuid and later.provider='gmail'
        and later.sync_type='workspace_messages' and later.status='success'
        and later.metadata->>'email_account_id'=r.account_id
        and later.metadata->>'operator_recovery' is null
        and later.started_at>r.completed_at) last_ordinary_success_at
    ,(select coalesce(sum(later.records_processed),0)::int
      from public.email_sync_runs later
      where later.tenant_id='${tenant}'::uuid and later.provider='gmail'
        and later.sync_type='workspace_messages' and later.status='success'
        and later.metadata->>'email_account_id'=r.account_id
        and later.metadata->>'operator_recovery' is null
        and later.started_at>r.completed_at) ordinary_records_processed
    ,(select j.status from public.platform_jobs j
      where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
        and j.payload->>'email_account_id'=r.account_id
        and j.created_at>r.completed_at
      order by j.created_at desc limit 1) latest_job_status
    ,(select j.created_at from public.platform_jobs j
      where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
        and j.payload->>'email_account_id'=r.account_id
        and j.created_at>r.completed_at
      order by j.created_at desc limit 1) latest_job_created_at
  from recovery r left join public.email_ingestion_checkpoints c
    on c.tenant_id='${tenant}'::uuid and c.email_account_id::text=r.account_id
      and c.stream='recent'
)
select count(*)::int recovered_accounts,
  count(*) filter(where status='success' and records_processed=0
    and transition_receipts=2)::int audited_zero_work_recoveries,
  count(*) filter(where checkpoint_state='blocked')::int reblocked_accounts,
  count(*) filter(where owner_attempt_id is not null)::int currently_owned,
  count(*) filter(where ordinary_successes>0)::int ordinary_success_accounts,
  coalesce(sum(ordinary_successes),0)::int ordinary_success_runs,
  coalesce(sum(ordinary_records_processed),0)::int ordinary_records_processed,
  max(last_ordinary_success_at) latest_ordinary_success_at,
  (select coalesce(jsonb_object_agg(status,total),'{}'::jsonb) from (
    select coalesce(latest_job_status,'none') status,count(*)::int total
    from states group by coalesce(latest_job_status,'none')) job_states) latest_job_states,
  max(latest_job_created_at) latest_job_created_at,
  (select count(*)::int from public.email_ingestion_checkpoints c
    where c.tenant_id='${tenant}'::uuid and c.stream='recent'
      and c.state='blocked' and c.block_code='persistence_failed') total_persistence_holds
from states`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`LIVE recovery readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
    !Number.isInteger(rows[0].recovered_accounts) ||
    !Number.isInteger(rows[0].audited_zero_work_recoveries) ||
    !Number.isInteger(rows[0].ordinary_success_accounts))
  throw Error("LIVE recovery readback shape changed");
console.log(JSON.stringify({ project, batch, observedAt: new Date().toISOString(),
  ...rows[0], productionDataWrites: false, messageBodiesReturned: false }));
