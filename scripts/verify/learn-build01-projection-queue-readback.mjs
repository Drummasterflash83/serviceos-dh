/** Aggregate/status-only LIVE readback of Build 01 Email projection recovery. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
async function read(name, query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  if (!response.ok) throw Error(`${name} readback failed (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error(`${name} readback shape changed`);
  return rows;
}
const jobs = await read("jobs", `select payload->>'source' source,payload->>'lane' lane,
  payload->>'limit' batch_limit,status,error_code,attempt_count,max_attempts,
  created_at,updated_at,available_at,lease_expires_at,records_processed,
  coalesce((result->>'email_selected')::int,0) email_selected,
  coalesce((result->>'email_processed')::int,0) email_processed,
  coalesce((result->>'reviews_recorded')::int,0) reviews_recorded,
  coalesce((result->>'failed')::int,0) source_failures
from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='interactions.sync'
order by created_at desc,id desc limit 12`);
const active = await read("active", `select payload->>'source' source,payload->>'lane' lane,
  payload->>'limit' batch_limit,status,error_code,
  attempt_count,max_attempts,created_at,updated_at,available_at,lease_expires_at,
  coalesce((result->>'email_selected')::int,0) email_selected,
  coalesce((result->>'email_processed')::int,0) email_processed,
  coalesce((result->>'reviews_recorded')::int,0) reviews_recorded,
  coalesce((result->>'failed')::int,0) source_failures
from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='interactions.sync' and status in('queued','running','retrying')
order by created_at asc limit 12`);
const summary = await read("summary", `select
  (select count(*)::int from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='interactions.sync'
    and status in('queued','running','retrying')) active_projection_jobs,
  (select count(*)::int from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='interactions.sync' and payload->>'source'='email'
    and created_at>=clock_timestamp()-interval '1 hour') email_jobs_last_hour,
  (select max(created_at) from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='interactions.sync' and payload->>'source'='email') latest_email_job_at,
  (select count(*)::int from public.email_messages m where m.tenant_id='${tenant}'::uuid
    and not coalesce(m.provider='gmail' and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
    and not exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id
      and i.source_table='email_messages' and i.source_id=m.id)) eligible_email_without_interaction,
  (select count(*)::int from public.email_messages m where m.tenant_id='${tenant}'::uuid
    and m.created_at>=clock_timestamp()-interval '1 hour'
    and exists(select 1 from public.interactions i where i.tenant_id=m.tenant_id
      and i.source_table='email_messages' and i.source_id=m.id)) recent_captured_email_linked,
  (select count(*)::int from public.learn_interaction_projection_receipts r
    where r.tenant_id='${tenant}'::uuid and r.source_kind='email'
      and r.created_at>=clock_timestamp()-interval '1 hour') email_receipts_last_hour,
  (select count(*)::int from public.learn_interaction_projection_receipts r
    where r.tenant_id='${tenant}'::uuid and r.source_kind='email'
      and r.receipt->>'state'='review_required'
      and r.created_at>=clock_timestamp()-interval '1 hour') email_review_receipts_last_hour`);
if (jobs.length > 12 || active.length > 12 || summary.length !== 1 || !summary[0] ||
  !Object.entries(summary[0]).every(([key,value]) => key === "latest_email_job_at"
    ? value === null || Number.isFinite(Date.parse(value))
    : Number.isSafeInteger(value) && value >= 0) ||
  [...jobs,...active].some((job) => !job || !["queued", "running", "retrying", "succeeded",
    "failed", "dead_letter", "cancelled"].includes(job.status) ||
    !Number.isSafeInteger(job.attempt_count) || !Number.isSafeInteger(job.max_attempts)))
  throw Error("Projection queue readback shape changed");
console.log(JSON.stringify({ version: "learn-build01-projection-queue/1",
  observedAt: new Date().toISOString(), jobs, active, summary: summary[0],
  sourceProviderRequests: 0, productionDataWrites: false,
  scope: "Operational status only; no message content or source IDs." }));
