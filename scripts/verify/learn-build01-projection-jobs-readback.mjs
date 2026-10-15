/** Aggregate-only LIVE readback of unattended retained-input projection jobs. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select status,coalesce(error_code,'none') error_code,
  coalesce(payload->>'source','all') source,
  count(*)::int jobs,min(updated_at) first_at,max(updated_at) latest_at,
  max(attempt_count)::int max_attempts,
  coalesce(sum(records_processed),0)::bigint::text records_processed,
  coalesce(sum(case when (result->>'email_processed') ~ '^[0-9]+$'
    then (result->>'email_processed')::int else 0 end),0)::bigint::text email_processed,
  coalesce(max(case when (result->>'review_required') ~ '^[0-9]+$'
    then (result->>'review_required')::int else 0 end),0)::int max_reported_review_required,
  count(*) filter(where result->'continued'='true'::jsonb)::int continued_batches,
  coalesce(sum(case when (result->>'failed') ~ '^[0-9]+$'
    then (result->>'failed')::int else 0 end),0)::bigint::text source_failures
 from public.platform_jobs
 where tenant_id='${tenant}'::uuid and job_type='interactions.sync'
   and updated_at>=now()-interval '2 hours'
 group by status,error_code,source order by status,error_code,source`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Projection job readback failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 30 || rows.some(row =>
  typeof row.status !== "string" || !Number.isInteger(row.jobs)))
  throw Error("Projection job readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, period: "last_two_hours", rows, productionDataWrites: false }));
