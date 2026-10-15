/** Read-only, aggregate LIVE job-failure diagnostic; emits no row IDs or payloads. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact read-only mode required");
const token = savedCliToken();
if (typeof token !== "string" || token.length < 20) throw Error("Existing management login required");
const query = `select job_type,status,coalesce(error_code,'none') error_code,
  count(*)::int jobs,min(updated_at) first_seen,max(updated_at) last_seen,
  coalesce(sum(records_processed),0)::bigint::text records_processed,
  max(attempt_count) max_attempts
from public.platform_jobs
where tenant_id='${tenant}'::uuid and job_type in
  ('email.workspace_sync','interactions.sync','identity.resolve','graph.sync','customer_card.sync')
  and updated_at>=now()-interval '2 hours'
group by job_type,status,coalesce(error_code,'none')
order by job_type,status,error_code`;
async function read(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`Read-only diagnostic failed (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Read-only diagnostic response changed");
  return rows;
}
const rows = await read(query);
const emailSourceHolds = await read(`select coalesce(a.status,'missing') account_state,
  coalesce(a.provider,'missing') provider,coalesce(m.status,'missing') mailbox_state,
  coalesce(m.mailbox_type,'missing') mailbox_type,
  count(*)::int jobs,count(distinct a.id)::int affected_accounts
from public.platform_jobs j
left join public.email_accounts a on a.tenant_id=j.tenant_id
  and a.id::text=j.payload->>'email_account_id'
left join lateral(select status,mailbox_type from public.google_workspace_mailboxes m
  where m.tenant_id=a.tenant_id and lower(m.email_address)=lower(a.email_address)
  order by m.updated_at desc limit 1) m on true
where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
  and j.status='dead_letter' and j.error_code='source_ineligible'
  and j.updated_at>=now()-interval '2 hours'
group by coalesce(a.status,'missing'),coalesce(a.provider,'missing'),
  coalesce(m.status,'missing'),coalesce(m.mailbox_type,'missing')
order by account_state,provider,mailbox_state,mailbox_type`);
const emailAttemptFailures = await read(`select case
    when r.error_message in ('sa_config_missing','sa_credentials_invalid',
      'admin_delegation_missing','scopes_missing','delegation_grant_invalid',
      'delegation_denied','history_expired','continuation_expired','pagination_no_progress',
      'fetch_failed','parse_failed','persistence_failed','checkpoint_conflict',
      'source_ineligible','unexpected_failure') then r.error_message
    else 'unclassified' end safe_code,count(*)::int attempts,
  max(coalesce(r.completed_at,r.started_at)) latest_at
from public.email_sync_runs r
where r.tenant_id='${tenant}'::uuid and r.provider='gmail' and r.status='failed'
  and r.started_at>=now()-interval '2 hours'
  and r.metadata->>'email_account_id' in (
    select distinct j.payload->>'email_account_id' from public.platform_jobs j
    where j.tenant_id=r.tenant_id and j.job_type='email.workspace_sync'
      and j.status='dead_letter' and j.error_code='source_ineligible'
      and j.updated_at>=now()-interval '2 hours')
group by safe_code order by safe_code`);
const emailAuthorityChecks = await read(`with held as (
  select distinct j.payload->>'email_account_id' account_id from public.platform_jobs j
  where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
    and j.status='dead_letter' and j.error_code='source_ineligible'
    and j.updated_at>=now()-interval '2 hours'
), authority as (
  select a.id,a.status account_state,a.auth_state,
    (select count(*) from public.google_workspace_mailboxes x
      where x.tenant_id=a.tenant_id and lower(x.email_address)=lower(a.email_address)) mailbox_matches,
    m.status mailbox_state,m.sync_enabled,m.directory_identity_conflict,
    c.status connection_state,
    lower(c.domain)=split_part(lower(a.email_address),'@',2) domain_matches,
    c.last_verified_at is not null and c.last_verified_at<=now()+interval '5 seconds' verification_current,
    c.service_account_email is not null and c.service_account_email<>'' service_account_bound
  from held h join public.email_accounts a on a.tenant_id='${tenant}'::uuid
    and a.id::text=h.account_id
  left join lateral(select * from public.google_workspace_mailboxes x
    where x.tenant_id=a.tenant_id and lower(x.email_address)=lower(a.email_address)
    order by x.updated_at desc limit 1) m on true
  left join public.google_workspace_connections c on c.tenant_id=a.tenant_id and c.id=m.connection_id
)
select count(*)::int affected_accounts,
  coalesce(bool_and(account_state='active_dwd'),false) account_active,
  coalesce(bool_and(mailbox_matches=1),false) unique_mailbox,
  coalesce(bool_and(mailbox_state in('pending','active') and sync_enabled=true
    and directory_identity_conflict is not true),false) mailbox_eligible,
  coalesce(bool_and(connection_state='active'),false) connection_active,
  coalesce(bool_and(domain_matches),false) domain_matches,
  coalesce(bool_and(verification_current),false) connection_verified,
  coalesce(bool_and(service_account_bound),false) service_account_bound
from authority`);
const emailCheckpointHolds = await read(`select c.stream,c.state,
  coalesce(c.block_code,'none') block_code,count(*)::int checkpoints,
  max(c.updated_at) latest_at
from public.email_ingestion_checkpoints c
where c.tenant_id='${tenant}'::uuid and c.email_account_id::text in (
  select distinct j.payload->>'email_account_id' from public.platform_jobs j
  where j.tenant_id=c.tenant_id and j.job_type='email.workspace_sync'
    and j.status='dead_letter' and j.error_code='source_ineligible'
    and j.updated_at>=now()-interval '2 hours')
group by c.stream,c.state,coalesce(c.block_code,'none')
order by c.stream,c.state,block_code`);
const emailBlockedAttempt = await read(`select
  case when r.metadata#>>'{email_ingestion_v2,evidence,classification}' in
    ('provider_expired','pagination_cycle','fetch_failure','parse_failure',
      'persistence_failure','checkpoint_conflict','source_ineligible','unexpected_failure')
    then r.metadata#>>'{email_ingestion_v2,evidence,classification}' else 'unclassified' end classification,
  case when r.metadata#>>'{email_ingestion_v2,evidence,persistence}' in ('confirmed','unknown')
    then r.metadata#>>'{email_ingestion_v2,evidence,persistence}' else 'unclassified' end persistence,
  coalesce((r.metadata#>>'{email_ingestion_v2,evidence,message_upsert_count}')::int,0) message_upserts,
  coalesce((r.metadata#>>'{email_ingestion_v2,evidence,ids_seen}')::int,0) ids_seen,
  r.completed_at
from public.email_sync_runs r
where r.tenant_id='${tenant}'::uuid and r.provider='gmail' and r.status='failed'
  and r.error_message='persistence_failed'
  and r.metadata->>'email_account_id' in (
    select distinct j.payload->>'email_account_id' from public.platform_jobs j
    where j.tenant_id=r.tenant_id and j.job_type='email.workspace_sync'
      and j.status='dead_letter' and j.error_code='source_ineligible'
      and j.updated_at>=now()-interval '2 hours')
order by r.completed_at desc limit 1`);
console.log(JSON.stringify({ observedAt: new Date().toISOString(), scope: "last_two_hours", rows,
  emailSourceHolds,emailAttemptFailures,emailAuthorityChecks,emailCheckpointHolds,emailBlockedAttempt }));
