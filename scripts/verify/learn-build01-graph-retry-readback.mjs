/** Aggregate-only LIVE Graph retry and throughput readback. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with jobs as (
  select status,coalesce(error_code,'none') error_code,attempt_count,
    records_processed,updated_at,case
    when last_error ilike '%timeout%' or last_error ilike '%timed out%'
      or last_error ilike '%57014%' or last_error ilike '%canceling statement%' then 'timeout'
    when last_error ilike '%connection%' then 'connection'
    when last_error ilike '%fetch failed%' or last_error ilike '%network%' then 'network'
    when last_error ilike '%rate limit%' then 'rate_limit'
    when last_error ilike '%too many%' then 'capacity'
    when last_error ilike '%duplicate key%' or last_error ilike '%23505%' then 'conflict'
    when last_error ilike '%400%' or last_error ilike '%500%'
      or last_error ilike '%502%' or last_error ilike '%503%' then 'http_error'
    when last_error ilike '%PGRST%' then 'postgrest'
    when last_error ilike '%permission%' then 'permission'
    when last_error is null then 'none' else 'other' end error_category,
    coalesce((result->>'nodes_upserted')::int,0) nodes_upserted,
    coalesce((result->>'failed')::int,0) node_failures
  from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type='graph.sync'
    and updated_at>=now()-interval '2 hours'
) select status,error_code,error_category,count(*)::int jobs,
  min(updated_at) first_at,max(updated_at) latest_at,
  max(attempt_count)::int max_attempts,
  coalesce(sum(records_processed),0)::bigint::text records_processed,
  coalesce(sum(nodes_upserted),0)::bigint::text nodes_upserted,
  coalesce(sum(node_failures),0)::bigint::text node_failures
  from jobs group by status,error_code,error_category
  order by status,error_code,error_category`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Graph retry readback failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 20 || rows.some(row =>
  typeof row.status !== "string" || !Number.isInteger(row.jobs)))
  throw Error("Graph retry readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, period: "last_two_hours", rows, productionDataWrites: false }));
