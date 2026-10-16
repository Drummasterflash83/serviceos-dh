/** Counts-only post-cutoff evidence for the exact approved 160 public channels. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const query = `with approved as (
 select h.team_id,m.channel_id
 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels m on m.campaign_id=h.id
  and m.tenant_id=h.tenant_id
 where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid
), saved as (
 select s.team_id,s.channel_id,s.provider_timestamp,s.thread_timestamp,
  s.source_external_id
 from public.slack_messages s join approved a
  on a.team_id=s.team_id and a.channel_id=s.channel_id
 where s.tenant_id='${tenant}'::uuid
  and s.provider_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$'
  and s.provider_timestamp::numeric >= 1791883800::numeric
)
select (select count(*)::int from approved) approved_channels,
 (select count(*)::int from saved) saved_postcutoff_messages,
 (select count(*)::int from saved where thread_timestamp is not null
   and thread_timestamp<>provider_timestamp) saved_postcutoff_replies,
 (select count(distinct channel_id)::int from saved) channels_with_postcutoff_source,
 (select max(to_timestamp(provider_timestamp::numeric)) from saved) latest_source_at,
 (select count(*)::int from public.learn_slack_event_hints h join approved a
   on a.team_id=h.team_id and a.channel_id=h.channel_id
   where h.tenant_id='${tenant}'::uuid) signed_event_hints_in_roster,
 (select count(*)::int from public.learn_slack_event_hints h join saved s
   on s.team_id=h.team_id and s.channel_id=h.channel_id
    and s.source_external_id=h.team_id||':'||h.channel_id||':'||h.source_ts
   where h.tenant_id='${tenant}'::uuid) signed_hints_with_saved_source`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`LIVE approved Slack evidence HTTP ${response.status}`);
const rows = await response.json();
const result = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !result ||
  ["approved_channels","saved_postcutoff_messages","saved_postcutoff_replies",
    "channels_with_postcutoff_source","signed_event_hints_in_roster",
    "signed_hints_with_saved_source"].some((key) =>
      !Number.isInteger(result[key]) || result[key] < 0))
  throw Error("LIVE approved Slack evidence shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, campaign, ...result, messageBodiesReturned: false,
  productionDataWrites: false }));
