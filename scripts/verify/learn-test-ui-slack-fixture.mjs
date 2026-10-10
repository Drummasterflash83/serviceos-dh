/** Add retained Slack thread evidence to a marked TEST browser fixture. No provider traffic. */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readImportBatchesCatalog } from "./learn-import-batches-catalog.mjs";
import { installedImportBatchesEndpoint } from "./learn-test-import-batches-endpoint-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
const [mode, path] = process.argv.slice(2),
  check = (v, s) => {
    if (!v) throw Error(s);
  },
  q = (s) => `'${String(s).replaceAll("'", "''")}'`;
check(
  ["prepare", "inspect"].includes(mode) &&
    path?.startsWith("/private/tmp/serviceos-learn-ui-") &&
    process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
  "Explicit TEST browser fixture required",
);
const plan = JSON.parse(readFileSync(path, "utf8")),
  token = savedCliToken(),
  sql = (query, readOnly = true) => communicationQuery(token, query, { readOnly });
check(
  plan.version === "learn-test-ui-fixture/1" &&
    plan.projectRef === TEST_PROJECT &&
    !plan.accessRevoked,
  "Active marked TEST browser fixture required",
);
check(
  installedImportBatchesEndpoint(
    await readImportBatchesCatalog({ allowProjectRef: TEST_PROJECT, token }),
  ),
  "Exact TEST 025 required",
);
check(
  (
    await sql(
      `select count(*)::int as n from tenants t join profiles p on p.tenant_id=t.id join auth.users u on u.id=p.id where t.id=${q(plan.tenant)} and t.metadata->>'learn_ui_run'=${q(plan.runId)} and p.id=${q(plan.user)} and p.email=${q(plan.email)} and u.raw_app_meta_data->>'learn_ui_run'=${q(plan.runId)}`,
    )
  )[0].n === 1,
  "Browser fixture markers differ",
);
async function inspect() {
  return (
    await sql(
      `select (select count(*)::int from slack_messages where tenant_id=${q(plan.tenant)}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(plan.tenant)}) as versions,(select jsonb_agg(jsonb_build_object('id',id,'previous',definition->>'resumesImportId','mode',definition#>>'{recovery,mode}','pages',checkpoint->'pages','complete',checkpoint->'complete') order by approved_at,id) from slack_thread_imports where tenant_id=${q(plan.tenant)}) as approvals,(select count(*)::int from platform_jobs where tenant_id=${q(plan.tenant)} and status in ('queued','running','retrying')) as active_jobs`,
    )
  )[0];
}
if (mode === "inspect") {
  console.log(JSON.stringify(await inspect(), null, 2));
  process.exit(0);
}
check(!plan.slack, "Existing Slack fixture requires inspection, not repeat preparation");
check(
  (
    await sql(
      "select count(*)::int as n from platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')",
    )
  )[0].n === 0,
  "Existing Slack work requires inspection",
);
const base = `https://${TEST_PROJECT}.supabase.co`;
async function request(url, headers, method = "GET", body) {
  return readAcceptanceResponse(
    await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    }),
  );
}
const keys = await request(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  { Authorization: `Bearer ${token}` },
);
check(keys.ok && Array.isArray(keys.data), "Existing TEST credentials unavailable");
function key(role) {
  const rows = keys.data.filter((k) => k.name === role);
  check(rows.length === 1, "Unique TEST key required");
  const k = rows[0].api_key,
    c = JSON.parse(Buffer.from(k.split(".")[1], "base64url"));
  check(c.ref === TEST_PROJECT && c.role === role, "Credential target differs");
  return k;
}
const anon = key("anon"),
  service = key("service_role"),
  headers = (k) => ({
    apikey: anon,
    Authorization: `Bearer ${k}`,
    "Content-Type": "application/json",
  }),
  admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
const password = readFileSync(0, "utf8").trim();
check(password.length >= 32, "Synthetic browser password required on stdin");
const login = await request(
  `${base}/auth/v1/token?grant_type=password`,
  { apikey: anon, "Content-Type": "application/json" },
  "POST",
  { email: plan.email, password },
);
check(login.ok && login.data?.user?.id === plan.user, "Fixture sign-in failed");
const rpc = async (h, name, args) => {
  const r = await request(`${base}/rest/v1/rpc/${name}`, h, "POST", args);
  check(r.ok, `Fixture ${name} failed (HTTP ${r.status}, code ${r.data?.code ?? "unknown"})`);
  return r.data;
};
plan.slack = {
  connection: randomUUID(),
  team: "T" + randomUUID().replaceAll("-", "").toUpperCase(),
  secretRef: randomUUID(),
  channel: "CUIRECOVERY",
  historyRequest: randomUUID(),
  threadRequest: randomUUID(),
  prepared: false,
};
const s = plan.slack,
  save = () => writeFileSync(path, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600 });
save();
await sql(
  `insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values(${q(s.connection)},${q(plan.tenant)},'slack','configured',jsonb_build_object('team_id',${q(s.team)},'team_name','SYNTHETIC browser Slack — no credential'),array['bot_token'],jsonb_build_object('bot_token',${q(s.secretRef)}));`,
  false,
);
const revision = (
  await sql(`select updated_at from provider_connections where id=${q(s.connection)}`)
)[0].updated_at;
const history = await rpc(headers(login.data.access_token), "learn_slack_start_import", {
  p_tenant_id: plan.tenant,
  p_request_id: s.historyRequest,
  p_connection_id: s.connection,
  p_expected_revision: revision,
  p_channel_id: s.channel,
  p_start: "2026-01-01T00:00:00Z",
  p_end: "2026-01-02T00:00:00Z",
  p_max_pages: 1,
  p_reason: "Synthetic browser thread recovery source",
});
s.account = history.accountId;
s.historyJob = history.jobId;
save();
async function publish(jobId, importId, record) {
  await sql(
    `begin;update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity' where team_id=${q(s.team)};update platform_jobs set available_at='-infinity' where id=${q(jobId)} and tenant_id=${q(plan.tenant)};commit;`,
    false,
  );
  const claims = await rpc(admin, "learn_slack_claim_jobs", { p_worker: randomUUID(), p_batch: 1 });
  check(claims.length === 1 && claims[0].id === jobId, "Fixture claim differs");
  const j = claims[0];
  const scope = (
    await sql(
      importId
        ? `select scope from slack_thread_imports where id=${q(importId)}`
        : `select settings->'slack_history' as scope from connector_accounts where id=${q(s.account)}`,
    )
  )[0].scope;
  const cp = {
    scopeKey: JSON.stringify([
      plan.tenant,
      scope.teamId,
      scope.channelId,
      scope.oldest,
      scope.latest,
      scope.consentReference,
      ...(importId ? [scope.parentTimestamp] : []),
    ]),
    cursor: null,
    pages: 0,
    complete: false,
  };
  const common = {
    p_tenant_id: plan.tenant,
    p_job_id: jobId,
    p_claimed_by: j.claimed_by,
    p_attempt_count: j.attempt_count,
  };
  check(
    (await rpc(admin, importId ? "slack_thread_commit_page" : "slack_history_commit_page", {
      ...common,
      ...(importId ? { p_import_id: importId } : { p_account_id: s.account }),
      p_expected: cp,
      p_next: {
        ...cp,
        pages: 1,
        cursor: importId ? "synthetic-ui-thread-cursor" : null,
        complete: !importId,
      },
      p_records: [record],
    })) === true,
    "Fixture page failed",
  );
  check(
    (
      await rpc(admin, importId ? "learn_slack_finish_thread_job" : "learn_slack_finish_job", {
        ...common,
        p_outcome: { success: true },
      })
    ).status === "succeeded",
    "Fixture settlement failed",
  );
}
const parent = "1767225700.000001",
  record = (ts, text) => ({
    tenant_id: plan.tenant,
    channel_id: s.channel,
    source_external_id: `${s.team}:${s.channel}:${ts}`,
    provider_timestamp: ts,
    thread_timestamp: parent,
    text,
    provider_payload: { ts, thread_ts: parent, text, ...(ts === parent ? { reply_count: 2 } : {}) },
  });
await publish(
  history.jobId,
  null,
  record(parent, "SYNTHETIC browser thread awaiting more replies"),
);
const root = (
  await sql(
    `select id,source_version from slack_messages where tenant_id=${q(plan.tenant)} and provider_timestamp=${q(parent)}`,
  )
)[0];
const thread = await rpc(headers(login.data.access_token), "learn_slack_start_thread_import", {
  p_tenant_id: plan.tenant,
  p_request_id: s.threadRequest,
  p_account_id: s.account,
  p_source_message_id: root.id,
  p_source_version: root.source_version,
  p_connection_revision: revision,
  p_start: "2026-01-01T00:00:00Z",
  p_end: "2026-01-02T00:00:00Z",
  p_max_pages: 1,
  p_reason: "Synthetic incomplete browser thread",
});
s.threadJob = thread.jobId;
save();
await publish(
  thread.jobId,
  s.threadRequest,
  record("1767225800.000001", "SYNTHETIC retained browser reply"),
);
s.prepared = true;
save();
console.log(JSON.stringify(await inspect(), null, 2));
