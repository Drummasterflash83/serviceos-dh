/** Aggregate-only LIVE readback of Drummonds' 3-year email horizon. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const token = savedCliToken();
async function read(name, query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`${name} readback failed (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 50) throw Error(`${name} shape changed`);
  return rows;
}
const checkpoints = await read("checkpoints", `select c.stream,c.state,
  c.continuation->>'version' version,c.continuation->>'phase' phase,
  c.continuation->>'mode' mode,c.continuation->>'query' query,
  case when c.continuation#>>'{labels_state,ALL,next_page_token}' is null then 'none' else 'present' end recent_page_token,
  case when a.backfill_page_token is null then 'none' else 'present' end historical_page_token,
  a.backfill_status,
  count(*)::int accounts
from public.email_ingestion_checkpoints c
join public.email_accounts a on a.id=c.email_account_id and a.tenant_id=c.tenant_id
where c.tenant_id='${tenant}'::uuid
group by 1,2,3,4,5,6,7,8,9 order by 1,2,3,4,5,6,7,8,9`);
const jobs = await read("jobs", `select job_type,status,count(*)::int jobs
from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type in ('email.gmail_sync','email.workspace_sync','email.workspace_backfill')
  and status in ('queued','running','retrying')
group by job_type,status order by job_type,status`);
const policy = await read("policy", `select
 count(*)::int accounts,
 count(*) filter(where full_import_after_at='2023-10-16T00:00:00Z'::timestamptz)::int bounded_accounts,
 (select count(*)::int from public.audit_logs where tenant_id='${tenant}'::uuid
   and action='learn.email.full_import_horizon_activated') audit_rows
from public.email_accounts where tenant_id='${tenant}'::uuid and provider='gmail'`);
const source = await read("source", `select
  count(*)::int retained_total,
  count(*) filter(where coalesce(received_at,sent_at,created_at)<'2023-10-16T00:00:00Z'::timestamptz)::int retained_before_three_year_date,
  count(*) filter(where created_at>=clock_timestamp()-interval '1 hour')::int retained_last_hour,
  count(*) filter(where created_at>=clock_timestamp()-interval '1 hour'
    and coalesce(received_at,sent_at,created_at)<'2023-10-16T00:00:00Z'::timestamptz)::int old_retained_last_hour
from public.email_messages where tenant_id='${tenant}'::uuid`);
if (source.length !== 1 || policy.length !== 1 ||
  !Object.values(policy[0]).every(v => Number.isSafeInteger(v) && v >= 0) ||
  checkpoints.some(r => !Number.isSafeInteger(r.accounts)) ||
  jobs.some(r => !Number.isSafeInteger(r.jobs)) ||
  !Object.values(source[0]).every(v => Number.isSafeInteger(v) && v >= 0))
  throw Error("Email horizon readback shape changed");
console.log(JSON.stringify({ version: "learn-build01-email-horizon-readback/1",
  observedAtUtc: new Date().toISOString(), cutoffUtc: "2023-10-16T00:00:00Z",
  policy: policy[0], checkpoints, jobs, source: source[0], productionDataWrites: false,
  sourceProviderRequests: 0, customerRowsOrCredentialsPrinted: false }));
