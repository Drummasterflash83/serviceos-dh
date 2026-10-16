/** Aggregate-only LIVE review of exact held Email persistence outcomes. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with holds as (
  select c.tenant_id,c.email_account_id,c.revision,c.updated_at,
    c.continuation->>'fetch_policy' fetch_policy,
    a.status account_status,m.status mailbox_status,m.sync_enabled,
    m.mailbox_type,m.directory_identity_conflict,
    r.started_at failed_at,r.error_message failed_code,
    r.metadata#>>'{email_ingestion_v2,evidence,classification}' classification,
    r.metadata#>>'{email_ingestion_v2,evidence,persistence}' persistence,
    r.metadata#>>'{email_ingestion_v2,evidence,message_upsert_count}' upserts,
    r.metadata#>>'{email_ingestion_v2,evidence,ids_seen}' ids_seen,
    x.request_document#>>'{payload,attempt_evidence,persistence}' transition_persistence,
    (select count(*)::int from public.email_sync_runs active
      where active.tenant_id=c.tenant_id and active.provider='gmail'
        and active.sync_type='workspace_messages' and active.status='running'
        and active.metadata->>'email_account_id'=c.email_account_id::text) running_attempts,
    (select min(active.started_at) from public.email_sync_runs active
      where active.tenant_id=c.tenant_id and active.provider='gmail'
        and active.sync_type='workspace_messages' and active.status='running'
        and active.metadata->>'email_account_id'=c.email_account_id::text) oldest_running_at
    ,(select count(*)::int from public.email_sync_runs active
      where active.tenant_id=c.tenant_id and active.provider='gmail'
        and active.sync_type='workspace_messages' and active.status='running'
        and active.started_at>now()-interval '1 hour'
        and active.metadata->>'email_account_id'=c.email_account_id::text) recent_running_attempts
    ,(select count(*)::int from public.platform_jobs job
      where job.tenant_id=c.tenant_id and job.job_type='email.workspace_sync'
        and job.status='running'
        and job.payload->>'email_account_id'=c.email_account_id::text) running_jobs
  from public.email_ingestion_checkpoints c
  join public.email_accounts a on a.tenant_id=c.tenant_id and a.id=c.email_account_id
  left join lateral (
    select status,sync_enabled,mailbox_type,directory_identity_conflict
    from public.google_workspace_mailboxes m
    where m.tenant_id=a.tenant_id and lower(m.email_address)=lower(a.email_address)
    order by m.updated_at desc limit 1
  ) m on true
  left join lateral (
    select started_at,error_message,metadata
    from public.email_sync_runs r
    where r.tenant_id=c.tenant_id and r.provider='gmail'
      and r.metadata->>'email_account_id'=c.email_account_id::text
      and r.error_message='persistence_failed'
    order by r.started_at desc limit 1
  ) r on true
  left join lateral (
    select request_document from public.email_ingestion_transitions x
    where x.tenant_id=c.tenant_id and x.email_account_id=c.email_account_id
      and x.stream='recent' and x.operation='block'
      and x.result_generation=c.generation and x.result_revision=c.revision
    order by x.result_revision desc limit 1
  ) x on true
  where c.tenant_id='${tenant}'::uuid and c.stream='recent'
    and c.state='blocked' and c.block_code='persistence_failed'
)
select coalesce(account_status,'missing') account_status,
  coalesce(mailbox_status,'missing') mailbox_status,
  coalesce(mailbox_type,'missing') mailbox_type,
  coalesce(sync_enabled,false) sync_enabled,
  coalesce(directory_identity_conflict,false) identity_conflict,
  coalesce(failed_code,'missing') failed_code,
  coalesce(classification,'missing') classification,
  coalesce(persistence,'missing') persistence,
  coalesce(upserts,'missing') upserts,
  coalesce(ids_seen,'missing') ids_seen,
  coalesce(transition_persistence,'missing') transition_persistence,
  coalesce(fetch_policy,'missing') fetch_policy,
  running_attempts,min(oldest_running_at) oldest_running_at,
  recent_running_attempts,running_jobs,
  count(*)::int holds,min(updated_at) oldest_hold_at,max(updated_at) newest_hold_at,
  max(failed_at) newest_failed_attempt_at
from holds
group by account_status,mailbox_status,mailbox_type,sync_enabled,
  identity_conflict,failed_code,classification,persistence,upserts,
  ids_seen,transition_persistence,fetch_policy,running_attempts,
  recent_running_attempts,running_jobs
order by holds desc,oldest_hold_at`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`LIVE Email hold readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || !rows.every((row) =>
  Number.isInteger(row.holds) && row.holds > 0))
  throw Error("LIVE Email hold readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  heldTotal: rows.reduce((sum, row) => sum + row.holds, 0), groups: rows,
  productionDataWrites: false, messageBodiesReturned: false }));
