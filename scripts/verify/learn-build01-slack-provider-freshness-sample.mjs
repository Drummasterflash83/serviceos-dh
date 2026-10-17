/** Bounded read-only checks of the two exact approved public-channel rosters.
 * Five-channel mode compares message timestamps; full modes read channel metadata only.
 */
import { spawnSync } from "node:child_process";
import { savedCliToken } from "./learn-test-readiness.mjs";

const MODE = process.argv.slice(2).join(" ");
if (!["--live-read-only-five-channel-sample",
  "--live-read-only-complete-roster-info",
  "--live-read-only-current-twenty-info",
  "--live-read-only-current-twenty-access"].includes(MODE))
  throw Error("Exact LIVE read-only roster mode required");
const COMPLETE_ROSTER = MODE !== "--live-read-only-five-channel-sample";
const CURRENT_TWENTY = MODE === "--live-read-only-current-twenty-info" ||
  MODE === "--live-read-only-current-twenty-access";
const ACCESS_PROBE = MODE === "--live-read-only-current-twenty-access";
const PROJECT = "tgbnakbxwcqjeimygroz";
const TENANT = "00000000-0000-0000-0000-000000000001";
const CAMPAIGN = CURRENT_TWENTY
  ? "a3980d74-29fa-4655-a914-61219cdf7dad"
  : "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const EXPECTED = CURRENT_TWENTY ? 20 : COMPLETE_ROSTER ? 160 : 5;
const TEAM = "T0CC5V4D7";
const SERVICE = "OpenFolk.ServiceOS.Slack.Drummonds.User";
const need = (ok, message) => { if (!ok) throw Error(message); };

const keychain = spawnSync("/usr/bin/security", ["find-generic-password",
  "-a", TEAM, "-s", SERVICE, "-w"], {
  encoding: "utf8", timeout: 15000, maxBuffer: 4096,
  stdio: ["ignore", "pipe", "pipe"],
});
need(keychain.status === 0, "Approved Slack Keychain source unavailable");
let credential;
try { credential = JSON.parse(keychain.stdout); }
catch { throw Error("Approved Slack credential shape changed"); }
need(credential.teamId === TEAM && credential.appId === "A0C8G0STUKV" &&
  credential.kind === "user_token" && /^xoxp-[A-Za-z0-9-]+$/.test(credential.token ?? ""),
"Approved Slack credential binding changed");

const query = `with approved as (
  select h.tenant_id,h.team_id,m.channel_id
  from public.slack_history_campaigns h
  join public.slack_history_campaign_channels m on m.campaign_id=h.id
    and m.tenant_id=h.tenant_id
  where h.id='${CAMPAIGN}'::uuid and h.tenant_id='${TENANT}'::uuid
    and h.team_id='${TEAM}'
), volumes as (
  select a.channel_id,count(s.id)::int saved_count,
    max(s.provider_timestamp::numeric)::text saved_latest_ts
  from approved a left join public.slack_messages s
    on s.tenant_id=a.tenant_id and s.team_id=a.team_id
    and s.channel_id=a.channel_id
    and s.provider_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$'
  group by a.channel_id
)
select channel_id,saved_count,saved_latest_ts from volumes
order by saved_latest_ts::numeric desc nulls last,saved_count desc,channel_id
limit ${EXPECTED}`;
const sql = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`, {
  method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  redirect: "error", signal: AbortSignal.timeout(30000),
});
need(sql.ok, "Exact roster metadata read unavailable");
const sample = await sql.json();
need(Array.isArray(sample) && sample.length === EXPECTED &&
  new Set(sample.map(row => row.channel_id)).size === sample.length && sample.every(row =>
  /^C[A-Z0-9]{8,}$/.test(row.channel_id ?? "") &&
  Number.isInteger(row.saved_count) && row.saved_count >= 0 &&
  (row.saved_latest_ts === null || /^\d{10,12}\.\d{1,6}$/.test(row.saved_latest_ts))),
"Exact roster sample shape changed");

async function slack(method, channel, extra = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  url.searchParams.set("channel", channel);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${credential.token}` },
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (response.status === 429) return { ok: false, error: "rate_limited" };
  need(response.ok, `Slack ${method} HTTP unavailable`);
  const body = await response.json();
  need(body && typeof body.ok === "boolean", `Slack ${method} response changed`);
  return body;
}

const results = [];
const pace = () => COMPLETE_ROSTER
  ? new Promise(resolve => setTimeout(resolve, 750)) : Promise.resolve();
for (const row of sample) {
  const info = await slack("conversations.info", row.channel_id);
  if (!info.ok) {
    results.push({ channelId: row.channel_id, providerInfo: info.error ?? "unknown",
      historyRead: false });
    if (info.error === "rate_limited") break;
    await pace();
    continue;
  }
  need(info.channel?.id === row.channel_id && info.channel?.is_private === false &&
    info.channel?.is_channel === true,
  "Approved roster channel is not a verified public channel");
  if (ACCESS_PROBE && !info.channel.is_archived && info.channel.is_member === false) {
    const history = await slack("conversations.history", row.channel_id, { limit: "1" });
    if (history.ok) need(Array.isArray(history.messages) && history.messages.length <= 1,
      "Slack nonmember history response changed");
    results.push({ channelId: row.channel_id, archived: false, member: false,
      historyRead: history.ok, historyError: history.ok ? null : history.error ?? "unknown" });
    await pace();
    continue;
  }
  if (info.channel.is_archived || info.channel.is_member === false) {
    results.push({ channelId: row.channel_id,
      archived: !!info.channel.is_archived, member: !!info.channel.is_member,
      historyRead: false });
    await pace();
    continue;
  }
  if (COMPLETE_ROSTER) {
    results.push({ channelId: row.channel_id, archived: false,
      member: !!info.channel.is_member, historyRead: false });
    await pace();
    continue;
  }
  const history = await slack("conversations.history", row.channel_id, { limit: "1" });
  if (!history.ok) {
    results.push({ channelId: row.channel_id, providerHistory: history.error ?? "unknown",
      historyRead: false });
    continue;
  }
  need(Array.isArray(history.messages) && history.messages.length <= 1,
    "Slack latest history response changed");
  const latest = history.messages[0]?.ts ?? null;
  need(latest === null || /^\d{10,12}\.\d{1,6}$/.test(latest),
    "Slack latest timestamp changed");
  results.push({ channelId: row.channel_id, archived: false, member: true,
    historyRead: true, savedLatestTs: row.saved_latest_ts,
    providerLatestTs: latest, providerAheadOfSaved:
      latest !== null && (row.saved_latest_ts === null ||
        Number(latest) > Number(row.saved_latest_ts)),
    providerPostCutoff: latest !== null && Number(latest) >= 1791883800 });
}
console.log(JSON.stringify({ version: "learn-build01-slack-provider-freshness-sample/1",
  observedAtUtc: new Date().toISOString(), project: PROJECT, tenant: TENANT,
  campaign: CAMPAIGN, sampleKind: COMPLETE_ROSTER
    ? CURRENT_TWENTY ? ACCESS_PROBE
      ? "exact current 20-channel public roster and four nonmember history access checks"
      : "exact current 20-channel public roster metadata"
      : "exact archived 160-channel public roster metadata"
    : "five most recently saved approved public channels",
  ...(COMPLETE_ROSTER ? {
    rosterChannels: EXPECTED, inspectedChannels: results.length,
    archivedChannels: results.filter(row => row.archived).length,
    activeChannels: results.filter(row => row.archived === false).length,
    activeMemberChannels: results.filter(row => row.archived === false && row.member).length,
    ...(ACCESS_PROBE ? {
      nonmemberHistoryAccessible: results.filter(row => row.member === false &&
        row.historyRead).length,
      nonmemberHistoryDenied: results.filter(row => row.member === false &&
        row.historyError && row.historyError !== "rate_limited").length,
      nonmemberHistoryErrors: [...new Set(results.filter(row => row.historyError)
        .map(row => row.historyError))].sort(),
    } : {}),
    unavailableChannels: results.filter(row => row.providerInfo &&
      row.providerInfo !== "rate_limited").length,
    rateLimited: results.some(row => row.providerInfo === "rate_limited"),
    fullRosterObserved: results.length === EXPECTED &&
      !results.some(row => row.providerInfo === "rate_limited"),
  } : { channels: results }), messageBodiesReturned: false, dmChannelsRead: false,
  privateChannelsRead: false, providerWrites: false, productionDataWrites: false,
  limit: COMPLETE_ROSTER
    ? ACCESS_PROBE
      ? "At most four one-message nonmember access checks; bodies never returned; no reply completeness claim."
      : "Channel metadata only; this does not establish message or reply capture."
    : "Five channels only; this does not establish full 160-channel freshness or reply capture." }));
