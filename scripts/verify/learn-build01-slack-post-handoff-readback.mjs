/** Aggregate-only LIVE check for evidence retained after the approved Slack handoff. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const query = `with approved as (
  select h.tenant_id,h.team_id,h.ends_at,m.channel_id
  from public.slack_history_campaigns h
  join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=h.tenant_id
  where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid
), retained as (
  select s.id,s.channel_id,s.provider_timestamp::numeric ts,
    s.thread_timestamp is not null and s.thread_timestamp<>s.provider_timestamp as reply,
    a.ends_at
  from approved a join public.slack_messages s on s.tenant_id=a.tenant_id
    and s.team_id=a.team_id and s.channel_id=a.channel_id
  where s.provider_timestamp::numeric>=extract(epoch from a.ends_at)
)
select count(*)::int retained_after_cutoff,
 count(*) filter(where reply)::int retained_replies_after_cutoff,
 count(distinct channel_id)::int channels_with_retained_after_cutoff,
 min(to_timestamp(ts)) first_retained_at,
 max(to_timestamp(ts)) latest_retained_at
from retained`;
const throughputQuery = `with recent as (
  select job_type,started_at,completed_at,
    extract(epoch from completed_at-started_at) run_seconds,
    extract(epoch from started_at-lag(started_at) over(partition by job_type order by started_at)) start_gap_seconds
  from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type in ('slack.history_sync','slack.thread_sync')
    and status='succeeded' and started_at>clock_timestamp()-interval '1 hour'
)
select job_type,count(*)::int succeeded_last_hour,
  round(avg(run_seconds)::numeric,1) mean_run_seconds,
  round((percentile_cont(0.95) within group(order by run_seconds))::numeric,1) p95_run_seconds,
  round(avg(start_gap_seconds)::numeric,1) mean_same_type_start_gap_seconds
from recent group by job_type order by job_type`;
async function read(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`Post-handoff readback failed (HTTP ${response.status})`);
  return response.json();
}
const rows = await read(query);
const row = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !row ||
  !["retained_after_cutoff", "retained_replies_after_cutoff", "channels_with_retained_after_cutoff"]
    .every(key => Number.isInteger(row[key]) && row[key] >= 0))
  throw Error("Post-handoff readback shape changed");
const throughput = await read(throughputQuery);
if (!Array.isArray(throughput) || throughput.length > 2 || throughput.some(x =>
  !["slack.history_sync", "slack.thread_sync"].includes(x.job_type) ||
  !Number.isInteger(x.succeeded_last_hour) || x.succeeded_last_hour < 0))
  throw Error("Slack throughput readback shape changed");
console.log(JSON.stringify({ observedAtUtc: new Date().toISOString(), project, tenant, campaign,
  ...row, throughput, productionDataWrites: false,
  limit: "Retained rows after the cutoff show saved evidence, not complete provider coverage or channel catch-up." }));
