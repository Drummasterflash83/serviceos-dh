/** Read-only, content-free existence check for the exact approved 160 public channels.
 * Slack's latest provider page is queried only after verifying each channel is
 * still public. This proves parent-message presence/absence, not reply absence.
 */
import { spawnSync } from "node:child_process";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only-exact-160")
  throw Error("Exact LIVE read-only mode required");

const PROJECT = "tgbnakbxwcqjeimygroz";
const TENANT = "00000000-0000-0000-0000-000000000001";
const CAMPAIGN = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const TEAM = "T0CC5V4D7";
const CUTOFF = "1791883800"; // 2026-10-13 09:30:00 UTC
const SERVICE = "OpenFolk.ServiceOS.Slack.Drummonds.User";
const need = (ok, code) => { if (!ok) throw Error(code); };

const sql = `select m.channel_id from public.slack_history_campaigns h
 join public.slack_history_campaign_channels m on m.campaign_id=h.id
   and m.tenant_id=h.tenant_id
 where h.id='${CAMPAIGN}'::uuid and h.tenant_id='${TENANT}'::uuid
   and h.team_id='${TEAM}'
   and h.ends_at='2026-10-13T09:30:00Z'::timestamptz
 order by m.channel_id`;
const rosterResponse = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
need(rosterResponse.ok, "exact_roster_unavailable");
const roster = await rosterResponse.json();
need(Array.isArray(roster) && roster.length === 160 &&
  new Set(roster.map(row => row.channel_id)).size === 160 &&
  roster.every(row => /^C[A-Z0-9]{8,}$/.test(row.channel_id ?? "")),
"exact_roster_changed");

const keychain = spawnSync("/usr/bin/security", ["find-generic-password",
  "-a", TEAM, "-s", SERVICE, "-w"], {
  encoding: "utf8", timeout: 15000, maxBuffer: 4096,
  stdio: ["ignore", "pipe", "pipe"],
});
need(keychain.status === 0, "approved_slack_keychain_unavailable");
let credential;
try { credential = JSON.parse(keychain.stdout); }
catch { throw Error("approved_slack_credential_shape_changed"); }
need(credential.teamId === TEAM && credential.appId === "A0C8G0STUKV" &&
  credential.kind === "user_token" &&
  /^xoxp-[A-Za-z0-9-]+$/.test(credential.token ?? ""),
"approved_slack_credential_binding_changed");

async function request(method, channel, extra = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  url.searchParams.set("channel", channel);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${credential.token}` },
    redirect: "error", signal: AbortSignal.timeout(20000),
  });
  if (response.status === 429) return { ok: false, error: "rate_limited" };
  need(response.ok, `slack_${method}_http_unavailable`);
  const body = await response.json();
  need(body && typeof body.ok === "boolean", `slack_${method}_shape_changed`);
  if (!body.ok) return { ok: false, error: body.error ?? "unknown" };
  if (method === "conversations.info") return {
    ok: true, id: body.channel?.id,
    publicChannel: body.channel?.is_channel === true &&
      body.channel?.is_private === false,
    archived: body.channel?.is_archived === true,
  };
  need(Array.isArray(body.messages) && body.messages.length <= 1,
    "slack_history_page_shape_changed");
  const latest = body.messages[0]?.ts ?? null;
  need(latest === null || /^\d{10,12}\.\d{1,6}$/.test(latest),
    "slack_history_timestamp_shape_changed");
  return { ok: true, latest, hasMore: body.has_more === true };
}

const findings = { checked: 0, publicArchived: 0, publicActive: 0,
  postcutoffParentChannels: [], unavailable: [], rateLimited: false };
for (const [index, row] of roster.entries()) {
  const info = await request("conversations.info", row.channel_id);
  if (!info.ok) {
    findings.unavailable.push({ channelId: row.channel_id, at: "info", code: info.error });
    if (info.error === "rate_limited") { findings.rateLimited = true; break; }
    continue;
  }
  if (info.id !== row.channel_id || !info.publicChannel) {
    findings.unavailable.push({ channelId: row.channel_id, at: "info", code: "not_public" });
    continue;
  }
  if (info.archived) findings.publicArchived += 1;
  else findings.publicActive += 1;
  const history = await request("conversations.history", row.channel_id,
    { oldest: CUTOFF, inclusive: "true", limit: "1" });
  if (!history.ok) {
    findings.unavailable.push({ channelId: row.channel_id, at: "history", code: history.error });
    if (history.error === "rate_limited") { findings.rateLimited = true; break; }
    continue;
  }
  need(history.latest !== null || !history.hasMore,
    "empty_history_with_more_pages");
  if (history.latest !== null) {
    need(Number(history.latest) >= Number(CUTOFF),
      "provider_timestamp_before_requested_cutoff");
    findings.postcutoffParentChannels.push(row.channel_id);
  }
  findings.checked += 1;
  if ((index + 1) % 40 === 0)
    console.error(JSON.stringify({ progress: index + 1, checked: findings.checked,
      unavailable: findings.unavailable.length }));
  if (index + 1 < roster.length)
    await new Promise(resolve => setTimeout(resolve, 1250));
}

console.log(JSON.stringify({
  version: "learn-build01-slack-postcutoff-provider-proof/1",
  observedAtUtc: new Date().toISOString(), project: PROJECT, tenant: TENANT,
  campaign: CAMPAIGN, cutoffUtc: new Date(Number(CUTOFF) * 1000).toISOString(),
  approvedChannels: roster.length, ...findings,
  completeProviderParentCheck: findings.checked === roster.length &&
    findings.unavailable.length === 0 && !findings.rateLimited,
  messageBodiesReturned: false, threadRepliesChecked: false,
  dmChannelsRead: false, privateChannelsRead: false,
  providerWrites: false, productionDataWrites: false,
  limitation: "A complete empty result proves no channel parent at or after the cutoff at this instant. It does not establish reply absence or settle every saved recurring window.",
}));
