/** Read-only, content-free observation of the two pre-release LIVE fetch blocks. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with original as (
 select distinct x.email_account_id,x.result_generation,x.result_revision
 from public.email_ingestion_transitions x
 where x.tenant_id='${tenant}'::uuid and x.stream='recent'
   and x.operation='block' and x.result_revision in (759,777)
   and x.accepted_result->>'checkpoint_state'='blocked'
   and x.request_document#>>'{payload,error_code}'='fetch_failed'
), current_state as (
 select o.email_account_id,o.result_revision original_revision,
   c.revision current_revision,c.state,c.block_code,c.updated_at,
   (select count(*)::int from public.email_ingestion_transitions x
     where x.tenant_id='${tenant}'::uuid
       and x.email_account_id=o.email_account_id and x.stream='recent'
       and x.operation='claim' and x.result_generation=o.result_generation
       and x.result_revision>o.result_revision
       and x.accepted_result->>'automatic_recovery'='confirmed_zero_write_fetch_retry') automatic_claims,
   (select r.status from public.email_sync_runs r
     where r.tenant_id='${tenant}'::uuid
       and r.metadata->>'email_account_id'=o.email_account_id::text
       and r.sync_type='workspace_messages'
       and r.started_at>='2026-10-15T13:42:16Z'::timestamptz
     order by r.started_at desc limit 1) latest_run_status,
   (select r.error_message from public.email_sync_runs r
     where r.tenant_id='${tenant}'::uuid
       and r.metadata->>'email_account_id'=o.email_account_id::text
       and r.sync_type='workspace_messages'
       and r.started_at>='2026-10-15T13:42:16Z'::timestamptz
     order by r.started_at desc limit 1) latest_run_error
   ,(select j.status from public.platform_jobs j
     where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
       and j.payload->>'email_account_id'=o.email_account_id::text
     order by j.created_at desc limit 1) latest_job_status
   ,(select j.error_code from public.platform_jobs j
     where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
       and j.payload->>'email_account_id'=o.email_account_id::text
     order by j.created_at desc limit 1) latest_job_error
   ,(select j.created_at from public.platform_jobs j
     where j.tenant_id='${tenant}'::uuid and j.job_type='email.workspace_sync'
       and j.payload->>'email_account_id'=o.email_account_id::text
     order by j.created_at desc limit 1) latest_job_created_at
 from original o join public.email_ingestion_checkpoints c
   on c.tenant_id='${tenant}'::uuid and c.email_account_id=o.email_account_id
   and c.stream='recent'
)
select jsonb_build_object('targetCount',count(*),
  'automaticClaimCount',coalesce(sum(automatic_claims),0),
  'targets',coalesce(jsonb_agg(jsonb_build_object(
    'originalRevision',original_revision,'currentRevision',current_revision,
    'state',state,'blockCode',block_code,'automaticClaims',automatic_claims,
    'latestRunStatus',latest_run_status,'latestRunError',latest_run_error,
    'latestJobStatus',latest_job_status,'latestJobError',latest_job_error,
    'latestJobCreatedAt',latest_job_created_at,
    'checkpointUpdatedAt',updated_at) order by original_revision),'[]'::jsonb),
  'workspaceQueue',(select jsonb_build_object(
    'queued',count(*) filter(where j.status='queued'),
    'running',count(*) filter(where j.status='running'),
    'oldestQueuedAgeSeconds',max(extract(epoch from clock_timestamp()-j.created_at)::int)
      filter(where j.status='queued'))
    from public.platform_jobs j where j.tenant_id='${tenant}'::uuid
      and j.job_type='email.workspace_sync' and j.status in ('queued','running')),
  'latestScheduler',(select jsonb_build_object('status',r.status,
    'startedAt',r.started_at,'queued',r.metadata->>'queued',
    'duplicates',r.metadata->>'duplicates',
    'enqueueUnconfirmed',r.metadata->>'enqueue_unconfirmed',
    'knownIneligible',r.metadata->>'known_ineligible')
    from public.email_sync_runs r where r.tenant_id='${tenant}'::uuid
      and r.sync_type='workspace_scheduled_sync'
    order by r.started_at desc limit 1),
  'observedAt',clock_timestamp()) as observation from current_state`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!response.ok) throw Error(`LIVE safe-claim observation failed (HTTP ${response.status})`);
const rows = await response.json();
const observation = rows?.[0]?.observation;
if (!Array.isArray(rows) || rows.length !== 1 || observation?.targetCount !== 2 ||
  !Array.isArray(observation.targets) || observation.targets.length !== 2)
  throw Error("Original LIVE fetch-block identity changed");
console.log(JSON.stringify({ project, ...observation,
  productionDataWrites: false, customerRowsRead: false }));
