/** Counts-only readback for near-live public Slack event acceptance. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
const project = mode === "--test-read-only" ? TEST_PROJECT
  : mode === "--live-read-only" ? "tgbnakbxwcqjeimygroz" : null;
if (!project) throw Error("Explicit TEST or LIVE read-only mode required");
const tenant = "00000000-0000-0000-0000-000000000001";

async function read(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
      "content-type": "application/json" }, body: JSON.stringify({ query }),
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Slack event health HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("Slack event health response invalid");
  return rows;
}

const installed = (await read("select to_regclass('public.learn_slack_event_hints') is not null as installed"))[0]?.installed;
if (installed !== true && installed !== false) throw Error("Slack event schema state unknown");
if (!installed) {
  console.log(JSON.stringify({ version: "learn-slack-event-health/1", project,
    observedAtUtc: new Date().toISOString(), installed: false,
    productionDataWrites: false, providerRequests: 0 }));
  process.exit(0);
}
const query = `with hints as (
 select state,count(*)::int hints,min(received_at) oldest_received_at,
  max(received_at) newest_received_at,
  percentile_cont(0.95) within group(order by extract(epoch from settled_at-received_at))
   filter(where settled_at is not null) p95_settlement_seconds
 from public.learn_slack_event_hints where tenant_id='${tenant}'::uuid group by state
), jobs as (
 select status,count(*)::int jobs,min(created_at) oldest_created_at
 from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='slack.event_sync' group by status
)
select 'hint' as kind,state as status,hints as count,oldest_received_at as oldest_at,
 newest_received_at as newest_at,p95_settlement_seconds from hints
union all
select 'job',status,jobs,oldest_created_at,null::timestamptz,null::double precision from jobs
order by kind,status`;
const rows = await read(query);
if (!rows.every((row) => ["hint", "job"].includes(row.kind) &&
    typeof row.status === "string" && Number.isInteger(row.count) && row.count >= 0))
  throw Error("Slack event health rows invalid");
console.log(JSON.stringify({ version: "learn-slack-event-health/1", project,
  observedAtUtc: new Date().toISOString(), installed: true, rows,
  productionDataWrites: false, providerRequests: 0,
  note: "Settlement latency excludes provider-to-receiver delivery delay." }));
