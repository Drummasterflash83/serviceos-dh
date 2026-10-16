/** Counts-only historical arrival-rate proxy for the approved public roster. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Explicit LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const periods = {
  cutoffWeek: { start: "2026-10-06T09:30:00Z", end: "2026-10-13T09:30:00Z" },
  lastRetainedWeek: { start: "2026-08-23T07:00:00Z", end: "2026-08-30T07:00:00Z" },
};
async function read(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`Slack capacity readback HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0])
    throw Error("Slack capacity readback shape changed");
  return rows[0];
}
function queryForPeriod({ start, end }) { return `with hours as (
 select generate_series('${start}'::timestamptz,'${end}'::timestamptz
  - interval '1 hour',interval '1 hour') as hour_start
), arrivals as (
 select date_trunc('hour',to_timestamp(m.provider_timestamp::numeric)) as hour_start,
  count(*)::int messages,
  count(*) filter(where m.thread_timestamp is not null
    and m.thread_timestamp<>m.provider_timestamp)::int replies
 from public.slack_messages m
 join public.slack_recurring_channels s on s.tenant_id=m.tenant_id
  and s.team_id=m.team_id and s.channel_id=m.channel_id and s.enabled
 where m.tenant_id='${tenant}'::uuid
  and m.provider_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$'
  and to_timestamp(m.provider_timestamp::numeric)>='${start}'::timestamptz
  and to_timestamp(m.provider_timestamp::numeric)<'${end}'::timestamptz
 group by 1
)
select count(*)::int observed_hours,
 coalesce(sum(a.messages),0)::int retained_messages,
 coalesce(sum(a.replies),0)::int retained_replies,
 coalesce(max(a.messages),0)::int peak_messages_per_hour,
 coalesce(percentile_cont(0.95) within group(order by coalesce(a.messages,0)),0)::numeric(10,2) p95_messages_per_hour,
 count(*) filter(where coalesce(a.messages,0)>60)::int hours_above_one_per_minute
from hours h left join arrivals a using(hour_start)`; }
const cutoffWeek = await read(queryForPeriod(periods.cutoffWeek));
const lastRetainedWeek = await read(queryForPeriod(periods.lastRetainedWeek));
const baseline = await read(`select
 (select count(*)::int from public.slack_recurring_channels s
  where s.tenant_id='${tenant}'::uuid and s.enabled) enabled_roster_channels,
 (select count(*)::int from public.slack_messages m
  where m.tenant_id='${tenant}'::uuid) all_retained_messages,
 (select count(*)::int from public.slack_messages m
  join public.slack_recurring_channels s on s.tenant_id=m.tenant_id
   and s.team_id=m.team_id and s.channel_id=m.channel_id and s.enabled
  where m.tenant_id='${tenant}'::uuid) retained_in_enabled_roster,
 (select min(to_timestamp(m.provider_timestamp::numeric)) from public.slack_messages m
  join public.slack_recurring_channels s on s.tenant_id=m.tenant_id
   and s.team_id=m.team_id and s.channel_id=m.channel_id and s.enabled
  where m.tenant_id='${tenant}'::uuid
   and m.provider_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$') oldest_roster_source_at,
 (select max(to_timestamp(m.provider_timestamp::numeric)) from public.slack_messages m
  join public.slack_recurring_channels s on s.tenant_id=m.tenant_id
   and s.team_id=m.team_id and s.channel_id=m.channel_id and s.enabled
  where m.tenant_id='${tenant}'::uuid
   and m.provider_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$') newest_roster_source_at`);
const fields = ["observed_hours", "retained_messages", "retained_replies",
  "peak_messages_per_hour", "hours_above_one_per_minute"];
if (![cutoffWeek, lastRetainedWeek].every(row =>
      fields.every(key => Number.isSafeInteger(row[key]) && row[key] >= 0)
      && Number.isFinite(Number(row.p95_messages_per_hour)))
    || !["enabled_roster_channels", "all_retained_messages", "retained_in_enabled_roster"]
      .every(key => Number.isSafeInteger(baseline[key]) && baseline[key] >= 0)
    || !["oldest_roster_source_at", "newest_roster_source_at"]
      .every(key => baseline[key] === null || Number.isFinite(Date.parse(baseline[key]))))
  throw Error("Slack capacity readback values invalid");
console.log(JSON.stringify({ version: "learn-build01-slack-event-capacity/1",
  observedAtUtc: new Date().toISOString(), project, tenant, baseline,
  periods: { cutoffWeek: { ...periods.cutoffWeek, ...cutoffWeek },
    lastRetainedWeek: { ...periods.lastRetainedWeek, ...lastRetainedWeek } },
  interpretation: "Retained public-channel source arrival proxy; missing source data can undercount actual Slack events.",
  sourceIdsOrContentPrinted: false, providerRequests: 0, productionDataWrites: false }));
