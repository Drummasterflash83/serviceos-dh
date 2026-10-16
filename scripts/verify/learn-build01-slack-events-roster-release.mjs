/** Exact LIVE configuration transition after Chris's approved 20-channel handoff.
 * Changes only two non-credential receiver values. Never prints secret values. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--apply-live-180")
  throw Error("Exact LIVE 180-channel release mode required");
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "a3980d74-29fa-4655-a914-61219cdf7dad";
const prior = Object.freeze({
  LEARN_SLACK_EVENTS_EXPECTED_CHANNELS: "160",
  LEARN_SLACK_EVENTS_ROSTER_SHA256: "e1417e972f9a319340446e7410d071cb120e8cc80e23b2a91cd66370183a315b",
});
const next = Object.freeze({
  LEARN_SLACK_EVENTS_EXPECTED_CHANNELS: "180",
  LEARN_SLACK_EVENTS_ROSTER_SHA256: "5b8b7219d8fde33e0219f2348f64e0a6790ca840bb37b244065ae893e1f57dc6",
});
const token = savedCliToken();
const env = { ...process.env, SUPABASE_ACCESS_TOKEN: token };
const sha = value => createHash("sha256").update(value).digest("hex");

function cliCall(args) {
  const result = spawnSync(cli, args, { env, encoding: "utf8", timeout: 90000,
    maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw Error(`Slack Events config CLI failed: ${args[0]} ${args[1]}`);
  return result.stdout;
}
function digests() {
  const output = cliCall(["secrets", "list", "--project-ref", project, "--output", "json"]);
  const rows = output.split("\n").filter(line => line.includes("|"))
    .map(line => line.split("|").map(cell => cell.trim()));
  if (!rows.some(row => row[0] === "NAME")) throw Error("Secret metadata format changed");
  return Object.fromEntries(rows.map(row => [row[0], row[1]]));
}
function matches(actual, expected) {
  return Object.entries(expected).every(([name, value]) => actual[name] === sha(value));
}
async function read(query) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw Error(`LIVE roster read failed (HTTP ${response.status})`);
  return response.json();
}

const roster = await read(`select s.channel_id,s.team_id from public.slack_recurring_channels s
  where s.tenant_id='${tenant}'::uuid and s.enabled order by s.channel_id`);
if (!Array.isArray(roster) || roster.length !== 180 ||
    roster.some(row => row.team_id !== "T0CC5V4D7" || !/^C[A-Z0-9]+$/.test(row.channel_id)) ||
    new Set(roster.map(row => row.channel_id)).size !== 180 ||
    sha(roster.map(row => row.channel_id).join("\n")) !== next.LEARN_SLACK_EVENTS_ROSTER_SHA256)
  throw Error("LIVE enabled roster is not the exact reviewed 180-channel set");
const detail = await read(`select h.enabled campaign_enabled,h.ends_at,count(*)::int channels,
 count(*) filter(where s.enabled)::int enabled_channels,
 count(*) filter(where s.include_threads)::int reply_channels,
 count(*) filter(where s.next_start>=h.ends_at)::int checkpoints_at_or_after_cutoff
 from public.slack_history_campaigns h
 join public.slack_history_campaign_channels m on m.campaign_id=h.id and m.tenant_id=h.tenant_id
 left join public.slack_recurring_channels s on s.account_id=m.account_id and s.tenant_id=m.tenant_id
 where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid group by h.id`);
const d = detail?.[0];
if (!Array.isArray(detail) || detail.length !== 1 || d.campaign_enabled !== false ||
    Date.parse(d.ends_at) !== Date.parse("2026-10-13T09:30:00Z") ||
    d.channels !== 20 || d.enabled_channels !== 20 || d.reply_channels !== 20 ||
    d.checkpoints_at_or_after_cutoff !== 20)
  throw Error("Approved 20-channel reply/cutoff handoff changed");
const before = digests();
if (!matches(before, prior) && !matches(before, next))
  throw Error("LIVE Events config is neither exact prior nor exact target state");
const already = matches(before, next);
if (!already) cliCall(["secrets", "set", "--project-ref", project,
  ...Object.entries(next).map(([name, value]) => `${name}=${value}`)]);
if (!matches(digests(), next)) throw Error("LIVE Events config readback does not match exact 180 roster");
console.log(JSON.stringify({ observedAtUtc: new Date().toISOString(), project, campaign,
  enabledPublicChannels: 180, approvedHandoffChannels: 20, replyChannels: 20,
  savedCutoffUtc: "2026-10-13T09:30:00Z",
  rosterSha256: next.LEARN_SLACK_EVENTS_ROSTER_SHA256,
  receiverConfigMatched: true, alreadyApplied: already,
  signingSecretChanged: false, messageContentRead: false, productionDataWrites: false }));
