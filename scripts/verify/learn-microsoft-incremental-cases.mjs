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
const fn = "learn_microsoft_job_settle(uuid,uuid,text,integer,boolean)";
const prior = sql(`select pg_get_functiondef('${fn}'::regprocedure);`);
const authority = sql(
  `select proowner::text||coalesce(proacl::text,'') from pg_proc where oid='${fn}'::regprocedure;`,
);
const preserved = () =>
  sql(
    "select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.id),'')) from learn_microsoft_source_pages x where x.tenant_id<>'00000000-0000-4000-8000-000000000400';select md5(coalesce(string_agg(to_jsonb(x)::text,'' order by x.job_id),'')) from learn_microsoft_job_completions x where x.tenant_id<>'00000000-0000-4000-8000-000000000400';",
  );
const baseline = preserved();
const migration = read("supabase/migrations/20261101260000_learn_microsoft_incremental_queue.sql");
sql(migration.replace(/commit;\n$/, "rollback;\n"));
assert.equal(sql(`select pg_get_functiondef('${fn}'::regprocedure);`), prior);
sql(migration);
assert.equal(
  sql(
    `select proowner::text||coalesce(proacl::text,'') from pg_proc where oid='${fn}'::regprocedure;`,
  ),
  authority,
);
assert.equal(preserved(), baseline);
// Use the application's actual due-time queue claim, with missing dependency columns
// added to the existing minimal fixture (not a full-schema acceptance claim).
sql(
  "alter table platform_jobs add column claimed_at timestamptz,add column last_attempt_at timestamptz,add column started_at timestamptz,add column created_at timestamptz default now();",
);
const queue = read("supabase/migrations/20260710120000_platform_job_queue.sql");
sql(
  queue.slice(
    queue.indexOf("create or replace function platform_jobs_claim("),
    queue.indexOf("-- ── Register"),
  ),
);
const t = uid(400),
  a = uid(401),
  m = uid(402),
  b = uid(403);
sql(
  `insert into tenants values(${q(t)},'active');insert into email_accounts values(${q(a)},${q(t)},'microsoft_365','active','ok');insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(b)},${q(t)},${q(a)},${q(uid(404))},${q(m)},true);`,
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
const first = create(410, "Inbox");
const firstDelta = base("Inbox") + "?$deltatoken=INITIAL%2BOPAQUE";
const before = Date.now();
lose = true;
await assert.rejects(
  runMicrosoftCaptureJob(
    db,
    first,
    ports([
      { value: [{ id: "M1", subject: "Synthetic source 1" }], "@odata.deltaLink": firstDelta },
    ]),
  ),
  (e) => e.code === "settlement_unconfirmed",
);
const noRepeat = graphCalls;
const retained = await runMicrosoftCaptureJob(db, first, ports([]));
assert.equal(graphCalls, noRepeat);
assert.equal(retained.continuationKind, "incremental");
assert.ok(retained.successorId);
assert.ok(Date.parse(retained.nextCheckAt) >= before + 299000);
const queued = getJob(retained.successorId);
assert.equal(queued.status, "queued");
assert.equal(Date.parse(queued.available_at), Date.parse(retained.nextCheckAt));
assert.equal(queued.parent_job_id, first.jobId);
assert.equal(sql(`select count(*) from platform_jobs where parent_job_id=${q(first.jobId)};`), "1");
// A real queue claim cannot take the future job; exclude this test from unrelated
// pre-existing synthetic jobs by filtering returned identities.
const claimSql =
  "select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from platform_jobs_claim('recurring-worker',50,300,array['email.microsoft_sync']) j;";
const early = JSON.parse(sql(claimSql));
assert.ok(!early.some((j) => j.id === retained.successorId));
assert.equal(getJob(retained.successorId).status, "queued");
// Simulate the passage of due time only in this isolated fixture.
sql(
  `update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=${q(retained.successorId)};`,
);
const due = JSON.parse(sql(claimSql)).find((j) => j.id === retained.successorId);
assert.ok(due);
const next = {
  tenantId: t,
  jobId: due.id,
  claimedBy: due.claimed_by,
  attemptCount: due.attempt_count,
};
// All capture controls stop the next round before token/provider access.
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
  const beforeTokens = tokenCalls;
  await assert.rejects(
    runMicrosoftCaptureJob(db, next, ports([])),
    (e) => e.code === "stream_unconfirmed",
  );
  assert.equal(tokenCalls, beforeTokens);
  sql(resume);
}
const urls = [];
const page = await runMicrosoftCaptureJob(
  db,
  next,
  ports(
    [
      {
        value: [{ id: "M2", subject: "Synthetic new arrival" }],
        "@odata.nextLink": base("Inbox") + "?$skiptoken=SECOND",
      },
    ],
    urls,
  ),
);
assert.equal(urls[0], firstDelta);
assert.equal(page.continuationKind, "page");
assert.ok(Date.parse(page.nextCheckAt) < Date.now() + 5000);
const midJob = getJob(page.successorId);
sql(
  `update platform_jobs set available_at=clock_timestamp()-interval '1 second' where id=${q(midJob.id)};`,
);
const midDue = JSON.parse(sql(claimSql)).find((j) => j.id === midJob.id);
assert.ok(midDue);
const mid = {
  tenantId: t,
  jobId: midDue.id,
  claimedBy: midDue.claimed_by,
  attemptCount: midDue.attempt_count,
};
const nextDelta = base("Inbox") + "?$deltatoken=SECOND";
const end = await runMicrosoftCaptureJob(
  db,
  mid,
  ports(
    [{ value: [{ id: "M1", "@removed": { reason: "deleted" } }], "@odata.deltaLink": nextDelta }],
    urls,
  ),
);
assert.equal(urls[1], base("Inbox") + "?$skiptoken=SECOND");
assert.equal(end.continuationKind, "incremental");
assert.equal(
  sql(`select count(*) from learn_microsoft_source_pages where tenant_id=${q(t)};`),
  "3",
);
assert.equal(
  sql(
    `select count(*) from learn_microsoft_source_pages where tenant_id=${q(t)} and source_page->'events'->0->'fields'->>'subject'='Synthetic source 1';`,
  ),
  "1",
);
assert.equal(
  sql(
    `select checkpoint->'continuation'->>'url' from learn_microsoft_capture_streams where tenant_id=${q(t)} and folder_id='Inbox';`,
  ),
  nextDelta,
);
// Retained receipts remain exact even after later rounds advance the stream.
assert.deepEqual(await runMicrosoftCaptureJob(db, first, ports([])), retained);
// Failure creating a scheduled successor must roll back completion, never source.
const failed = create(411, "Failure");
await runMicrosoftCapturePage(
  db,
  failed,
  ports([{ value: [], "@odata.deltaLink": base("Failure") + "?$deltatoken=F" }]),
);
sql(
  `create function recurring_failure() returns trigger language plpgsql as $$begin if new.parent_job_id=${q(failed.jobId)}::uuid then raise exception 'synthetic_failure';end if;return new;end $$;create trigger recurring_failure before insert on platform_jobs for each row execute function recurring_failure();`,
);
await assert.rejects(
  runMicrosoftCaptureJob(db, failed, ports([])),
  (e) => e.code === "settlement_unconfirmed",
);
assert.equal(getJob(failed.jobId).status, "running");
assert.equal(
  sql(`select count(*) from learn_microsoft_source_pages where job_id=${q(failed.jobId)};`),
  "1",
);
assert.equal(
  sql(`select count(*) from learn_microsoft_job_completions where job_id=${q(failed.jobId)};`),
  "0",
);
sql("drop trigger recurring_failure on platform_jobs;drop function recurring_failure();");
const recover = await runMicrosoftCaptureJob(db, failed, ports([]));
assert.equal(recover.continuationKind, "incremental");
// Discovery exhaustion does not manufacture a repeat scan or a false schedule.
const discovery = create(412, "", "folders");
const exhausted = await runMicrosoftCaptureJob(db, discovery, ports([{ value: [] }]));
assert.equal(exhausted.successorId, null);
assert.equal(exhausted.continuationKind, null);
assert.equal(exhausted.nextCheckAt, null);
for (const role of ["anon", "authenticated"])
  assert.throws(() =>
    sql(
      `set role ${role};select learn_microsoft_job_settle(${q(t)},${q(first.jobId)},'recurring-worker',1,true);`,
    ),
  );
assert.ok(
  (
    await db.rpc("learn_microsoft_job_settle", {
      p_tenant: uid(999),
      p_job: first.jobId,
      p_worker: "recurring-worker",
      p_claim: 1,
      p_apply: true,
    })
  ).error,
);
assert.equal(preserved(), baseline);
console.log(
  "PASS: recurring Microsoft message rounds use retained opaque delta links; due-time queue gating, pause/revocation before credentials, multi-page next rounds, retained removals, lost-reply exact recovery, atomic enqueue rollback, old evidence preservation, authority and migration rollback verified.",
);
