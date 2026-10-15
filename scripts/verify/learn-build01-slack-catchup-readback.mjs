/** Aggregate-only LIVE Slack catch-up capacity diagnostic for the approved campaign. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const query = `with campaign as (
  select h.id,h.tenant_id,h.ends_at,m.channel_id
  from public.slack_history_campaigns h
  join public.slack_history_campaign_channels m on m.campaign_id=h.id
    and m.tenant_id=h.tenant_id
  where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid
), volumes as (
  select c.channel_id,count(s.id)::int messages
  from campaign c
  left join public.slack_messages s on s.tenant_id=c.tenant_id
    and s.channel_id=c.channel_id
    and s.provider_timestamp::numeric<extract(epoch from c.ends_at)
  group by c.channel_id
), buckets as (
  select case when messages=0 then 'zero'
    when messages<100 then 'one_to_99'
    when messages<500 then '100_to_499'
    when messages<1000 then '500_to_999'
    else '1000_plus' end volume_bucket,
    count(*)::int channels,sum(messages)::int messages
  from volumes group by 1
)
select volume_bucket,channels,messages from buckets order by volume_bucket`;
const capacityQuery = `with campaign as (
 select h.tenant_id,h.connection_id,h.team_id,h.starts_at,h.ends_at,m.channel_id
 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=h.tenant_id
 where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid
), daily as (
 select c.channel_id,date_trunc('day',to_timestamp(s.provider_timestamp::numeric)) day_bucket,
   count(*)::int messages
 from campaign c join public.slack_messages s on s.tenant_id=c.tenant_id
   and s.channel_id=c.channel_id and s.provider_timestamp::numeric>=extract(epoch from c.starts_at)
   and s.provider_timestamp::numeric<extract(epoch from c.ends_at)
 group by c.channel_id,date_trunc('day',to_timestamp(s.provider_timestamp::numeric))
)
select (select min(starts_at) from campaign) historical_start,
 (select max(ends_at) from campaign) historical_end,
 (select count(*)::int from daily where messages>150) channel_days_over_150,
 (select count(*)::int from daily where messages>1000) channel_days_over_1000,
 (select max(messages)::int from daily) maximum_observed_channel_day,
 (select count(*)::int from public.slack_internal_rate_profiles p
   join (select distinct tenant_id,connection_id,team_id from campaign) c
   on c.tenant_id=p.tenant_id and c.connection_id=p.connection_id and c.team_id=p.team_id
   where p.verified_at<=statement_timestamp() and p.expires_at>statement_timestamp()) active_rate_profiles`;
const repliesQuery = `with campaign as (
 select h.tenant_id,h.team_id,h.ends_at,m.channel_id
 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=h.tenant_id
 where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid
), roots as (
 select c.channel_id,count(distinct case
   when s.thread_timestamp is not null and s.thread_timestamp::numeric<s.provider_timestamp::numeric
     then s.thread_timestamp::numeric
   when coalesce(s.provider_payload->>'reply_count','') ~ '^[0-9]+$'
     and (s.provider_payload->>'reply_count')::numeric>0
     then s.provider_timestamp::numeric end)::int parent_count
 from campaign c left join public.slack_messages s on s.tenant_id=c.tenant_id
   and s.team_id=c.team_id and s.channel_id=c.channel_id
   and s.provider_timestamp::numeric<=extract(epoch from c.ends_at)
 group by c.channel_id
)
select coalesce(sum(parent_count),0)::int observed_parent_roots,
  count(*) filter(where parent_count>0)::int channels_with_parent_roots,
  max(parent_count)::int maximum_roots_in_channel,
  (select count(*)::int from public.platform_jobs j
    where j.tenant_id='${tenant}'::uuid and j.job_type='slack.thread_sync'
      and j.created_at>'2026-10-15T15:00:33Z'::timestamptz) post_handoff_reply_jobs
from roots`;
async function read(query) {
 const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
 if (!response.ok) {
   const issue = await response.json().catch(() => ({}));
   throw Error(`Slack catch-up readback failed (HTTP ${response.status}, ${String(issue?.code ?? issue?.error_code ?? "unknown")}, ${String(issue?.message ?? "unknown").slice(0, 180)})`);
 }
 return response.json();
}
const rows = await read(query);
if (!Array.isArray(rows) || !rows.every(row =>
    typeof row.volume_bucket === "string" &&
    Number.isInteger(row.channels) && row.channels >= 0 &&
    Number.isInteger(row.messages) && row.messages >= 0))
  throw Error("Slack catch-up readback shape changed");
const capacityRows = await read(capacityQuery);
const capacity = capacityRows?.[0];
if (!Array.isArray(capacityRows) || capacityRows.length !== 1 || !capacity ||
    !["channel_days_over_150", "channel_days_over_1000", "active_rate_profiles"]
      .every(key => Number.isInteger(capacity[key]) && capacity[key] >= 0))
  throw Error("Slack catch-up capacity shape changed");
const replyRows = await read(repliesQuery);
const replies = replyRows?.[0];
if (!Array.isArray(replyRows) || replyRows.length !== 1 || !replies ||
    !["observed_parent_roots", "channels_with_parent_roots", "post_handoff_reply_jobs"]
      .every(key => Number.isInteger(replies[key]) && replies[key] >= 0))
  throw Error("Slack catch-up reply workload shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, campaign, rows, capacity, replies, productionDataWrites: false,
  scope: "Historical volume buckets are a capacity clue, not proof of future rate or provider completeness." }));
