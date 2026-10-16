/** Aggregate-only, read-only LIVE queue pressure for the existing Build 01 lanes. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with created as (
  select job_type
  from public.platform_jobs
  where tenant_id='${tenant}'::uuid
    and created_at>=clock_timestamp()-interval '1 hour'
    and job_type in ('commusoft.source_sync','email.workspace_sync',
      'interactions.sync','identity.resolve','graph.sync',
      'customer_card.sync','slack.history_sync','slack.thread_sync')
), completed as (
  select id,job_type,records_processed
  from public.platform_jobs
  where tenant_id='${tenant}'::uuid and status='succeeded'
    and completed_at>=clock_timestamp()-interval '1 hour'
    and job_type in ('commusoft.source_sync','email.workspace_sync',
      'interactions.sync','identity.resolve','graph.sync',
      'customer_card.sync','slack.history_sync','slack.thread_sync')
), active as (
  select job_type,status,created_at
  from public.platform_jobs
  where tenant_id='${tenant}'::uuid
    and status in ('queued','running','retrying')
    and job_type in ('commusoft.source_sync','email.workspace_sync',
      'interactions.sync','identity.resolve','graph.sync',
      'customer_card.sync','slack.history_sync','slack.thread_sync')
), lanes as (
  select distinct job_type from created union select distinct job_type from completed
  union select distinct job_type from active
)
select l.job_type,
  (select count(*)::int from created r where r.job_type=l.job_type) created_last_hour,
  (select count(*)::int from completed r where r.job_type=l.job_type) succeeded_last_hour,
  (select coalesce(sum(r.records_processed),0)::bigint from completed r
    where r.job_type=l.job_type) records_from_successful_jobs,
  (select count(*)::int from completed r join public.learn_business_input_pages p
    on p.job_id=r.id and p.tenant_id='${tenant}'::uuid
    where r.job_type=l.job_type) committed_source_pages,
  (select coalesce(sum(p.record_count),0)::bigint from completed r
    join public.learn_business_input_pages p on p.job_id=r.id
      and p.tenant_id='${tenant}'::uuid where r.job_type=l.job_type) committed_source_records,
  (select count(*)::int from active a where a.job_type=l.job_type) active_jobs,
  (select min(a.created_at) from active a where a.job_type=l.job_type) oldest_active_created_at
from lanes l order by l.job_type`;
async function read(sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(45000),
    },
  );
  if (!response.ok) throw Error(`Worker pressure readback failed (HTTP ${response.status})`);
  return response.json();
}
const rows = await read(query);
const names = new Set(["commusoft.source_sync", "email.workspace_sync",
  "interactions.sync", "identity.resolve", "graph.sync", "customer_card.sync",
  "slack.history_sync", "slack.thread_sync"]);
if (!Array.isArray(rows) || rows.length > names.size || rows.some((row) =>
  !row || !names.has(row.job_type) ||
  !["created_last_hour", "succeeded_last_hour", "active_jobs",
    "committed_source_pages"].every((key) =>
    Number.isSafeInteger(row[key]) && row[key] >= 0) ||
  !["records_from_successful_jobs", "committed_source_records"].every((key) =>
    /^[0-9]+$/.test(String(row[key]))) ||
  !(row.oldest_active_created_at === null ||
    typeof row.oldest_active_created_at === "string" &&
    Number.isFinite(Date.parse(row.oldest_active_created_at)))))
  throw Error("Worker pressure readback shape changed");
const source = await read(`select
  (select count(*)::int from public.learn_commusoft_recurring
    where tenant_id='${tenant}'::uuid and enabled) enabled_accounts,
  (select min(watermark) from public.learn_commusoft_recurring
    where tenant_id='${tenant}'::uuid and enabled) oldest_watermark,
  (select min(cycle_start) from public.learn_commusoft_recurring
    where tenant_id='${tenant}'::uuid and enabled) oldest_cycle_start,
  (select max(cycle_end) from public.learn_commusoft_recurring
    where tenant_id='${tenant}'::uuid and enabled) newest_cycle_end,
  (select max(committed_at) from public.learn_business_input_pages
    where tenant_id='${tenant}'::uuid and provider='commusoft'
      and collection='jobs') latest_job_page_at,
  (select coalesce(jsonb_object_agg(label,total),'{}'::jsonb) from (
    select phase::text||':'||last_state label,count(*)::int total
    from public.learn_commusoft_recurring where tenant_id='${tenant}'::uuid and enabled
    group by phase,last_state) states) recurring_states,
  (select coalesce(jsonb_object_agg(collection,counts),'{}'::jsonb) from (
    select collection,jsonb_build_object('pages',count(*)::int,
      'empty',count(*) filter(where record_count=0)::int,
      'records',coalesce(sum(record_count),0)::bigint) counts
    from public.learn_business_input_pages
    where tenant_id='${tenant}'::uuid
      and committed_at>=clock_timestamp()-interval '1 hour'
    group by collection) pages) source_pages`);
if (!Array.isArray(source) || source.length !== 1 || !source[0] ||
  !Number.isSafeInteger(source[0].enabled_accounts) || source[0].enabled_accounts < 0 ||
  !source[0].recurring_states || typeof source[0].recurring_states !== "object" ||
  !source[0].source_pages || typeof source[0].source_pages !== "object")
  throw Error("Source pressure readback shape changed");
console.log(JSON.stringify({ version: "learn-build01-worker-pressure/1",
  observedAt: new Date().toISOString(), lanes: rows, source: source[0],
  productionDataWrites: false, sourceProviderRequests: 0,
  scope: "Aggregate queue counts for one hour; not a worker-capacity or source-freshness guarantee." }));
