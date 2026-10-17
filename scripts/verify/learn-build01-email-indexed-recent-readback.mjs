/** Observe ordinary Email projection after the indexed selector release. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const releasedAt = "2026-10-17T14:31:38Z";
const query = `with jobs as materialized (
  select j.id,j.status,j.error_code,j.completed_at,j.lease_expires_at
  from public.platform_jobs j
  where j.tenant_id='${tenant}'::uuid and j.job_type='interactions.sync'
    and j.payload->>'source'='email' and j.payload->>'lane' is null
    and j.created_at>='${releasedAt}'::timestamptz
), publications as materialized (
  select p.source_id,p.receipt->>'action' action,p.created_at
  from public.learn_processing_publications p join jobs j on j.id=p.job_id
  where p.tenant_id='${tenant}'::uuid and p.source_kind='email'
    and p.receipt->>'state'='committed'
    and p.created_at>='${releasedAt}'::timestamptz
)
select (select count(*)::int from jobs) ordinary_jobs,
  (select count(*)::int from jobs where status='succeeded') succeeded_jobs,
  (select count(*)::int from jobs where status in ('failed','dead_letter')) failed_jobs,
  (select count(*)::int from jobs where status in ('queued','running','retrying')) active_jobs,
  (select count(*)::int from jobs where status='queued') queued_jobs,
  (select count(*)::int from jobs where status='running') running_jobs,
  (select count(*)::int from jobs where status='retrying') retrying_jobs,
  (select max(lease_expires_at) from jobs where status='running') latest_running_lease,
  (select max(completed_at) from jobs where status='succeeded') latest_success_at,
  (select count(*)::int from publications) committed_publications,
  (select count(*)::int from publications where action='created') created_publications,
  (select count(*)::int from publications where action='unchanged') unchanged_publications,
  (select count(distinct source_id)::int from publications) distinct_sources,
  (select max(created_at) from publications) latest_publication_at`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`Indexed Email ordinary readback HTTP ${response.status}`);
const rows = await response.json();
const result = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !result ||
    ["ordinary_jobs", "succeeded_jobs", "failed_jobs", "active_jobs",
      "queued_jobs", "running_jobs", "retrying_jobs",
      "committed_publications", "created_publications", "unchanged_publications",
      "distinct_sources"].some(field => !Number.isSafeInteger(result[field]) || result[field] < 0))
  throw Error("Indexed Email ordinary readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  releasedAt, ...result, sourceIdsReturned: false, messageContentReturned: false,
  productionDataWrites: false }));
