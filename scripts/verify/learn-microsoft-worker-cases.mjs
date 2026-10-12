// Actual handler + credential port + SQL queue/state transitions. Synthetic Graph
// responses only, in the network-isolated database owned by the journal harness.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { handleMicrosoftCapture } from "../../supabase/functions/_shared/microsoft_capture_handler.ts";
import { createMicrosoftCapturePorts } from "../../supabase/functions/_shared/microsoft_capture_ports.ts";
import { runMicrosoftCaptureJob } from "../../supabase/functions/_shared/microsoft_capture_job.ts";
const container = process.argv[2];
if (!/^serviceos-microsoft-journal-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Expected isolated journal container");
const sql = (text) =>
  execFileSync(
    "/usr/local/bin/docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  json = (v) => q(JSON.stringify(v)) + "::jsonb";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
sql(
  "alter table platform_jobs add column next_run_at timestamptz,add column failed_at timestamptz,add column dead_lettered_at timestamptz,add column last_error text,add column error_count integer default 0;",
);
const migration = read("supabase/migrations/20261101480000_learn_microsoft_worker_failures.sql");
const claimDefinition = () =>
  sql(
    "select pg_get_functiondef('platform_jobs_claim(text,integer,integer,text[])'::regprocedure);",
  );
const priorClaim = claimDefinition();
sql(migration.replace(/commit;\n$/, "rollback;\n"));
assert.equal(claimDefinition(), priorClaim);
assert.equal(sql("select to_regclass('learn_microsoft_job_stops') is null;"), "t");
sql(migration);
assert.equal(
  claimDefinition().replace(
    /\n      and public.learn_microsoft_job_claimable\(c.tenant_id,c.job_type,c.id\)/,
    "",
  ),
  priorClaim,
);
const tenant = uid(1000),
  account = uid(1001),
  binding = uid(1002),
  mailbox = uid(1003),
  client = uid(1004),
  directory = uid(1005);
sql(`insert into tenants values(${q(tenant)},'active');
insert into email_accounts(id,tenant_id,provider,status,auth_state,email_address) values(${q(account)},${q(tenant)},'microsoft_365','active','ok','worker@example.invalid');
insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(binding)},${q(tenant)},${q(account)},${q(directory)},${q(mailbox)},true);
insert into email_oauth_tokens(tenant_id,email_account_id,provider,access_token,refresh_token,expires_at,scope,token_type,raw_payload) values(${q(tenant)},${q(account)},'microsoft_365','PRIVATE-worker-token','PRIVATE-refresh',clock_timestamp()+interval '1 hour','Mail.Read','Bearer',${json({ learnMicrosoft: { contract: "microsoft-delegated-credential/1", microsoftTenantId: directory, mailboxId: mailbox, bindingId: binding, clientId: client } })});`);
let loseCommit = false,
  loseStop = false,
  providerCalls = 0,
  credentialCalls = 0;
const calls = [];
function invoke(name, args, role = "service_role") {
  const named = Object.entries(args)
    .map(
      ([k, v]) =>
        `${k}=>${v === null ? "null" : typeof v === "object" ? json(v) : typeof v === "number" || typeof v === "boolean" ? String(v) : q(v)}`,
    )
    .join(",");
  try {
    return {
      data: JSON.parse(sql(`set role ${role};select public.${name}(${named});`).split("\n").at(-1)),
      error: null,
    };
  } catch {
    return { data: null, error: { message: "PRIVATE database rejection" } };
  }
}
const db = {
  async rpc(name, args) {
    calls.push(name);
    if (name === "learn_microsoft_credential_read") credentialCalls++;
    const result = invoke(name, args);
    if (
      (name === "learn_microsoft_journal_commit" && loseCommit) ||
      (name === "learn_microsoft_job_stop" && loseStop)
    ) {
      loseCommit = false;
      loseStop = false;
      return { data: null, error: { message: "PRIVATE lost reply" } };
    }
    return result;
  },
};
let response = () => new Response(null, { status: 503, headers: { "retry-after": "120" } });
const deps = {
  run: runMicrosoftCaptureJob,
  ports: () => ({
    ...createMicrosoftCapturePorts(db, {
      config: () => ({ clientId: client, clientSecret: "PRIVATE-config" }),
    }),
    fetcher: async (url, init) => {
      providerCalls++;
      assert.equal(init.headers.Authorization, "Bearer PRIVATE-worker-token");
      return response(url, init);
    },
  }),
};
function job(n, { kind = "messages", attempt = 1, max = 5 } = {}) {
  const id = uid(n),
    folder = kind === "messages" ? `WorkerFolder${n}` : "",
    type = kind === "messages" ? "email.microsoft_sync" : "email.microsoft_discovery";
  const payload = {
    email_account_id: account,
    mailbox_id: mailbox,
    binding_id: binding,
    kind,
    folder_id: folder,
  };
  sql(
    `insert into platform_jobs(id,tenant_id,status,claimed_by,attempt_count,max_attempts,lease_expires_at,connector_id,module_id,job_type,payload,job_key) values(${q(id)},${q(tenant)},'running','worker',${attempt},${max},clock_timestamp()+interval '10 minutes','microsoft-365','communications.email',${q(type)},${json(payload)},${q(type + ":" + binding + ":" + folder)});`,
  );
  return {
    supabaseAdmin: db,
    tenantId: tenant,
    jobId: id,
    claim: { claimedBy: "worker", attemptCount: attempt },
    jobType: type,
    payload,
  };
}
const stored = (id) =>
  JSON.parse(sql(`select to_jsonb(j) from platform_jobs j where id=${q(id)};`));
const stopArgs = (ctx, code = "provider_unavailable", retry = 120) => ({
  p_tenant: tenant,
  p_job: ctx.jobId,
  p_worker: ctx.claim.claimedBy,
  p_claim: ctx.claim.attemptCount,
  p_code: code,
  p_retry_after: retry,
});
const pause = () =>
  sql(`insert into feature_flags values(${q(tenant)},'learn.inputs.email.enabled','false');`);
const resume = () =>
  sql(
    `delete from feature_flags where tenant_id=${q(tenant)} and flag='learn.inputs.email.enabled';`,
  );
function reclaim(ctx, worker = "replacement") {
  sql(
    `update platform_jobs set status='retrying',lease_expires_at=null,available_at=clock_timestamp()-interval '1 second' where id=${q(ctx.jobId)};`,
  );
  const rows = JSON.parse(
    sql(
      `select coalesce(jsonb_agg(j),'[]') from platform_jobs_claim(${q(worker)},50,300,array['email.microsoft_sync','email.microsoft_discovery']) j;`,
    ),
  );
  const claimed = rows.find((r) => r.id === ctx.jobId);
  return claimed
    ? { ...ctx, claim: { claimedBy: claimed.claimed_by, attemptCount: claimed.attempt_count } }
    : null;
}
const complete = (folder, id = "WorkerMessage") =>
  Response.json({
    value: [
      {
        id,
        changeKey: "V1",
        conversationId: id + "Thread",
        subject: "Synthetic worker mail",
        body: { contentType: "text", content: "Synthetic worker content" },
        bodyPreview: "Synthetic",
        from: { emailAddress: { address: "customer@example.invalid" } },
        toRecipients: [{ emailAddress: { address: "worker@example.invalid" } }],
        ccRecipients: [],
        sentDateTime: "2026-10-12T01:00:00Z",
        receivedDateTime: "2026-10-12T01:00:01Z",
        lastModifiedDateTime: "2026-10-12T01:01:00Z",
        isDraft: false,
        hasAttachments: false,
      },
    ],
    "@odata.deltaLink": `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${folder}/messages/delta?$deltatoken=synthetic`,
  });
const first = job(1010),
  before = Date.now();
let result = await handleMicrosoftCapture(first, deps);
assert.equal(result.queueOutcome.state, "retrying");
assert.equal(stored(first.jobId).status, "retrying");
assert.ok(Date.parse(stored(first.jobId).available_at) >= before + 120000);
assert.equal(stored(first.jobId).claimed_by, null);
const replay = invoke("learn_microsoft_job_stop", stopArgs(first));
assert.equal(replay.data.historicalReceipt, true);
assert.ok(invoke("learn_microsoft_job_stop", { ...stopArgs(first), p_worker: "foreign" }).error);
assert.ok(invoke("learn_microsoft_job_stop", { ...stopArgs(first), p_code: "throttled" }).error);
for (const role of ["anon", "authenticated"])
  assert.ok(invoke("learn_microsoft_job_stop", stopArgs(first), role).error);
const second = reclaim(first);
assert.ok(second);
assert.equal(second.claim.attemptCount, 2);
response = () => complete(first.payload.folder_id);
result = await handleMicrosoftCapture(second, deps);
assert.equal(result.queueOutcome.state, "completed");
assert.equal(stored(first.jobId).status, "succeeded");
assert.equal(sql(`select count(*) from email_messages where tenant_id=${q(tenant)}`), "1");
assert.ok(invoke("learn_microsoft_job_stop", stopArgs(first)).error);
// Lost failure acknowledgement is inspectable, not falsely reported as applied.
const lost = job(1011);
response = () => new Response(null, { status: 503 });
loseStop = true;
result = await handleMicrosoftCapture(lost, deps);
assert.equal(result.queueOutcome.state, "unconfirmed");
assert.equal(stored(lost.jobId).status, "retrying");
assert.equal(
  invoke("learn_microsoft_job_stop", stopArgs(lost, "provider_unavailable", null)).data
    .historicalReceipt,
  true,
);
// Pause after claim returns the attempt; due queued work is filtered before claim.
const paused = job(1012),
  tokens = credentialCalls,
  reads = providerCalls;
pause();
result = await handleMicrosoftCapture(paused, deps);
assert.equal(result.queueOutcome.state, "waiting");
assert.equal(stored(paused.jobId).attempt_count, 0);
assert.equal(credentialCalls, tokens);
assert.equal(providerCalls, reads);
assert.equal(
  invoke("learn_microsoft_job_stop", stopArgs(paused, "capture_unconfirmed", null)).data
    .historicalReceipt,
  true,
);
assert.equal(reclaim(paused), null);
assert.equal(stored(paused.jobId).attempt_count, 0);
resume();
const resumed = reclaim(paused, "worker");
assert.ok(resumed);
assert.equal(resumed.claim.attemptCount, 1);
result = await handleMicrosoftCapture(resumed, deps);
assert.equal(result.queueOutcome.state, "retrying");
assert.equal(
  sql(`select count(*) from learn_microsoft_job_stops where job_id=${q(paused.jobId)}`),
  "2",
);
// Permanent provider faults and exhausted transient retries terminate, retaining checkpoints.
for (const [n, status, attempt, max] of [
  [1013, 401, 1, 5],
  [1014, 410, 1, 5],
  [1015, 503, 2, 2],
  [1018, 429, 1, 5],
]) {
  const c = job(n, { attempt, max });
  response = () =>
    new Response(null, {
      status,
      ...(status === 429 ? { headers: { "retry-after": "31536001" } } : {}),
    });
  result = await handleMicrosoftCapture(c, deps);
  assert.equal(result.queueOutcome.state, "failed");
  assert.equal(stored(c.jobId).status, "dead_letter");
  assert.equal(
    sql(
      `select revision from learn_microsoft_capture_streams where tenant_id=${q(tenant)} and folder_id=${q(c.payload.folder_id)}`,
    ),
    "0",
  );
}
// A saved page wins over any error outcome. Replacement recovery can finish it
// while capture/account is revoked, without acquiring another token or mail page.
const uncertain = job(1016);
response = () => complete(uncertain.payload.folder_id, "RecoveredMessage");
loseCommit = true;
result = await handleMicrosoftCapture(uncertain, deps);
assert.equal(result.queueOutcome.state, "unconfirmed");
assert.equal(stored(uncertain.jobId).status, "running");
assert.equal(
  sql(`select count(*) from learn_microsoft_source_pages where job_id=${q(uncertain.jobId)}`),
  "1",
);
const fetched = providerCalls,
  credentials = credentialCalls;
pause();
sql(`update email_accounts set auth_state='revoked' where id=${q(account)};`);
const recovered = reclaim(uncertain);
assert.ok(recovered);
result = await handleMicrosoftCapture(recovered, deps);
assert.equal(result.queueOutcome.state, "completed");
assert.equal(providerCalls, fetched);
assert.equal(credentialCalls, credentials);
assert.equal(sql(`select count(*) from email_messages where tenant_id=${q(tenant)}`), "2");
resume();
sql(`update email_accounts set auth_state='ok' where id=${q(account)};`);
// Expired/replaced leases and foreign tenants cannot settle; late SQL failure
// rolls the entire queue transition and receipt back together.
const rollback = job(1017),
  stop = stopArgs(rollback);
assert.ok(invoke("learn_microsoft_job_stop", { ...stop, p_tenant: uid(9999) }).error);
assert.ok(invoke("learn_microsoft_job_stop", { ...stop, p_claim: 2 }).error);
sql(
  `update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(rollback.jobId)};`,
);
assert.ok(invoke("learn_microsoft_job_stop", stop).error);
sql(`update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 minute' where id=${q(rollback.jobId)};
create function synthetic_stop_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic_late_stop_failure';end$$;
create trigger synthetic_stop_failure after insert on learn_microsoft_job_stops for each row execute function synthetic_stop_failure();`);
assert.ok(invoke("learn_microsoft_job_stop", stop).error);
assert.equal(stored(rollback.jobId).status, "running");
assert.equal(
  sql(`select count(*) from learn_microsoft_job_stops where job_id=${q(rollback.jobId)}`),
  "0",
);
sql(
  "drop trigger synthetic_stop_failure on learn_microsoft_job_stops;drop function synthetic_stop_failure();",
);
for (const role of ["anon", "authenticated", "service_role"])
  for (const action of ["select * from", "delete from", "truncate"])
    assert.throws(() => sql(`set role ${role};${action} learn_microsoft_job_stops;`));
assert.throws(() => sql("delete from learn_microsoft_job_stops;"));
console.log(
  JSON.stringify({
    state: "passed",
    checks: [
      "Migration rollback and additive claim filtering preserve prior queue definition",
      "Actual handler retries provider failures no earlier than Retry-After, then stores one canonical email",
      "Failure replay is historical; late workers, wrong company and human roles cannot overwrite the outcome",
      "Lost failure acknowledgement stays unconfirmed until read back",
      "Pause avoids token/provider access and retry consumption; paused due jobs are not claimed",
      "Same-worker resume is not confused with a historical pause receipt",
      "Permanent faults and exhausted retries stop without replacing saved checkpoints",
      "Lost page acknowledgement retains the page; a replacement completes while paused/revoked with no second provider read",
      "Expired/replaced claims and late transaction errors leave no partial stop",
      "Stop receipts are private and immutable",
    ],
    realProviderRequests: 0,
    environment: "isolated minimal PostgreSQL; no hosted acceptance",
  }),
);
