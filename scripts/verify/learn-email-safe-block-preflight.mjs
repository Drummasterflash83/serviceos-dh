/** Aggregate-only evidence for existing blocked Workspace fetch checkpoints. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with candidates as (
 select c.revision,c.updated_at,
   extract(epoch from clock_timestamp()-c.updated_at)::int age_seconds,
   (select count(*)::int from public.email_sync_runs prior
     where prior.tenant_id=c.tenant_id and prior.provider='gmail'
       and prior.sync_type='workspace_messages' and prior.status='failed'
       and prior.error_message='fetch_failed'
       and prior.metadata->>'email_account_id'=c.email_account_id::text
       and prior.completed_at>clock_timestamp()-interval '2 hours') prior_failures_2h,
   exists(select 1 from public.email_sync_runs r
     join public.email_ingestion_transitions x on x.tenant_id=r.tenant_id
       and x.attempt_id=r.id and x.email_account_id=c.email_account_id
       and x.stream='recent' and x.operation='block'
       and x.result_generation=c.generation and x.result_revision=c.revision
     where r.tenant_id=c.tenant_id and r.provider='gmail'
       and r.sync_type='workspace_messages' and r.status='failed'
       and r.error_message='fetch_failed'
       and r.metadata->>'email_account_id'=c.email_account_id::text
       and abs(extract(epoch from r.completed_at-c.updated_at))<=1
       and r.metadata#>>'{email_ingestion_v2,evidence,persistence}'='confirmed'
       and r.metadata#>>'{email_ingestion_v2,evidence,classification}'='fetch_failure'
       and r.metadata#>>'{email_ingestion_v2,evidence,message_upsert_count}'='0'
       and r.metadata#>>'{email_ingestion_v2,evidence,thread_upsert_count}'='0'
       and r.metadata#>>'{email_ingestion_v2,evidence,ids_seen}'='0'
       and r.metadata#>>'{email_ingestion_v2,evidence,gone_count}'='0'
       and x.accepted_result->>'checkpoint_state'='blocked') prior_failure_proven,
   exists(select 1 from public.email_accounts a where a.tenant_id=c.tenant_id
     and a.id=c.email_account_id and a.provider='gmail' and a.status='active_dwd'
     and (select count(*) from public.google_workspace_mailboxes m
       join public.google_workspace_connections g on g.tenant_id=m.tenant_id
         and g.id=m.connection_id
       where m.tenant_id=a.tenant_id
         and lower(m.email_address)=lower(a.email_address)
         and m.status in ('pending','active') and m.sync_enabled=true
         and m.directory_identity_conflict is not true and g.status='active'
         and lower(g.domain)=split_part(lower(a.email_address),'@',2)
         and g.last_verified_at is not null)=1) source_authority_current
 from public.email_ingestion_checkpoints c
 where c.tenant_id='${tenant}'::uuid and c.stream='recent'
   and c.state='blocked' and c.block_code='fetch_failed'
   and c.owner_attempt_id is null
)
select jsonb_build_object('blocked',count(*),'allPriorFailuresProven',
  coalesce(bool_and(prior_failure_proven),false),'allSourceAuthorityCurrent',
  coalesce(bool_and(source_authority_current),false),'eligibleAfterCooldown',
  count(*) filter(where age_seconds>=300 and prior_failures_2h<2
    and prior_failure_proven and source_authority_current),
  'revisions',coalesce(jsonb_agg(jsonb_build_object('revision',revision,
    'ageSeconds',age_seconds,'failuresInTwoHours',prior_failures_2h,
    'priorFailureProven',prior_failure_proven,
    'sourceAuthorityCurrent',source_authority_current)
    order by revision),'[]'::jsonb),'observedAt',clock_timestamp()) as status
from candidates`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" },
  body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
});
if (!response.ok) throw Error(`Blocked Workspace preflight failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.status)
  throw Error("Blocked Workspace preflight shape changed");
console.log(JSON.stringify({ project, ...rows[0].status,
  customerRowsRead: false, productionDataWrites: false }));
