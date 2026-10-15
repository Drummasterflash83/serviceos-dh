/** Read-only LIVE observation of the exact audited mailbox recovery. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only observation required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with target as (
 select r.resource_id::uuid account_id,r.detail->>'checkpoint_generation' original_generation,
   (r.detail->>'checkpoint_revision')::bigint original_revision,r.created_at proof_at
 from public.audit_logs r where r.tenant_id='${tenant}'::uuid
   and r.action='learn.email.mailbox_source_probe_result'
   and r.resource_type='email_account' and r.status='success'
   and r.detail->>'code'='provider_verified'
 order by r.created_at desc,r.id desc limit 1
), observation as (
 select t.original_revision,t.proof_at,c.state,c.block_code,c.revision current_revision,
   (select count(*)::int from public.email_ingestion_transitions x
     where x.tenant_id='${tenant}'::uuid and x.email_account_id=t.account_id
       and x.operation='claim'
       and x.accepted_result->>'automatic_recovery'='confirmed_mailbox_profile_recovery') automatic_claims,
   (select jsonb_build_object('status',r.status,'error',r.error_message,
     'completedAt',r.completed_at,'recordsProcessed',r.records_processed)
     from public.email_sync_runs r where r.tenant_id='${tenant}'::uuid
       and r.sync_type='workspace_messages'
       and r.metadata->>'email_account_id'=t.account_id::text
     order by r.started_at desc,r.id desc limit 1) latest_run,
   (select jsonb_build_object('status',j.status,'lastError',j.last_error,
     'createdAt',j.created_at,'completedAt',j.completed_at,
     'availableAt',j.available_at,'priority',j.priority,'attempts',j.attempt_count,
     'queuedEarlier',(select count(*)::int from public.platform_jobs older
       where older.status='queued' and older.job_type='email.workspace_sync'
         and (older.available_at is null or older.available_at<=clock_timestamp())
         and (older.priority<j.priority or
           (older.priority=j.priority and older.created_at<j.created_at))))
     from public.platform_jobs j where j.tenant_id='${tenant}'::uuid
       and j.job_type='email.workspace_sync'
       and j.payload->>'email_account_id'=t.account_id::text
     order by j.created_at desc,j.id desc limit 1) latest_job
 from target t join public.email_ingestion_checkpoints c on c.tenant_id='${tenant}'::uuid
   and c.email_account_id=t.account_id and c.stream='recent'
)
select jsonb_build_object('targetCount',count(*),'cases',coalesce(jsonb_agg(
 jsonb_build_object('originalRevision',original_revision,'proofAt',proof_at,
   'state',state,'blockCode',block_code,'currentRevision',current_revision,
   'automaticClaims',automatic_claims,'latestRun',latest_run,'latestJob',latest_job)
 ),'[]'::jsonb),'observedAt',clock_timestamp()) observation from observation`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  redirect: "error", signal: AbortSignal.timeout(45000),
});
if (!response.ok) throw Error(`Recovery observation failed (${response.status})`);
const rows = await response.json();
const observation = rows?.[0]?.observation;
if (!Array.isArray(rows) || rows.length !== 1 ||
  observation?.targetCount !== 1 || !Array.isArray(observation.cases))
  throw Error("Exact audited mailbox observation unavailable");
console.log(JSON.stringify({ project, ...observation, productionDataWrites: false,
  customerContentReturned: false }));
