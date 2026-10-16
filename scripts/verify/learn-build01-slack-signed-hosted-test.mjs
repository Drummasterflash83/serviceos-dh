/** Hosted TEST-only signed Slack boundary proof with a temporary synthetic roster. */
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--test-synthetic" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST-only synthetic signed-boundary mode required");
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const token = savedCliToken();
const team = "TTESTB01", app = "ATESTB01", channel = "CTESTB01";
const minTs = `${Math.floor(Date.now() / 1000) - 3600}.000000`;
const secret = randomBytes(48).toString("hex");
const rosterSha = createHash("sha256").update(channel).digest("hex");
const work = mkdtempSync(join(tmpdir(), "build01-slack-signed-hosted-"));
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
let fixture = null, secretsSet = false, cleanupError = null;

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
function cliSecret(args) {
  const result = spawnSync(cli, [...args, "--project-ref", TEST_PROJECT], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw Error("TEST Edge secret operation unconfirmed");
}
async function signed(payload, overrideSignature) {
  const body = JSON.stringify(payload);
  const sent = String(Math.floor(Date.now() / 1000));
  const signature = "v0=" + createHmac("sha256", secret)
    .update(`v0:${sent}:${body}`).digest("hex");
  const response = await fetch(
    `https://${TEST_PROJECT}.supabase.co/functions/v1/learn-slack-events`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { "content-type": "application/json", "x-slack-request-timestamp": sent,
        "x-slack-signature": overrideSignature ?? signature },
      body,
    });
  return { status: response.status, body: await response.json().catch(() => null) };
}
try {
  const endpoint = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions/learn-slack-events`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
  });
  if (!endpoint.ok) throw Error("TEST receiver inventory unavailable");
  const deployed = await endpoint.json();
  if (deployed.status !== "ACTIVE" || deployed.verify_jwt !== false)
    throw Error("TEST receiver baseline changed");
  const [empty] = await sql(`select count(*)::int roster from public.slack_recurring_channels
    where enabled and team_id='${team}'`);
  if (empty?.roster !== 0) throw Error("Synthetic TEST team already has a roster");
  const chosen = await sql(`select a.id::text account_id,a.tenant_id::text tenant_id,
    c.id::text connection_id,c.updated_at::text connection_revision,p.id::text profile_id
    from public.connector_accounts a
    join public.provider_connections c on c.tenant_id=a.tenant_id
      and c.id=(a.settings->'slack_history'->>'connectionId')::uuid
    join public.profiles p on p.tenant_id=a.tenant_id
    where a.settings->'slack_history'->>'teamId' ~ '^T[A-Z0-9]+$'
      and not exists(select 1 from public.slack_recurring_channels s where s.account_id=a.id)
    order by a.id,p.id limit 1`);
  if (chosen.length !== 1 ||
      ![chosen[0].account_id, chosen[0].tenant_id,
        chosen[0].connection_id, chosen[0].profile_id].every(v => uuid.test(v)))
    throw Error("TEST fixture foreign keys unavailable");
  fixture = chosen[0];
  const inserted = await sql(`begin;
    set local lock_timeout='5s'; set local statement_timeout='30s';
    insert into public.slack_recurring_channels(account_id,tenant_id,connection_id,
      connection_revision,team_id,channel_id,approved_by,enabled,next_start,next_check_at)
    select '${fixture.account_id}'::uuid,'${fixture.tenant_id}'::uuid,
      '${fixture.connection_id}'::uuid,'${fixture.connection_revision}'::timestamptz,
      '${team}','${channel}','${fixture.profile_id}'::uuid,true,clock_timestamp(),
      '2099-01-01T00:00:00Z'::timestamptz
    where not exists(select 1 from public.slack_recurring_channels
      where account_id='${fixture.account_id}'::uuid);
    select count(*)::int fixture_rows from public.slack_recurring_channels
      where account_id='${fixture.account_id}'::uuid and team_id='${team}'
        and channel_id='${channel}' and enabled and next_check_at>'2098-01-01'::timestamptz;
    commit;`, false);
  if (!inserted.some(row => row.fixture_rows === 1))
    throw Error("Synthetic TEST roster insert unconfirmed");
  const envFile = join(work, "slack-test.env");
  writeFileSync(envFile, [
    `LEARN_SLACK_EVENTS_ACTIVE=true`,
    `LEARN_SLACK_EVENTS_TENANT_ID=${fixture.tenant_id}`,
    `LEARN_SLACK_EVENTS_TEAM_ID=${team}`,
    `LEARN_SLACK_EVENTS_APP_ID=${app}`,
    `LEARN_SLACK_EVENTS_SIGNING_SECRET=${secret}`,
    `LEARN_SLACK_EVENTS_MIN_TS=${minTs}`,
    `LEARN_SLACK_EVENTS_EXPECTED_CHANNELS=1`,
    `LEARN_SLACK_EVENTS_ROSTER_SHA256=${rosterSha}`,
    "",
  ].join("\n"), { mode: 0o600 });
  secretsSet = true;
  cliSecret(["secrets", "set", "--env-file", envFile]);
  const challenge = { type: "url_verification", team_id: team,
    api_app_id: app, challenge: "syntheticChallengeB01" };
  const invalid = await signed(challenge, "v0=" + "0".repeat(64));
  assert.equal(invalid.status, 401);
  const valid = await signed(challenge);
  assert.equal(valid.status, 200);
  assert.deepEqual(valid.body, { challenge: challenge.challenge });
  const outOfScope = await signed({ type: "event_callback", team_id: team,
    api_app_id: app, event_id: "EvSyntheticB01", event: { type: "message",
      channel_type: "im", channel, ts: `${Math.floor(Date.now() / 1000)}.123456` } });
  assert.equal(outOfScope.status, 200);
  assert.deepEqual(outOfScope.body, { ok: true, ignored: true });
  const counts = await sql(`select
    (select count(*)::int from public.learn_slack_event_hints
      where tenant_id='${fixture.tenant_id}'::uuid and team_id='${team}') hints,
    (select count(*)::int from public.platform_jobs
      where tenant_id='${fixture.tenant_id}'::uuid
        and job_type='slack.event_sync'
        and job_key='slack.event:EvSyntheticB01') synthetic_event_jobs`);
  if (counts[0]?.hints !== 0 || counts[0]?.synthetic_event_jobs !== 0)
    throw Error("Synthetic boundary test unexpectedly recorded a hint or job");
  console.log(JSON.stringify({ state: "hosted_signed_boundary_pass", project: TEST_PROJECT,
    invalidSignatureRejected: true, signedChallengeAccepted: true,
    signedDmExcluded: true, hints: 0, eventJobs: 0, providerRequests: 0 }));
} finally {
  try {
    if (secretsSet) cliSecret(["secrets", "unset",
      "LEARN_SLACK_EVENTS_ACTIVE", "LEARN_SLACK_EVENTS_TENANT_ID",
      "LEARN_SLACK_EVENTS_TEAM_ID", "LEARN_SLACK_EVENTS_APP_ID",
      "LEARN_SLACK_EVENTS_SIGNING_SECRET", "LEARN_SLACK_EVENTS_MIN_TS",
      "LEARN_SLACK_EVENTS_EXPECTED_CHANNELS", "LEARN_SLACK_EVENTS_ROSTER_SHA256"]);
    secretsSet = false;
  } catch { cleanupError = "TEST signing configuration cleanup unconfirmed"; }
  try {
    if (fixture) {
      const cleaned = await sql(`begin;
        set local lock_timeout='5s'; set local statement_timeout='30s';
        delete from public.slack_recurring_channels
          where account_id='${fixture.account_id}'::uuid and team_id='${team}'
            and channel_id='${channel}' and enabled
            and next_check_at>'2098-01-01'::timestamptz;
        select count(*)::int remaining from public.slack_recurring_channels
          where account_id='${fixture.account_id}'::uuid and team_id='${team}';
        commit;`, false);
      if (!cleaned.some(row => row.remaining === 0))
        throw Error("TEST fixture cleanup unconfirmed");
    }
  } catch { cleanupError = "TEST roster cleanup unconfirmed"; }
  rmSync(work, { recursive: true, force: true });
  if (cleanupError) throw Error(cleanupError);
}
