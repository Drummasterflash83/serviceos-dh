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
  ('interactions.sync','identity.resolve','graph.sync','customer_card.sync')
  and updated_at>=now()-interval '2 hours'
group by job_type,status,coalesce(error_code,'none')
order by job_type,status,error_code`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
  redirect: "error",
  signal: AbortSignal.timeout(45000),
});
if (!response.ok) throw Error(`Read-only diagnostic failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows)) throw Error("Read-only diagnostic response changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), scope: "last_two_hours", rows }));
