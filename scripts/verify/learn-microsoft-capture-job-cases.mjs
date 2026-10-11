import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { runMicrosoftCapturePage } from "../../supabase/functions/_shared/microsoft_capture_engine.ts";
import { runMicrosoftCaptureJob } from "../../supabase/functions/_shared/microsoft_capture_job.ts";
const container = process.argv[2];
if (!/^serviceos-microsoft-journal-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Expected isolated journal container");
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  json = (v) => q(JSON.stringify(v)) + "::jsonb",
  uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
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
// Dependency columns mirror the queue fields used by this migration; full-schema acceptance remains separate.
sql(`alter table platform_jobs alter column id set default gen_random_uuid();alter table platform_jobs alter column attempt_count set default 0;alter table platform_jobs add column job_key text,add column priority integer not null default 100,add column max_attempts integer not null default 5,add column parent_job_id uuid,add column available_at timestamptz,add column completed_at timestamptz,add column records_processed integer not null default 0,add column updated_at timestamptz default clock_timestamp(),add column result jsonb not null default '{}',add column error_code text;
create unique index platform_jobs_active_job_key_uk on platform_jobs(tenant_id,job_key) where job_key is not null and status in ('queued','running','retrying');`);
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261101182000_learn_microsoft_queue_completion.sql",
    import.meta.url,
  ),
  "utf8",
);
sql(migration.replace(/commit;\n$/, "rollback;\n"));
assert.equal(
  sql(
    "select to_regclass('learn_microsoft_job_completions') is null and to_regprocedure('learn_microsoft_job_settle(uuid,uuid,text,integer,boolean)') is null;",
  ),
  "t",
);
sql(migration);
const tenant = uid(1),
  account = uid(200),
  mailbox = uid(201),
  binding = uid(202);
sql(
  `insert into email_accounts values(${q(account)},${q(tenant)},'microsoft_365','active','ok');insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(binding)},${q(tenant)},${q(account)},${q(uid(5))},${q(mailbox)},true);`,
);
function create(n, kind = "folders", folder = "") {
  const jobType = kind === "folders" ? "email.microsoft_discovery" : "email.microsoft_sync";
  const payload = {
    email_account_id: account,
    mailbox_id: mailbox,
    binding_id: binding,
    kind,
    folder_id: folder,
  };
  sql(
    `insert into platform_jobs(id,tenant_id,status,claimed_by,attempt_count,lease_expires_at,connector_id,module_id,job_type,payload,job_key) values(${q(uid(n))},${q(tenant)},'running','worker',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email',${q(jobType)},${json(payload)},${q(`${jobType}:${binding}:${folder}`)});`,
  );
  return { tenantId: tenant, jobId: uid(n), claimedBy: "worker", attemptCount: 1 };
}
function claim(id) {
  sql(
    `update platform_jobs set status='running',claimed_by='worker',attempt_count=attempt_count+1,lease_expires_at=clock_timestamp()+interval '10 minutes' where id=${q(id)};`,
  );
  return { tenantId: tenant, jobId: id, claimedBy: "worker", attemptCount: 1 };
}
let lose = false,
  tokens = 0,
  fetches = 0;
const db = {
  async rpc(name, args) {
    assert.ok(
      [
        "learn_microsoft_job_settle",
        "learn_microsoft_journal_job",
        "learn_microsoft_journal_open",
        "learn_microsoft_journal_commit",
      ].includes(name),
    );
    const named = Object.entries(args)
      .map(
        ([k, v]) =>
          `${k} => ${v === null ? "null" : typeof v === "object" ? json(v) : typeof v === "boolean" || typeof v === "number" ? String(v) : q(v)}`,
      )
      .join(",");
    try {
      const data = JSON.parse(
        sql(`set role service_role;select ${name}(${named});`).split("\n").at(-1),
      );
      if (lose && name === "learn_microsoft_job_settle" && args.p_apply) {
        lose = false;
        return { data: null, error: { message: "PRIVATE lost reply" } };
      }
      return { data, error: null };
    } catch {
      return { data: null, error: { message: "PRIVATE SQL" } };
    }
  },
};
const ports = (pages) => ({
  accessToken: async () => {
    tokens++;
    return "synthetic";
  },
  fetcher: async () => {
    fetches++;
    assert.ok(pages.length, "Unexpected provider call");
    return Response.json(pages.shift());
  },
});
const first = create(210),
  folder = {
    id: "Folder",
    parentFolderId: "Root",
    displayName: "Synthetic",
    childFolderCount: 0,
    totalItemCount: 1,
    unreadItemCount: 0,
    isHidden: false,
  };
lose = true;
await assert.rejects(
  runMicrosoftCaptureJob(db, first, ports([{ value: [folder] }])),
  (e) => e.code === "settlement_unconfirmed",
);
assert.equal(sql(`select status from platform_jobs where id=${q(first.jobId)};`), "succeeded");
assert.equal(sql(`select count(*) from platform_jobs where parent_job_id=${q(first.jobId)};`), "1");
const recovered = await runMicrosoftCaptureJob(db, first, ports([]));
assert.equal(recovered.state, "completed");
assert.ok(recovered.successorId);
assert.equal(tokens, 1);
assert.equal(fetches, 1);
const repeated = await runMicrosoftCaptureJob(db, first, ports([]));
assert.deepEqual(repeated, recovered);
assert.equal(sql(`select count(*) from platform_jobs where parent_job_id=${q(first.jobId)};`), "1");
const next = claim(recovered.successorId);
const last = await runMicrosoftCaptureJob(db, next, ports([{ value: [] }]));
assert.equal(last.successorId, null);
assert.equal(last.observationsStored, 0);
const exhausted = await runMicrosoftCaptureJob(db, create(211), ports([]));
assert.equal(exhausted.sourceReceiptId, null);
assert.equal(tokens, 2);
// Missing source evidence cannot settle a message job.
const missing = create(212, "messages", "NeverFetched");
const args = (c) => ({
  p_tenant: c.tenantId,
  p_job: c.jobId,
  p_worker: c.claimedBy,
  p_claim: c.attemptCount,
  p_apply: true,
});
assert.ok((await db.rpc("learn_microsoft_job_settle", args(missing))).error);
assert.equal(sql(`select status from platform_jobs where id=${q(missing.jobId)};`), "running");
// Save a real page first, then make successor insertion fail. Completion must roll back.
const mail = create(213, "messages", "Folder");
const base = `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/Folder/messages/delta`;
await runMicrosoftCapturePage(
  db,
  mail,
  ports([
    {
      value: [{ id: "M1", subject: "Original synthetic evidence" }],
      "@odata.nextLink": `${base}?$skiptoken=N1`,
    },
  ]),
);
sql(
  "create function synthetic_successor_failure() returns trigger language plpgsql as $$begin if new.parent_job_id is not null then raise exception 'synthetic_successor_failure';end if;return new;end $$;create trigger synthetic_fail before insert on platform_jobs for each row execute function synthetic_successor_failure();",
);
await assert.rejects(
  runMicrosoftCaptureJob(db, mail, ports([])),
  (e) => e.code === "settlement_unconfirmed",
);
assert.equal(sql(`select status from platform_jobs where id=${q(mail.jobId)};`), "running");
assert.equal(
  sql(`select count(*) from learn_microsoft_source_pages where job_id=${q(mail.jobId)};`),
  "1",
);
assert.equal(
  sql(`select count(*) from learn_microsoft_job_completions where job_id=${q(mail.jobId)};`),
  "0",
);
sql("drop trigger synthetic_fail on platform_jobs;drop function synthetic_successor_failure();");
// Lease expiry during successor insertion rolls back its queue row and completion.
sql(
  `update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=${q(mail.jobId)};create function synthetic_slow_successor() returns trigger language plpgsql as $$begin if new.parent_job_id is not null then perform pg_sleep(1.2);end if;return new;end $$;create trigger synthetic_slow before insert on platform_jobs for each row execute function synthetic_slow_successor();`,
);
assert.ok((await db.rpc("learn_microsoft_job_settle", args(mail))).error);
assert.equal(sql(`select status from platform_jobs where id=${q(mail.jobId)};`), "running");
assert.equal(sql(`select count(*) from platform_jobs where parent_job_id=${q(mail.jobId)};`), "0");
sql(
  `drop trigger synthetic_slow on platform_jobs;drop function synthetic_slow_successor();update platform_jobs set lease_expires_at=clock_timestamp()+interval '10 minutes' where id=${q(mail.jobId)};update learn_microsoft_mailbox_bindings set enabled=false where id=${q(binding)};`,
);
// Pausing/revoking stops provider work, not recovery of already retained evidence.
const settled = await runMicrosoftCaptureJob(db, mail, ports([]));
assert.ok(settled.successorId);
const pending = claim(settled.successorId);
const beforeTokens = tokens;
await assert.rejects(
  runMicrosoftCaptureJob(db, pending, ports([])),
  (e) => e.code === "stream_unconfirmed",
);
assert.equal(tokens, beforeTokens);
sql(`update learn_microsoft_mailbox_bindings set enabled=true where id=${q(binding)};`);
const terminal = await runMicrosoftCaptureJob(
  db,
  pending,
  ports([{ value: [], "@odata.deltaLink": `${base}?$deltatoken=D1` }]),
);
assert.equal(terminal.successorId, null);
assert.equal(terminal.mailboxCoverage, "unverified");
// Hold completion open while a second real session waits on the same job lock.
const race = create(214, "messages", "Race");
const raceBase = `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/Race/messages/delta`;
await runMicrosoftCapturePage(
  db,
  race,
  ports([{ value: [], "@odata.nextLink": `${raceBase}?$skiptoken=R1` }]),
);
function asyncSql(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/local/bin/docker", [
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
    ]);
    let out = "",
      err = "";
    child.stdout.on("data", (v) => (out += v));
    child.stderr.on("data", (v) => (err += v));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(Error(err))));
    child.stdin.end(statement);
  });
}
const finish = `select learn_microsoft_job_settle(${q(tenant)},${q(race.jobId)},'worker',1,true);`;
const firstRace = asyncSql(
  "begin;set application_name='microsoft-settlement-first';set role service_role;" +
    finish +
    "select pg_sleep(2);commit;",
);
let firstReady = false;
for (let i = 0; i < 100; i++) {
  if (
    sql(
      "select count(*) from pg_stat_activity where application_name='microsoft-settlement-first' and wait_event='PgSleep';",
    ) === "1"
  ) {
    firstReady = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 10));
}
assert.ok(firstReady);
const secondRace = asyncSql(
  "set application_name='microsoft-settlement-second';set role service_role;" + finish,
);
let secondWaiting = false;
for (let i = 0; i < 100; i++) {
  if (
    sql(
      "select count(*) from pg_stat_activity where application_name='microsoft-settlement-second' and wait_event_type='Lock';",
    ) === "1"
  ) {
    secondWaiting = true;
    break;
  }
  await new Promise((r) => setTimeout(r, 10));
}
assert.ok(secondWaiting);
const raceReplies = await Promise.all([firstRace, secondRace]);
const decoded = raceReplies.map((v) =>
  JSON.parse(v.split("\n").find((line) => line.startsWith("{"))),
);
assert.deepEqual(decoded[0], decoded[1]);
assert.equal(sql(`select count(*) from platform_jobs where parent_job_id=${q(race.jobId)};`), "1");
assert.equal(
  sql(`select count(*) from learn_microsoft_job_completions where job_id=${q(race.jobId)};`),
  "1",
);
for (const role of ["anon", "authenticated", "service_role"]) {
  assert.throws(() => sql(`set role ${role};select * from learn_microsoft_job_completions;`));
  assert.throws(() => sql(`set role ${role};truncate learn_microsoft_job_completions;`));
}
for (const role of ["anon", "authenticated"])
  assert.throws(() =>
    sql(
      `set role ${role};select learn_microsoft_job_settle(${q(tenant)},${q(first.jobId)},'worker',1,true);`,
    ),
  );
assert.ok(
  (await db.rpc("learn_microsoft_job_settle", { ...args(missing), p_tenant: uid(99) })).error,
);
assert.ok(
  (await db.rpc("learn_microsoft_job_settle", { ...args(missing), p_worker: "stale" })).error,
);
assert.throws(() => sql("delete from learn_microsoft_job_completions;"));
sql(
  `update platform_jobs set payload=payload||'{"folder_id":"changed"}'::jsonb where id=${q(first.jobId)};`,
);
assert.ok((await db.rpc("learn_microsoft_job_settle", args(first))).error);
console.log(
  "PASS: actual Microsoft queue wrapper + database: atomic successor creation with observed two-session lock contention, lost completion recovery, repeated replay, successor failure/lease rollback, exhausted discovery, no-page denial, paused recovery, cross-company/role denial and immutable completion receipts",
);
