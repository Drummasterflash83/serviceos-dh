/** Actual Graph reader -> journal -> atomic email/interaction/event projection.
 * Caller supplies the isolated journal test database; all data is synthetic. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runMicrosoftCaptureJob } from "../../supabase/functions/_shared/microsoft_capture_job.ts";
const container = process.argv[2];
if (!/^serviceos-microsoft-journal-[a-f0-9]{8}$/.test(container ?? ""))
  throw Error("Isolated journal container required");
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
  j = (v) => q(JSON.stringify(v)) + "::jsonb";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (file) => readFileSync(new URL("../../" + file, import.meta.url), "utf8");
const checks = [];
// Use actual canonical table definitions; surrounding platform/Auth dependencies
// remain minimal here, and full hosted rollback is a separate check.
sql(
  "alter table email_accounts add column email_address text;create function set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;",
);
const email = read("supabase/migrations/20260702140000_email_input_foundation.sql");
sql(
  email.slice(
    email.indexOf("create table if not exists email_threads ("),
    email.indexOf("-- email_attachments —"),
  ),
);
for (const [file, table] of [
  ["20260708140000_interactions.sql", "interactions"],
  ["20260709150000_platform_events.sql", "platform_events"],
]) {
  const source = read("supabase/migrations/" + file),
    start = source.indexOf(`create table if not exists ${table} (`);
  sql(source.slice(start, source.indexOf(");", start) + 2));
}
sql(
  "create unique index platform_events_pending_subject_uk on platform_events(tenant_id,event_type,subject_id) where status='pending';",
);
const migration = read("supabase/migrations/20261101280000_learn_microsoft_message_projection.sql");
const fn = "learn_microsoft_job_settle(uuid,uuid,text,integer,boolean)";
const prior = sql(`select pg_get_functiondef('${fn}'::regprocedure);`);
sql(migration.replace(/commit;\n$/, "rollback;\n"));
assert.equal(sql(`select pg_get_functiondef('${fn}'::regprocedure);`), prior);
assert.equal(sql("select to_regclass('learn_microsoft_projection_receipts') is null;"), "t");
sql(migration);
checks.push("Projection migration rollback restores original settlement and removes new objects");
const tenant = id(600),
  account = id(601),
  mailbox = id(602),
  binding = id(603),
  directory = id(604);
sql(
  `insert into tenants values(${q(tenant)},'active');insert into email_accounts(id,tenant_id,provider,status,auth_state,email_address) values(${q(account)},${q(tenant)},'microsoft_365','active','ok','office@example.invalid');insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(binding)},${q(tenant)},${q(account)},${q(directory)},${q(mailbox)},true);`,
);
const baseline = sql(
  `select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by p.id),'')) from learn_microsoft_source_pages p where tenant_id<>${q(tenant)};`,
);
const full = (overrides = {}) => ({
  id: "M1",
  changeKey: "V1",
  conversationId: "Conversation1",
  subject: "Synthetic job enquiry",
  body: { contentType: "text", content: "Synthetic retained content" },
  bodyPreview: "Synthetic preview",
  from: { emailAddress: { address: "customer@example.invalid", name: "Synthetic customer" } },
  toRecipients: [{ emailAddress: { address: "office@example.invalid" } }],
  ccRecipients: [],
  sentDateTime: "2026-10-11T10:00:00Z",
  receivedDateTime: "2026-10-11T10:00:01Z",
  lastModifiedDateTime: "2026-10-11T10:01:00.1234561Z",
  isDraft: false,
  hasAttachments: true,
  ...overrides,
});
let counter = 610,
  requests = 0,
  lose = false;
const db = {
  rpc: async (name, args) => {
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
          `${k}=>${typeof v === "object" && v !== null ? j(v) : v === null ? "null" : typeof v === "boolean" ? String(v) : q(v)}`,
      )
      .join(",");
    const data = JSON.parse(
      sql(`set role service_role;select ${name}(${named});`).split("\n").at(-1),
    );
    if (lose && name === "learn_microsoft_job_settle" && args.p_apply) {
      lose = false;
      return { data: null, error: {} };
    }
    return { data, error: null };
  },
};
function prepare(values, scope = { tenant, account, mailbox, binding }) {
  const n = counter++,
    folder = "Folder" + n,
    job = id(n),
    type = "email.microsoft_sync";
  const payload = {
    email_account_id: scope.account,
    mailbox_id: scope.mailbox,
    binding_id: scope.binding,
    kind: "messages",
    folder_id: folder,
  };
  sql(
    `insert into platform_jobs(id,tenant_id,status,claimed_by,attempt_count,lease_expires_at,connector_id,module_id,job_type,job_key,payload) values(${q(job)},${q(scope.tenant)},'running','projection-worker',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email',${q(type)},${q(type + ":" + scope.binding + ":" + folder)},${j(payload)});`,
  );
  const claim = {
    tenantId: scope.tenant,
    jobId: job,
    claimedBy: "projection-worker",
    attemptCount: 1,
  };
  const ports = {
    accessToken: async () => "synthetic",
    fetcher: async () => {
      requests++;
      return Response.json({
        value: values,
        "@odata.deltaLink": `https://graph.microsoft.com/v1.0/users/${scope.mailbox}/mailFolders/${folder}/messages/delta?$deltatoken=synthetic`,
      });
    },
  };
  return { claim, ports };
}
const run = async (values, scope) => {
  const c = prepare(values, scope);
  await runMicrosoftCaptureJob(db, c.claim, c.ports);
  return JSON.parse(
    sql(
      `select r.result from learn_microsoft_projection_receipts r join learn_microsoft_source_pages p on p.id=r.page_id where p.job_id=${q(c.claim.jobId)};`,
    ),
  );
};
const canonical = () =>
  JSON.parse(
    sql(
      `select to_jsonb(m) from email_messages m where tenant_id=${q(tenant)} and provider_message_id=${q(directory + ":" + mailbox + ":M1")};`,
    ),
  );
const first = prepare([full()]);
lose = true;
await assert.rejects(
  runMicrosoftCaptureJob(db, first.claim, first.ports),
  (e) => e.code === "settlement_unconfirmed",
);
const count = requests;
await runMicrosoftCaptureJob(db, first.claim, first.ports);
assert.equal(requests, count);
const original = canonical();
assert.equal(original.direction, "inbound");
assert.equal(original.body_text, "Synthetic retained content");
assert.equal(original.raw_payload.microsoft_source.attachments_captured, false);
assert.equal(
  sql(
    `select count(*) from interactions where tenant_id=${q(tenant)} and source_id=${q(original.id)} and source_connector_id='microsoft-365';`,
  ),
  "1",
);
assert.equal(
  sql(
    `select count(*) from platform_events where tenant_id=${q(tenant)} and event_type='interaction.ready';`,
  ),
  "1",
);
checks.push(
  "Actual capture job atomically creates email, thread, Microsoft interaction, downstream event and receipt; lost reply replays without provider traffic",
);
let r = await run([full()]);
assert.equal(r.unchanged, 1);
assert.deepEqual(canonical(), original);
r = await run([
  { id: "M1", subject: "Sparse must not erase" },
  { id: "M1", "@removed": { reason: "deleted" } },
  full({ id: "Draft1", isDraft: true }),
]);
assert.equal(r.held, 1);
assert.equal(r.removedFromFolder, 1);
assert.equal(r.drafts, 1);
assert.deepEqual(canonical(), original);
checks.push(
  "Duplicates are unchanged; sparse, draft and folder-removal observations remain retained without deleting or overwriting canonical content",
);
r = await run([
  full({
    changeKey: "V2",
    lastModifiedDateTime: "2026-10-11T10:01:00.1234562Z",
    subject: "Newer exact fraction",
  }),
]);
assert.equal(r.published, 1);
assert.equal(canonical().id, original.id);
assert.equal(canonical().subject, "Newer exact fraction");
assert.equal(
  sql(`select subject from email_threads where tenant_id=${q(tenant)};`),
  "Newer exact fraction",
);
r = await run([full({ subject: "Late older folder result" })]);
assert.equal(r.older, 1);
assert.equal(canonical().subject, "Newer exact fraction");
r = await run([
  full({
    changeKey: "Conflict",
    lastModifiedDateTime: "2026-10-11T10:01:00.1234562Z",
    subject: "Ambiguous same time",
  }),
]);
assert.equal(r.held, 1);
assert.equal(canonical().subject, "Newer exact fraction");
checks.push(
  "Mailbox-wide ordering across folders preserves stable IDs, seventh fractional digit and newer contents; same-time conflicting versions are held",
);
const a2 = id(690),
  m2 = id(691),
  b2 = id(692);
sql(
  `insert into email_accounts(id,tenant_id,provider,status,auth_state,email_address) values(${q(a2)},${q(tenant)},'microsoft_365','active','ok','second@example.invalid');insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(b2)},${q(tenant)},${q(a2)},${q(directory)},${q(m2)},true);`,
);
await run([full()], { tenant, account: a2, mailbox: m2, binding: b2 });
assert.equal(sql(`select count(*) from email_messages where tenant_id=${q(tenant)};`), "2");
assert.equal(sql(`select count(*) from email_threads where tenant_id=${q(tenant)};`), "2");
assert.equal(sql(`select count(*) from interactions where tenant_id=${q(tenant)};`), "2");
checks.push(
  "Identical provider IDs in two mailboxes produce independent canonical messages, threads and interactions",
);
// Failure after canonical writes must roll back publication and queue settlement.
sql(
  "create function synthetic_event_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic_event_failure';end$$;create trigger synthetic_fail before insert on platform_events for each row execute function synthetic_event_failure();",
);
const fail = prepare([full({ id: "Atomic1" })]);
await assert.rejects(runMicrosoftCaptureJob(db, fail.claim, fail.ports));
assert.equal(
  sql(
    `select count(*) from email_messages where tenant_id=${q(tenant)} and provider_message_id like '%:Atomic1';`,
  ),
  "0",
);
assert.equal(sql(`select status from platform_jobs where id=${q(fail.claim.jobId)};`), "running");
assert.equal(
  sql(
    `select count(*) from learn_microsoft_projection_receipts r join learn_microsoft_source_pages p on p.id=r.page_id where p.job_id=${q(fail.claim.jobId)};`,
  ),
  "0",
);
sql("drop trigger synthetic_fail on platform_events;drop function synthetic_event_failure();");
const beforeRetry = requests;
await runMicrosoftCaptureJob(db, fail.claim, fail.ports);
assert.equal(requests, beforeRetry);
assert.equal(
  sql(
    `select count(*) from email_messages where tenant_id=${q(tenant)} and provider_message_id like '%:Atomic1';`,
  ),
  "1",
);
checks.push(
  "Downstream event failure rolls back canonical rows, receipt and settlement; retry publishes the retained page without another provider fetch",
);
const page = sql(
  `select id from learn_microsoft_source_pages where job_id=${q(first.claim.jobId)};`,
);
for (const role of ["anon", "authenticated"])
  assert.throws(() =>
    sql(`set role ${role};select learn_microsoft_page_project(${q(tenant)},${q(page)});`),
  );
assert.throws(() =>
  sql(`set role service_role;select learn_microsoft_page_project(${q(id(999))},${q(page)});`),
);
for (const role of ["anon", "authenticated", "service_role"])
  assert.throws(() => sql(`set role ${role};select * from learn_microsoft_projection_receipts;`));
assert.throws(() => sql("delete from learn_microsoft_projection_receipts;"));
assert.equal(
  sql(
    `select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by p.id),'')) from learn_microsoft_source_pages p where tenant_id<>${q(tenant)};`,
  ),
  baseline,
);
checks.push(
  "Foreign tenants and human RPC roles denied; receipts immutable and private; all prior tenants source pages preserved",
);
console.log(
  JSON.stringify(
    {
      state: "passed",
      checks,
      syntheticProviderRequests: requests,
      realProviderRequests: 0,
      limitations: [
        "Minimal isolated platform dependencies, not full hosted acceptance.",
        "Sparse/conflicting messages remain held; hydration, operator coverage and live credential/worker integration still required.",
        "Events are durably queued; customer-card enrichment is not proven by event insertion.",
      ],
    },
    null,
    2,
  ),
);
