/** Aggregate-only LIVE identity queue timing readback; no row IDs or payloads. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select status,coalesce(error_code,'none') error_code,
  count(*)::int jobs,
  min(next_run_at) first_next_run_at,
  max(next_run_at) last_next_run_at,
  max(updated_at) latest_update_at,
  min(attempt_count)::int minimum_attempts,
  max(attempt_count)::int maximum_attempts,
  max(max_attempts)::int maximum_allowed_attempts
from public.platform_jobs
where tenant_id='${tenant}'::uuid and job_type='identity.resolve'
  and status in('queued','running','retrying','failed','dead_letter')
group by status,coalesce(error_code,'none')
order by status,error_code`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Identity queue readback failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || !rows.every(row =>
    typeof row.status === "string" && typeof row.error_code === "string" &&
    Number.isInteger(row.jobs) && row.jobs >= 0))
  throw Error("Identity queue readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, productionDataWrites: false,
  scope: "Queued/retrying timing and review holds only; no manual rescue implied." }));
