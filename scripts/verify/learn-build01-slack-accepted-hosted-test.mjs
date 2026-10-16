/** TEST-only signed public-channel event, durable queue, and exact cleanup. */
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--test-synthetic-accepted", "--test-synthetic-load"].includes(mode) ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST-only accepted-event or load mode required");
const eventCount = mode === "--test-synthetic-load" ? 12 : 1;
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const token = savedCliToken();
const nonce = randomBytes(8).toString("hex").toUpperCase();
const marker = `build01-slack-accepted-${nonce.toLowerCase()}`;
const tenant = randomUUID(), connector = randomUUID(), connection = randomUUID();
const account = randomUUID(), secretRef = randomUUID();
const team = `TTEST${nonce}`, app = `ATEST${nonce}`, channel = `CTEST${nonce}`;
const eventPrefix = `EvTEST${nonce}`;
const eventIds = Array.from({ length: eventCount }, (_, i) =>
  eventCount === 1 ? eventPrefix : `${eventPrefix}${String(i).padStart(2, "0")}`);
const signingSecret = randomBytes(48).toString("hex");
const minTs = `${Math.floor(Date.now() / 1000) - 3600}.000000`;
const rosterSha = createHash("sha256").update(channel).digest("hex");
const work = mkdtempSync(join(tmpdir(), "build01-slack-accepted-"));
let fixtureStarted = false, secretsMayExist = false, cleanupIssue = null;

async function sql(query, readOnly = true) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, read_only: readOnly }),
    });
  if (!response.ok) throw Error(`TEST SQL ${readOnly ? "read" : "write"} HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("TEST SQL shape changed");
  return rows;
}
function secretOperation(args) {
  const result = spawnSync(cli, [...args, "--project-ref", TEST_PROJECT], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw Error("TEST signing configuration operation unconfirmed");
}
async function signed(payload) {
  const body = JSON.stringify(payload), sent = String(Math.floor(Date.now() / 1000));
  const signature = "v0=" + createHmac("sha256", signingSecret)
    .update(`v0:${sent}:${body}`).digest("hex");
  const response = await fetch(
    `https://${TEST_PROJECT}.supabase.co/functions/v1/learn-slack-events`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json", "x-slack-request-timestamp": sent,
        "x-slack-signature": signature }, body,
    });
  return { status: response.status, body: await response.json().catch(() => null) };
}
try {
  const [baseline] = await sql(`select
    to_regclass('cron.job') is not null cron_present,
    (select count(*)::int from public.slack_recurring_channels
      where team_id='${team}' or channel_id='${channel}') synthetic_roster,
    (select count(*)::int from public.learn_slack_event_hints
      where event_id like '${eventPrefix}%') synthetic_hints`);
  if (baseline?.cron_present !== false || baseline.synthetic_roster !== 0 ||
      baseline.synthetic_hints !== 0)
    throw Error("TEST isolated event baseline changed");
  const [operator] = await sql(`select p.id::text approver
    from public.profiles p join public.platform_authority_grants g on g.profile_id=p.id
    where g.permission='platform.controlplane.admin'
      and coalesce(g.effective_from,'-infinity')<=clock_timestamp()
      and coalesce(g.effective_to,'infinity')>clock_timestamp()
      and not exists(select 1 from public.view_as_context v
        where v.actor_user_id=p.id and v.ended_at is null
          and (v.expires_at is null or v.expires_at>clock_timestamp()))
    order by p.id limit 1`);
  if (!/^[a-f0-9-]{36}$/i.test(operator?.approver ?? ""))
    throw Error("TEST operator approval fixture unavailable");
  fixtureStarted = true;
  const created = await sql(`begin;
    set local lock_timeout='5s'; set local statement_timeout='30s';
    insert into public.tenants(id,slug,display_name,status,metadata)
      values('${tenant}'::uuid,'${marker}','SYNTHETIC signed Slack event','active',
        jsonb_build_object('synthetic',true,'build01_slack_event','${marker}'));
    insert into public.tenant_connectors(id,tenant_id,connector_id,provider,
      category,status,enabled)
      values('${connector}'::uuid,'${tenant}'::uuid,'slack','slack',
        'communications','active',true);
    insert into public.provider_connections(id,tenant_id,provider,status,
      non_secret_config,configured_fields,secret_refs)
      values('${connection}'::uuid,'${tenant}'::uuid,'slack','configured',
        jsonb_build_object('team_id','${team}','team_name','SYNTHETIC NO CREDENTIAL'),
        array['bot_token'],jsonb_build_object('bot_token','${secretRef}'));
    insert into public.connector_accounts(id,tenant_connector_id,tenant_id,
      account_key,status,settings,sync_cursor)
      values('${account}'::uuid,'${connector}'::uuid,'${tenant}'::uuid,
        '${team}:${channel}','active',jsonb_build_object('slack_history',
          jsonb_build_object('approved',true,'connectionId','${connection}',
            'teamId','${team}','channelId','${channel}')),
        jsonb_build_object('complete',true));
    insert into public.slack_recurring_channels(account_id,tenant_id,connection_id,
      connection_revision,team_id,channel_id,approved_by,enabled,
      next_start,next_check_at,include_threads)
      select '${account}'::uuid,'${tenant}'::uuid,'${connection}'::uuid,
        c.updated_at,'${team}','${channel}','${operator.approver}'::uuid,
        true,clock_timestamp()-interval '30 minutes',
        '2099-01-01T00:00:00Z'::timestamptz,true
      from public.provider_connections c where c.id='${connection}'::uuid;
    insert into public.slack_workspace_pacing(team_id,next_allowed_at,
      blocked_until,last_started_at)
      values('${team}','2099-01-01T00:00:00Z'::timestamptz,
        '2099-01-01T00:00:00Z'::timestamptz,clock_timestamp());
    select (select count(*)::int from public.slack_recurring_channels
      where tenant_id='${tenant}'::uuid and enabled) roster,
      (select count(*)::int from public.slack_workspace_pacing
        where team_id='${team}' and blocked_until>'2098-01-01'::timestamptz) paced;
    commit;`, false);
  if (!created.some(row => row.roster === 1 && row.paced === 1))
    throw Error("Synthetic TEST event fixture unconfirmed");
  const envFile = join(work, "accepted.env");
  writeFileSync(envFile, [
    "LEARN_SLACK_EVENTS_ACTIVE=true",
    `LEARN_SLACK_EVENTS_TENANT_ID=${tenant}`,
    `LEARN_SLACK_EVENTS_TEAM_ID=${team}`,
    `LEARN_SLACK_EVENTS_APP_ID=${app}`,
    `LEARN_SLACK_EVENTS_SIGNING_SECRET=${signingSecret}`,
    `LEARN_SLACK_EVENTS_MIN_TS=${minTs}`,
    "LEARN_SLACK_EVENTS_EXPECTED_CHANNELS=1",
    `LEARN_SLACK_EVENTS_ROSTER_SHA256=${rosterSha}`,
    "",
  ].join("\n"), { mode: 0o600 });
  secretsMayExist = true;
  secretOperation(["secrets", "set", "--env-file", envFile]);
  const events = eventIds.map((eventId, i) => ({ type: "event_callback",
    team_id: team, api_app_id: app, event_id: eventId,
    event: { type: "message", channel_type: "channel", channel,
      ts: `${Math.floor(Date.now() / 1000)}.${String(123456 + i).padStart(6, "0")}`,
      text: "SYNTHETIC BODY MUST NOT BE SAVED" } }));
  const acknowledgementMs = [];
  for (let i = 0; i < events.length; i += 4) {
    const batch = await Promise.all(events.slice(i, i + 4).map(async (event) => {
      const started = performance.now();
      const result = await signed(event);
      acknowledgementMs.push(performance.now() - started);
      return result;
    }));
    for (const result of batch)
      assert.deepEqual(result, { status: 200, body: { ok: true } });
  }
  const duplicate = await signed(events[0]);
  assert.deepEqual(duplicate, { status: 200, body: { ok: true } });
  const [durable] = await sql(`select
    count(*)::int hints,
    count(*) filter(where h.state='pending' and h.job_id=j.id)::int linked_pending,
    count(*) filter(where j.status='queued' and j.job_type='slack.event_sync'
      and j.job_key='slack.event:'||h.event_id)::int queued_jobs,
    count(*) filter(where position('SYNTHETIC BODY' in h::text)>0
      or position('SYNTHETIC BODY' in j.payload::text)>0)::int body_retained
    from public.learn_slack_event_hints h
    join public.platform_jobs j on j.id=h.job_id and j.tenant_id=h.tenant_id
    where h.tenant_id='${tenant}'::uuid and h.event_id like '${eventPrefix}%'`);
  if (durable?.hints !== eventCount || durable.linked_pending !== eventCount ||
      durable.queued_jobs !== eventCount || durable.body_retained !== 0)
    throw Error("TEST durable event/queue result changed");
  const gate = await sql(`begin;
    set local role service_role;
    set local request.jwt.claim.role='service_role';
    select public.learn_slack_event_job_allowed('${tenant}'::uuid,j.id) allowed
      from public.platform_jobs j where j.tenant_id='${tenant}'::uuid
        and j.job_key like 'slack.event:${eventPrefix}%';
    rollback;`, false);
  if (gate.filter(row => row.allowed === true).length !== eventCount)
    throw Error("TEST service-only event job gate did not confirm");
  acknowledgementMs.sort((a, b) => a - b);
  console.log(JSON.stringify({ state: eventCount === 1
    ? "hosted_accepted_event_pass" : "hosted_event_load_pass", project: TEST_PROJECT,
    signedEventsAccepted: eventCount, duplicateAcknowledged: true,
    hints: eventCount, queuedJobs: eventCount, serviceJobGate: true,
    p95ReceiverAcknowledgementMs: Math.round(acknowledgementMs[
      Math.ceil(acknowledgementMs.length * 0.95) - 1]),
    eventBodyRetained: false, providerRequests: 0, sourceProviderWrites: 0 }));
} finally {
  try {
    if (secretsMayExist) secretOperation(["secrets", "unset",
      "LEARN_SLACK_EVENTS_ACTIVE", "LEARN_SLACK_EVENTS_TENANT_ID",
      "LEARN_SLACK_EVENTS_TEAM_ID", "LEARN_SLACK_EVENTS_APP_ID",
      "LEARN_SLACK_EVENTS_SIGNING_SECRET", "LEARN_SLACK_EVENTS_MIN_TS",
      "LEARN_SLACK_EVENTS_EXPECTED_CHANNELS", "LEARN_SLACK_EVENTS_ROSTER_SHA256"]);
    secretsMayExist = false;
  } catch { cleanupIssue = "TEST signing configuration cleanup unconfirmed"; }
  try {
    if (fixtureStarted) {
      const cleaned = await sql(`begin;
        set local lock_timeout='5s'; set local statement_timeout='30s';
        delete from public.learn_slack_event_hints
          where tenant_id='${tenant}'::uuid and event_id like '${eventPrefix}%';
        delete from public.platform_jobs
          where tenant_id='${tenant}'::uuid and job_key like 'slack.event:${eventPrefix}%';
        delete from public.slack_workspace_pacing where team_id='${team}';
        delete from public.slack_recurring_channels
          where account_id='${account}'::uuid and tenant_id='${tenant}'::uuid;
        -- Connector rows are retained by TEST's immutable-source triggers.
        -- Make the synthetic fixture inert while preserving its audit trail.
        update public.tenant_connectors set enabled=false
          where id='${connector}'::uuid and tenant_id='${tenant}'::uuid;
        update public.provider_connections set revoked_at=clock_timestamp()
          where id='${connection}'::uuid and tenant_id='${tenant}'::uuid;
        select (select count(*)::int from public.tenants where id='${tenant}'::uuid) tenants,
          (select count(*)::int from public.learn_slack_event_hints
            where tenant_id='${tenant}'::uuid) hints,
          (select count(*)::int from public.platform_jobs
            where tenant_id='${tenant}'::uuid and status in ('queued','retrying','running')) active_jobs,
          (select count(*)::int from public.slack_recurring_channels
            where tenant_id='${tenant}'::uuid) roster,
          (select count(*)::int from public.tenant_connectors
            where id='${connector}'::uuid and enabled) enabled_connectors,
          (select count(*)::int from public.provider_connections
            where id='${connection}'::uuid and revoked_at is null) live_connections;
        commit;`, false);
      if (!cleaned.some(row => row.tenants === 1 && row.hints === 0 &&
          row.active_jobs === 0 && row.roster === 0 &&
          row.enabled_connectors === 0 && row.live_connections === 0))
        throw Error("TEST synthetic fixture cleanup unconfirmed");
    }
  } catch { cleanupIssue = "TEST synthetic fixture cleanup unconfirmed"; }
  rmSync(work, { recursive: true, force: true });
  if (cleanupIssue) throw Error(cleanupIssue);
}
