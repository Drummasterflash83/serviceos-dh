// Actual engine, readers and PostgreSQL journal. All Graph/token responses synthetic.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  runMicrosoftCapturePage,
  MicrosoftJournalError,
} from "../../supabase/functions/_shared/microsoft_capture_engine.ts";
const container = process.argv[2];
if (!/^serviceos-microsoft-journal-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Expected disposable journal test container");
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'";
const json = (v) => q(JSON.stringify(v)) + "::jsonb";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function sql(text) {
  return execFileSync(
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
}
const tenant = uid(1),
  account = uid(90),
  mailbox = uid(91),
  binding = uid(92);
sql(
  `insert into email_accounts values(${q(account)},${q(tenant)},'microsoft_365','active','ok');insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(binding)},${q(tenant)},${q(account)},${q(uid(5))},${q(mailbox)},true);`,
);
function job(n, kind = "folders", folder = "") {
  const payload = {
    email_account_id: account,
    mailbox_id: mailbox,
    binding_id: binding,
    kind,
    folder_id: folder,
  };
  sql(
    `insert into platform_jobs values(${q(uid(n))},${q(tenant)},'running','engine',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email',${q(kind === "folders" ? "email.microsoft_discovery" : "email.microsoft_sync")},${json(payload)});`,
  );
  return { tenantId: tenant, jobId: uid(n), claimedBy: "engine", attemptCount: 1 };
}
let loseCommit = false,
  calls = [],
  rpcCalls = [];
const db = {
  async rpc(name, args) {
    assert.ok(
      [
        "learn_microsoft_journal_job",
        "learn_microsoft_journal_open",
        "learn_microsoft_journal_commit",
      ].includes(name),
    );
    rpcCalls.push(name);
    const named = Object.entries(args)
      .map(
        ([key, value]) =>
          `${key} => ${value === null ? "null" : typeof value === "object" ? json(value) : typeof value === "number" ? String(value) : q(value)}`,
      )
      .join(",");
    try {
      const data = JSON.parse(
        sql(`set role service_role;select public.${name}(${named});`).split("\n").at(-1),
      );
      if (name === "learn_microsoft_journal_commit" && loseCommit) {
        loseCommit = false;
        throw Error("Synthetic lost reply PRIVATE");
      }
      return { data, error: null };
    } catch {
      return { data: null, error: { message: "PRIVATE database response" } };
    }
  },
};
let tokens = 0;
const provider = (responses) => async (url, init) => {
  calls.push(String(url));
  assert.equal(init.method, "GET");
  assert.ok(responses.length);
  return Response.json(responses.shift());
};
const ports = (responses) => ({
  accessToken: async (context, claim) => {
    tokens++;
    assert.equal(context.mailboxId, mailbox);
    assert.equal(claim.tenantId, tenant);
    return "synthetic";
  },
  fetcher: provider(responses),
});
const folder = {
  id: "Folder1",
  parentFolderId: "Root",
  displayName: "Synthetic engine folder",
  childFolderCount: 0,
  totalItemCount: 3,
  unreadItemCount: 0,
  isHidden: false,
};
const claim = job(100);
loseCommit = true;
await assert.rejects(
  runMicrosoftCapturePage(db, claim, ports([{ value: [folder] }])),
  (e) =>
    e instanceof MicrosoftJournalError &&
    e.code === "commit_unconfirmed" &&
    !e.message.includes("PRIVATE"),
);
assert.equal(calls.length, 1);
// A replacement claim recovers after pause/revocation with no token or provider call.
sql(
  `update platform_jobs set attempt_count=2,claimed_by='replacement' where id=${q(claim.jobId)};update learn_microsoft_mailbox_bindings set enabled=false where id=${q(binding)};`,
);
const recovered = await runMicrosoftCapturePage(
  db,
  { ...claim, claimedBy: "replacement", attemptCount: 2 },
  ports([]),
);
assert.equal(recovered.state, "source_page_stored");
assert.equal(recovered.recovered, true);
assert.equal(recovered.needsContinuation, true);
assert.equal(tokens, 1);
assert.equal(calls.length, 1);
const blocked = job(101);
await assert.rejects(
  runMicrosoftCapturePage(db, blocked, ports([])),
  (e) => e.code === "stream_unconfirmed",
);
assert.equal(tokens, 1);
sql(`update learn_microsoft_mailbox_bindings set enabled=true where id=${q(binding)};`);
const done = await runMicrosoftCapturePage(db, blocked, ports([{ value: [] }]));
assert.equal(done.needsContinuation, false);
assert.equal(done.observationsStored, 0);
const exhausted = await runMicrosoftCapturePage(db, job(102), ports([]));
assert.equal(exhausted.state, "discovery_exhausted");
assert.equal(tokens, 2);
const base = `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/Folder1/messages/delta`;
const next = (n) => `${base}?$skiptoken=${n}`,
  delta = `${base}?$deltatoken=synthetic`;
const first = await runMicrosoftCapturePage(
  db,
  job(103, "messages", "Folder1"),
  ports([
    {
      value: [
        { id: "M1", body: { contentType: "text", content: "Retained original" } },
        { id: "M1", isRead: true },
      ],
      "@odata.nextLink": next("N1"),
    },
  ]),
);
assert.equal(first.needsContinuation, true);
assert.equal(first.observationsStored, 2);
const second = await runMicrosoftCapturePage(
  db,
  job(104, "messages", "Folder1"),
  ports([{ value: [{ id: "M1", "@removed": { reason: "deleted" } }], "@odata.deltaLink": delta }]),
);
assert.equal(second.needsContinuation, false);
assert.equal(calls.at(-1), next("N1"));
const checkpoint = JSON.parse(
  sql(
    `select checkpoint from learn_microsoft_capture_streams where email_account_id=${q(account)} and kind='messages';`,
  ),
);
assert.deepEqual(checkpoint.visitedRequests, []);
assert.equal(checkpoint.continuation.url, delta);
// A new round permits the prior terminal delta URL, but cannot loop to an earlier next URL.
await runMicrosoftCapturePage(
  db,
  job(105, "messages", "Folder1"),
  ports([{ value: [], "@odata.nextLink": next("N2") }]),
);
await runMicrosoftCapturePage(
  db,
  job(106, "messages", "Folder1"),
  ports([{ value: [], "@odata.nextLink": next("N3") }]),
);
const before = sql(
  `select checkpoint from learn_microsoft_capture_streams where email_account_id=${q(account)} and kind='messages';`,
);
await assert.rejects(
  runMicrosoftCapturePage(
    db,
    job(107, "messages", "Folder1"),
    ports([{ value: [], "@odata.nextLink": next("N2") }]),
  ),
  (e) => e.code === "pagination_no_progress",
);
assert.equal(
  sql(
    `select checkpoint from learn_microsoft_capture_streams where email_account_id=${q(account)} and kind='messages';`,
  ),
  before,
);
assert.equal(
  sql(`select count(*) from learn_microsoft_source_pages where job_id=${q(uid(107))};`),
  "0",
);
const stored = JSON.parse(
  sql(`select source_page from learn_microsoft_source_pages where job_id=${q(uid(103))};`),
);
assert.equal(stored.events[0].raw.body.content, "Retained original");
assert.equal(stored.events.length, 2);
for (const result of [recovered, done, first, second]) {
  assert.equal(result.mailboxCoverage, "unverified");
  assert.doesNotMatch(
    JSON.stringify(result),
    /Retained original|skiptoken|deltatoken|synthetic engine/,
  );
}
console.log(
  "PASS: actual Microsoft engine + PostgreSQL journal: lost-reply/replacement recovery without provider access, revoked-binding denial, folder resumption/exhaustion, message rounds, retained raw evidence and persisted cursor-cycle rejection",
);
