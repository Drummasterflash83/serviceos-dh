/** Check that the provider reply query used for the archived-roster audit can
 * actually find a known retained reply in the separate approved active public
 * campaign. No message body or provider identifier is emitted. */
import { spawnSync } from "node:child_process";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only control required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "a3980d74-29fa-4655-a914-61219cdf7dad";
const team = "T0CC5V4D7", app = "A0C8G0STUKV";
const cutoff = "1791883800";
const sql = `select s.channel_id,s.thread_timestamp root_ts,
 s.provider_timestamp reply_ts
 from public.slack_messages s
 join public.slack_history_campaign_channels m on m.tenant_id=s.tenant_id
  and m.channel_id=s.channel_id and m.campaign_id='${campaign}'::uuid
 join public.slack_history_campaigns h on h.id=m.campaign_id
  and h.tenant_id=m.tenant_id and h.team_id='${team}'
 where s.tenant_id='${tenant}'::uuid and s.team_id='${team}'
  and s.thread_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$'
  and s.provider_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$'
  and s.thread_timestamp::numeric<s.provider_timestamp::numeric
  and s.provider_timestamp::numeric>='${cutoff}'::numeric
 order by s.provider_timestamp desc limit 1`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
if (!response.ok) throw Error(`Retained active reply readback HTTP ${response.status}`);
const rows = await response.json();
const known = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !known ||
    !/^C[A-Z0-9]{8,}$/.test(known.channel_id ?? "") ||
    !/^[0-9]{10,12}\.[0-9]{1,6}$/.test(known.root_ts ?? "") ||
    !/^[0-9]{10,12}\.[0-9]{1,6}$/.test(known.reply_ts ?? ""))
  throw Error("Known active public reply unavailable");
const found = spawnSync("/usr/bin/security", ["find-generic-password", "-a", team,
  "-s", "OpenFolk.ServiceOS.Slack.Drummonds.User", "-w"],
{ encoding: "utf8", timeout: 15000, maxBuffer: 4096,
  stdio: ["ignore", "pipe", "pipe"] });
if (found.status !== 0) throw Error("Approved Slack Keychain source unavailable");
let credential;
try { credential = JSON.parse(found.stdout); }
catch { throw Error("Approved Slack credential shape changed"); }
if (credential.teamId !== team || credential.appId !== app ||
    credential.kind !== "user_token" || !/^xoxp-[A-Za-z0-9-]+$/.test(credential.token ?? ""))
  throw Error("Approved Slack credential binding changed");
async function slack(method, params) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const result = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${credential.token}` } });
  if (!result.ok) throw Error(`Slack control ${method} HTTP ${result.status}`);
  const body = await result.json();
  if (body?.ok !== true) throw Error(`Slack control ${method} ${String(body?.error ?? "unknown").slice(0, 50)}`);
  return body;
}
const info = await slack("conversations.info", { channel: known.channel_id });
if (info.channel?.id !== known.channel_id || info.channel?.is_channel !== true ||
    info.channel?.is_private !== false || info.channel?.is_archived !== false)
  throw Error("Known active reply channel is no longer approved public and active");
let cursor = "", pages = 0, matched = false;
do {
  const page = await slack("conversations.replies", {
    channel: known.channel_id, ts: known.root_ts, oldest: cutoff,
    inclusive: "true", limit: "200", ...(cursor ? { cursor } : {}),
  });
  if (!Array.isArray(page.messages)) throw Error("Provider reply control shape changed");
  matched ||= page.messages.some(message => message?.ts === known.reply_ts);
  pages++;
  if (pages > 100) throw Error("Provider reply control pagination depth changed");
  cursor = page.response_metadata?.next_cursor ?? "";
  if (page.has_more === true && !cursor)
    throw Error("Provider reply control has_more without cursor");
} while (cursor && !matched);
if (!matched) throw Error("Provider reply query did not find known retained reply");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  campaign, knownRetainedReplyMatchedProvider: true, providerPagesChecked: pages,
  channelConfirmedPublicActive: true, messageBodiesReturned: false,
  channelOrMessageIdsReturned: false, dmChannelsRead: false,
  privateChannelsRead: false, providerWrites: false, productionDataWrites: false }));
