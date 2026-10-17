/** Bounded read-only provider audit of post-cutoff replies in the exact approved
 * archived public roster. Persists only aggregate counts and a root-set digest;
 * no Slack message body, channel ID, root timestamp or token is logged/saved. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--live-read-only-batch" ||
    !/^\d{1,3}$/.test(args[1]) || Number(args[1]) < 1 || Number(args[1]) > 200)
  throw Error("Exact 1–200 root read-only batch required");
const batch = Number(args[1]);
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const campaign = "b54d246b-2818-44d1-ba05-ccbe2c6bd6c9";
const team = "T0CC5V4D7", app = "A0C8G0STUKV";
const cutoff = "1791883800"; // 2026-10-13 09:30 UTC
const statePath = ".verification-results/learn-build01-slack-160-reply-provider-audit.private.json";
const sha = value => createHash("sha256").update(value).digest("hex");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sql = `with approved as (
  select h.tenant_id,h.team_id,h.ends_at,m.channel_id
  from public.slack_history_campaigns h
  join public.slack_history_campaign_channels m on m.campaign_id=h.id
    and m.tenant_id=h.tenant_id
  where h.id='${campaign}'::uuid and h.tenant_id='${tenant}'::uuid
    and h.team_id='${team}'
), candidates as (
  select a.channel_id,case
    when s.thread_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$'
      and s.thread_timestamp::numeric<s.provider_timestamp::numeric
      then s.thread_timestamp
    when coalesce(s.provider_payload->>'reply_count','') ~ '^[0-9]+$'
      and (s.provider_payload->>'reply_count')::numeric>0
      then s.provider_timestamp
    else null end root_ts
  from approved a join public.slack_messages s on s.tenant_id=a.tenant_id
    and s.team_id=a.team_id and s.channel_id=a.channel_id
  where s.provider_timestamp ~ '^[0-9]{10,12}\\.[0-9]{1,6}$'
    and s.provider_timestamp::numeric<=extract(epoch from a.ends_at)
)
select distinct channel_id,root_ts from candidates where root_ts is not null
order by channel_id,root_ts`;
const query = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
if (!query.ok) throw Error(`Approved root readback HTTP ${query.status}`);
const roots = await query.json();
if (!Array.isArray(roots) || roots.length !== 870 || roots.some(row =>
  !/^C[A-Z0-9]{8,}$/.test(row.channel_id ?? "") ||
  !/^[0-9]{10,12}\.[0-9]{1,6}$/.test(row.root_ts ?? "") ||
  Number(row.root_ts) >= Number(cutoff)))
  throw Error("Approved archived reply-root set changed");
const rootSetSha256 = sha(JSON.stringify(roots));

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

let state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { contract: "build01-slack-160-replies-provider-audit/1", project, tenant,
      campaign, cutoff, rootSetSha256, roots: roots.length, completedRoots: 0,
      checkedPages: 0, postcutoffReplies: 0, startedAt: new Date().toISOString() };
if (state.contract !== "build01-slack-160-replies-provider-audit/1" ||
    state.project !== project || state.tenant !== tenant ||
    state.campaign !== campaign || state.cutoff !== cutoff ||
    state.rootSetSha256 !== rootSetSha256 || state.roots !== roots.length ||
    !Number.isInteger(state.completedRoots) || state.completedRoots < 0 ||
    state.completedRoots > roots.length || !Number.isInteger(state.checkedPages) ||
    !Number.isInteger(state.postcutoffReplies))
  throw Error("Private audit checkpoint or approved root set changed");
state.positiveRootIndexes ??= [];
if (!Array.isArray(state.positiveRootIndexes) ||
    state.positiveRootIndexes.some(value => !Number.isInteger(value) ||
      value < 0 || value >= state.completedRoots))
  throw Error("Private positive-root checkpoint changed");
const save = () => {
  const temporary = `${statePath}.new`;
  writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n",
    { mode: 0o600, flag: "wx" });
  renameSync(temporary, statePath);
};
if (!existsSync(statePath)) save();

async function slack(method, params) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${credential.token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 429)
    throw Error("Slack rate limit reached; checkpoint retained for later resume");
  if (!response.ok) throw Error(`Slack ${method} HTTP ${response.status}`);
  const body = await response.json();
  if (!body || body.ok !== true) throw Error(`Slack ${method} ${String(body?.error ?? "unknown").slice(0, 50)}`);
  return body;
}

const checkedPublic = new Set();
const until = Math.min(roots.length, state.completedRoots + batch);
for (let index = state.completedRoots; index < until; index++) {
  const root = roots[index];
  if (!checkedPublic.has(root.channel_id)) {
    const info = await slack("conversations.info", { channel: root.channel_id });
    if (info.channel?.id !== root.channel_id || info.channel?.is_channel !== true ||
        info.channel?.is_private !== false || info.channel?.is_archived !== true)
      throw Error("Approved public archived channel state changed; audit stopped");
    checkedPublic.add(root.channel_id);
    await pause(2000);
  }
  let cursor = "", pages = 0, postcutoff = 0;
  do {
    const result = await slack("conversations.replies", {
      channel: root.channel_id, ts: root.root_ts, oldest: cutoff,
      inclusive: "true", limit: "200", ...(cursor ? { cursor } : {}),
    });
    if (!Array.isArray(result.messages) || result.messages.some(message =>
      !/^[0-9]{10,12}\.[0-9]{1,6}$/.test(message?.ts ?? "")))
      throw Error("Slack reply page shape changed");
    postcutoff += result.messages.filter(message =>
      Number(message.ts) >= Number(cutoff) &&
      message.ts !== root.root_ts).length;
    pages++;
    if (pages > 100) throw Error("Unexpected Slack thread pagination depth");
    cursor = result.response_metadata?.next_cursor ?? "";
    if (result.has_more === true && !cursor)
      throw Error("Slack reply page has_more without cursor");
    if (cursor) await pause(2000);
  } while (cursor);
  state.completedRoots = index + 1;
  state.checkedPages += pages;
  state.postcutoffReplies += postcutoff;
  if (postcutoff > 0) state.positiveRootIndexes.push(index);
  state.updatedAt = new Date().toISOString();
  save();
  await pause(2000);
}
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  campaign, approvedRosterChannels: 160,
  rootChannelsConfirmedPublicArchivedThisBatch: checkedPublic.size,
  knownParentRoots: roots.length,
  providerCompleteRoots: state.completedRoots, checkedPages: state.checkedPages,
  postcutoffRepliesObserved: state.postcutoffReplies,
  fullyChecked: state.completedRoots === roots.length,
  dmChannelsRead: false, privateChannelsRead: false, messageBodiesReturned: false,
  providerWrites: false, productionDataWrites: false,
  limitation: "Existing saved parent roots only; any unsaved parent or future reply remains outside this result." }));
