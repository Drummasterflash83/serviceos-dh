/** Counts-only TEST/LIVE readback for ordinary bounded Graph and identity runs. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--test-read-only", "--live-read-only"].includes(mode))
  throw Error("Exact TEST or LIVE read-only mode required");
const project = mode === "--test-read-only" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select job_type,status,coalesce(error_code,'none') error_code,
  coalesce((payload->>'limit')::int,-1) requested_limit,
  count(*)::int jobs,min(created_at) first_created_at,
  max(updated_at) latest_update_at,
  max(attempt_count)::int max_attempts,
  coalesce(sum(records_processed),0)::bigint::text records_processed,
  coalesce(sum((result->>'nodes_upserted')::int),0)::bigint::text graph_nodes_upserted,
  coalesce(sum((result->>'resolved')::int),0)::bigint::text identities_resolved,
  coalesce(sum((result->>'reviews_recorded')::int),0)::bigint::text reviews_recorded
  from public.platform_jobs
  where tenant_id='${tenant}'::uuid
    and job_type in('identity.resolve','graph.sync')
    and updated_at>=now()-interval '30 minutes'
  group by job_type,status,coalesce(error_code,'none'),
    coalesce((payload->>'limit')::int,-1)
  order by job_type,status,error_code,requested_limit`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  },
);
if (!response.ok) throw Error(`Hosted batch readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 30 || rows.some(row =>
  !Number.isSafeInteger(row.jobs) || row.jobs < 0 ||
  !Number.isSafeInteger(row.requested_limit)))
  throw Error("Hosted batch readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, sourceContentReturned: false, identityReturned: false,
  productionDataWrites: false }));
