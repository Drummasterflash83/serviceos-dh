/** Aggregate-only LIVE readback of the held-mailbox scheduler release. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const releasedAt = "2026-10-16T13:38:15Z";
const query = `select
  (select coalesce(jsonb_agg(x order by x.started_at desc),'[]'::jsonb)
   from (select started_at,status,records_processed,
      (metadata->>'held_recovery')::int held_recovery,
      (metadata->>'queued')::int queued,
      (metadata->>'known_ineligible')::int known_ineligible
     from public.email_sync_runs
     where tenant_id='${tenant}'::uuid and provider='gmail'
       and sync_type='workspace_scheduled_sync'
       and started_at>='${releasedAt}'::timestamptz
     order by started_at desc limit 8) x) scheduler,
  (select coalesce(jsonb_agg(y),'[]'::jsonb) from (
    select status,coalesce(error_code,'none') error_code,count(*)::int jobs
    from public.platform_jobs
    where tenant_id='${tenant}'::uuid and job_type='email.workspace_sync'
      and created_at>='${releasedAt}'::timestamptz
    group by status,coalesce(error_code,'none')) y) jobs_since_release,
  (select coalesce(jsonb_agg(z),'[]'::jsonb) from (
    select state,coalesce(block_code,'none') block_code,count(*)::int checkpoints
    from public.email_ingestion_checkpoints
    where tenant_id='${tenant}'::uuid and stream='recent'
    group by state,coalesce(block_code,'none')) z) checkpoint_states`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE held scheduler readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !Array.isArray(rows[0].scheduler) ||
    !Array.isArray(rows[0].jobs_since_release) || !Array.isArray(rows[0].checkpoint_states))
  throw Error("LIVE held scheduler response changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), releasedAt,
  ...rows[0], productionDataWrites: false, providerRequests: 0 }));
