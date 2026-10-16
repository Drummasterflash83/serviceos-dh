/** Content-free LIVE readback for the approved 20-channel campaign handoff. */
import { createHash } from "node:crypto";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "a3980d74-29fa-4655-a914-61219cdf7dad";
const team = "T0CC5V4D7";
const beforeDigest = "e1417e972f9a319340446e7410d071cb120e8cc80e23b2a91cd66370183a315b";
const afterDigest = "5b8b7219d8fde33e0219f2348f64e0a6790ca840bb37b244065ae893e1f57dc6";
const query = `select channel_id,team_id,'enabled' source from public.slack_recurring_channels
 where tenant_id='${tenant}'::uuid and enabled
 union all
 select m.channel_id,h.team_id,'campaign' source from public.slack_history_campaign_channels m
 join public.slack_history_campaigns h on h.id=m.campaign_id
 where m.campaign_id='${campaign}'::uuid and m.tenant_id='${tenant}'::uuid`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE Slack handoff roster HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || ![180, 200].includes(rows.length) ||
    rows.some(row => row.team_id !== team || !/^C[A-Z0-9]+$/.test(row.channel_id)) ||
    rows.filter(row => row.source === "campaign").length !== 20)
  throw Error("Approved campaign roster shape changed");
const enabled = rows.filter(row => row.source === "enabled").map(row => row.channel_id);
const historical = rows.filter(row => row.source === "campaign").map(row => row.channel_id);
const unique = values => new Set(values).size === values.length;
const digest = values => createHash("sha256").update([...values].sort().join("\n")).digest("hex");
if (!unique(enabled) || !unique(historical)) throw Error("Duplicate enabled or campaign channel");
const current = digest(enabled);
const prospective = digest([...new Set([...enabled, ...historical])]);
const state = enabled.length === 160 && unique([...enabled, ...historical]) &&
  current === beforeDigest && prospective === afterDigest ? "pre_handoff" :
  enabled.length === 180 && historical.every(id => enabled.includes(id)) &&
  current === afterDigest ? "post_handoff" : null;
if (!state) throw Error("LIVE Slack roster differs from the exact approved 160+20 handoff");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  campaign, state, enabledChannels: enabled.length, campaignChannels: historical.length,
  uniqueEnabledChannels: new Set(enabled).size, currentRosterSha256: current,
  postHandoffRosterSha256: afterDigest, channelIdsReturned: false,
  productionDataWrites: false }));
