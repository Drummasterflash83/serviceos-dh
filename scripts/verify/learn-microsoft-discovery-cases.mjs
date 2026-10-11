/** Actual queue claim -> retained delta -> due successor; isolated synthetic DB only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runMicrosoftCaptureJob } from "../../supabase/functions/_shared/microsoft_capture_job.ts";
import { runMicrosoftCapturePage } from "../../supabase/functions/_shared/microsoft_capture_engine.ts";
const container = process.argv[2];
if (!/^serviceos-microsoft-journal-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Isolated journal container required");
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const json = (v) => q(JSON.stringify(v)) + "::jsonb";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const fn = "learn_microsoft_job_settle_before_projection(uuid,uuid,text,integer,boolean)";
const prior = sql(`select pg_get_functiondef('${fn}'::regprocedure);`);
const authority = sql(
  `select proowner::text||coalesce(proacl::text,'') from pg_proc where oid='${fn}'::regprocedure;`,
);
const baseline = sql(
  "select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.id),'')) from learn_microsoft_source_pages x;select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.job_id),'')) from learn_microsoft_job_completions x;",
);
const migration = read(
  "supabase/migrations/20261101350000_learn_microsoft_recurring_discovery.sql",
);
sql(migration.replace(/commit;\n$/, "rollback;\n"));
assert.equal(sql(`select pg_get_functiondef('${fn}'::regprocedure);`), prior);
assert.equal(sql("select to_regclass('learn_microsoft_discovery_rounds') is null;"), "t");
sql(migration);
assert.equal(
  sql(
    `select proowner::text||coalesce(proacl::text,'') from pg_proc where oid='${fn}'::regprocedure;`,
  ),
  authority,
);
assert.equal(
  sql(
    "select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.id),'')) from learn_microsoft_source_pages x;select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.job_id),'')) from learn_microsoft_job_completions x;",
  ),
  baseline,
);
const t = uid(800),
  a = uid(801),
  m = uid(802),
  b = uid(803);
sql(
  `insert into tenants values(${q(t)},'active');insert into email_accounts(id,tenant_id,provider,status,auth_state) values(${q(a)},${q(t)},'microsoft_365','active','ok');insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(b)},${q(t)},${q(a)},${q(uid(804))},${q(m)},true);`,
);
function create(n, folder, kind = "messages") {
  const jobType = kind === "messages" ? "email.microsoft_sync" : "email.microsoft_discovery";
  const payload = { email_account_id: a, mailbox_id: m, binding_id: b, kind, folder_id: folder };
  sql(
    `insert into platform_jobs(id,tenant_id,status,claimed_by,attempt_count,lease_expires_at,connector_id,module_id,job_type,payload,job_key) values(${q(uid(n))},${q(t)},'running','recurring-worker',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email',${q(jobType)},${json(payload)},${q(`${jobType}:${b}:${folder}`)});`,
  );
  return { tenantId: t, jobId: uid(n), claimedBy: "recurring-worker", attemptCount: 1 };
}
let tokenCalls = 0,
  graphCalls = 0,
  lose = false;
const allowed = new Set([
  "learn_microsoft_job_settle",
  "learn_microsoft_journal_job",
  "learn_microsoft_journal_open",
  "learn_microsoft_journal_commit",
]);
const db = {
  rpc: async (name, args) => {
    assert.ok(allowed.has(name));
    const named = Object.entries(args)
      .map(
        ([key, v]) =>
          `${key}=>${typeof v === "object" && v !== null ? json(v) : v === null ? "null" : typeof v === "boolean" ? String(v) : q(v)}`,
      )
      .join(",");
    try {
      const data = JSON.parse(
        sql(`set role service_role;select ${name}(${named});`).split("\n").at(-1),
      );
      if (lose && name === "learn_microsoft_job_settle" && args.p_apply) {
        lose = false;
        return { data: null, error: { message: "synthetic lost reply" } };
      }
      return { data, error: null };
    } catch {
      return { data: null, error: { message: "synthetic SQL refusal" } };
    }
  },
};
const ports = (pages, urls = []) => ({
  accessToken: async () => {
    tokenCalls++;
    return "synthetic";
  },
  fetcher: async (url) => {
    graphCalls++;
    urls.push(String(url));
    assert.ok(pages.length, "Unexpected provider request");
    return Response.json(pages.shift());
  },
});
const base = (folder) =>
  `https://graph.microsoft.com/v1.0/users/${m}/mailFolders/${folder}/messages/delta`;
const finish = (claim) =>
  `set role service_role;select learn_microsoft_job_settle(${q(t)},${q(claim.jobId)},'recurring-worker',1,true);`;
const getJob = (id) =>
  JSON.parse(sql(`select to_jsonb(j) from platform_jobs j where id=${q(id)};`));
const folder = (id) => ({
  id,
  parentFolderId: "Root",
  displayName: "Synthetic " + id,
  childFolderCount: 0,
  totalItemCount: 0,
  unreadItemCount: 0,
  isHidden: false,
});
const claimSql =
  "select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from platform_jobs_claim('recurring-worker',50,300,array['email.microsoft_discovery']) j;";
function due(id) {
  sql(
    `update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=${q(id)};`,
  );
  const job = JSON.parse(sql(claimSql)).find((j) => j.id === id);
  assert.ok(job);
  return { tenantId: t, jobId: id, claimedBy: job.claimed_by, attemptCount: job.attempt_count };
}
const first = create(810, "", "folders");
const root = await runMicrosoftCaptureJob(db, first, ports([{ value: [folder("Inbox")] }]));
assert.equal(root.continuationKind, "page");
const last = due(root.successorId);
lose = true;
await assert.rejects(
  runMicrosoftCaptureJob(db, last, ports([{ value: [] }])),
  (e) => e.code === "settlement_unconfirmed",
);
const calls = graphCalls;
const end = await runMicrosoftCaptureJob(db, last, ports([]));
assert.equal(graphCalls, calls);
assert.equal(end.continuationKind, "discovery");
assert.ok(Date.parse(end.nextCheckAt) >= Date.now() + 898000);
assert.ok(!JSON.parse(sql(claimSql)).some((j) => j.id === end.successorId));
assert.equal(getJob(end.successorId).status, "queued");
const stream = JSON.parse(
  sql(
    `select to_jsonb(s) from learn_microsoft_capture_streams s where tenant_id=${q(t)} and kind='folders';`,
  ),
);
assert.equal(stream.revision, 3);
assert.deepEqual(stream.checkpoint.pending, [{ parentFolderId: null, nextUrl: null }]);
assert.equal(
  sql(`select count(*) from learn_microsoft_discovery_rounds where tenant_id=${q(t)};`),
  "1",
);
const retained = sql(
  `select md5(string_agg(to_jsonb(p)::text,'' order by id)) from learn_microsoft_source_pages p where tenant_id=${q(t)};`,
);
const originalDispatch = sql(
  `select to_jsonb(d) from learn_microsoft_folder_dispatches d where tenant_id=${q(t)};`,
);
const next = due(end.successorId);
for (const [pause, resume] of [
  [
    `insert into feature_flags values(${q(t)},'learn.inputs.email.enabled','false')`,
    `delete from feature_flags where tenant_id=${q(t)}`,
  ],
  [
    `insert into feature_flags values(${q(t)},'learn.enabled','false')`,
    `delete from feature_flags where tenant_id=${q(t)}`,
  ],
  [
    `update learn_microsoft_mailbox_bindings set enabled=false where id=${q(b)}`,
    `update learn_microsoft_mailbox_bindings set enabled=true where id=${q(b)}`,
  ],
  [
    `update email_accounts set auth_state='revoked' where id=${q(a)}`,
    `update email_accounts set auth_state='ok' where id=${q(a)}`,
  ],
  [
    `update email_accounts set status='disabled' where id=${q(a)}`,
    `update email_accounts set status='active' where id=${q(a)}`,
  ],
]) {
  sql(pause);
  const tokens = tokenCalls;
  await assert.rejects(
    runMicrosoftCaptureJob(db, next, ports([])),
    (e) => e.code === "stream_unconfirmed",
  );
  assert.equal(tokenCalls, tokens);
  sql(resume);
}
const urls = [];
const second = await runMicrosoftCaptureJob(
  db,
  next,
  ports([{ value: [folder("Inbox"), folder("NewFolder")] }], urls),
);
assert.ok(urls[0].startsWith(`https://graph.microsoft.com/v1.0/users/${m}/mailFolders?`));
assert.equal(second.folderDispatch.newJobs, 1);
assert.equal(second.folderDispatch.previouslyDispatched, 1);
assert.equal(
  sql(
    `select to_jsonb(d) from learn_microsoft_folder_dispatches d where tenant_id=${q(t)} and folder_id='Inbox';`,
  ),
  originalDispatch,
);
const child = await runMicrosoftCaptureJob(db, due(second.successorId), ports([{ value: [] }]));
assert.equal(child.continuationKind, "page");
const terminal = due(child.successorId);
await runMicrosoftCapturePage(db, terminal, ports([{ value: [] }]));
const terminalState = sql(
  `select to_jsonb(s) from learn_microsoft_capture_streams s where tenant_id=${q(t)} and kind='folders';`,
);
// Failure late in settlement must roll back scan reset, audit and successor together.
sql(
  `create function discovery_failure() returns trigger language plpgsql as $$begin if new.job_id=${q(terminal.jobId)}::uuid then raise exception 'synthetic_failure';end if;return new;end$$;create trigger discovery_failure before insert on learn_microsoft_job_completions for each row execute function discovery_failure();`,
);
await assert.rejects(
  runMicrosoftCaptureJob(db, terminal, ports([])),
  (e) => e.code === "settlement_unconfirmed",
);
assert.equal(getJob(terminal.jobId).status, "running");
assert.equal(
  sql(`select count(*) from platform_jobs where parent_job_id=${q(terminal.jobId)};`),
  "0",
);
assert.equal(
  sql(`select count(*) from learn_microsoft_discovery_rounds where tenant_id=${q(t)};`),
  "1",
);
assert.equal(
  sql(
    `select to_jsonb(s) from learn_microsoft_capture_streams s where tenant_id=${q(t)} and kind='folders';`,
  ),
  terminalState,
);
sql(
  "drop trigger discovery_failure on learn_microsoft_job_completions;drop function discovery_failure();",
);
const recovered = await runMicrosoftCaptureJob(db, terminal, ports([]));
assert.equal(recovered.continuationKind, "discovery");
assert.equal(
  sql(`select count(*) from learn_microsoft_discovery_rounds where tenant_id=${q(t)};`),
  "2",
);
assert.equal(
  sql(
    `select count(*) from platform_jobs where tenant_id=${q(t)} and job_type='email.microsoft_sync';`,
  ),
  "2",
);
assert.equal(
  sql(
    `select md5(string_agg(to_jsonb(p)::text,'' order by id)) from learn_microsoft_source_pages p where tenant_id=${q(t)} and revision<=2;`,
  ),
  retained,
);
assert.deepEqual(await runMicrosoftCaptureJob(db, last, ports([])), end);
for (const role of ["anon", "authenticated", "service_role"])
  for (const action of ["select * from", "delete from", "truncate"])
    assert.throws(() => sql(`set role ${role};${action} learn_microsoft_discovery_rounds;`));
for (const action of [
  "update learn_microsoft_discovery_rounds set reset_revision=reset_revision",
  "delete from learn_microsoft_discovery_rounds",
  "truncate learn_microsoft_discovery_rounds",
])
  assert.throws(() => sql(action));
// An explicitly admitted job can resume an old exhausted stream without inventing source evidence.
const oldJob = getJob(uid(412));
sql(
  `insert into platform_jobs(id,tenant_id,status,claimed_by,attempt_count,lease_expires_at,connector_id,module_id,job_type,payload,job_key) values(${q(uid(890))},${q(oldJob.tenant_id)},'running','recurring-worker',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email',${q(oldJob.job_type)},${json(oldJob.payload)},${q(oldJob.job_key)});`,
);
const legacyCalls = graphCalls;
const legacy = await runMicrosoftCaptureJob(
  db,
  { tenantId: oldJob.tenant_id, jobId: uid(890), claimedBy: "recurring-worker", attemptCount: 1 },
  ports([]),
);
assert.equal(legacy.continuationKind, "discovery");
assert.equal(legacy.sourceReceiptId, null);
assert.equal(legacy.observationsStored, 0);
assert.equal(graphCalls, legacyCalls);
console.log(
  "PASS: recurring discovery finds newly added folders without duplicate old streams; due-time claims, pause/revocation before tokens, monotonic reset revisions, immutable source/rounds, exact lost-reply replay and late rollback verified.",
);
