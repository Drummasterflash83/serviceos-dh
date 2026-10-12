// Actual credential RPCs, token port, Graph reader and atomic settlement. No real
// credentials/provider requests; runs only inside the isolated journal harness.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
  j = (v) => q(JSON.stringify(v)) + "::jsonb";
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20261101470000_learn_microsoft_credentials.sql",
    import.meta.url,
  ),
  "utf8",
);
sql(
  readFileSync(
    new URL("../../supabase/migrations/20260702150000_email_oauth_tokens.sql", import.meta.url),
    "utf8",
  ),
);
sql(migration.replace(/commit;\n$/, "rollback;\n"));
assert.equal(
  sql(
    "select to_regprocedure('learn_microsoft_credential_read(uuid,uuid,uuid,uuid,text,text,uuid,text,integer,uuid)') is null;",
  ),
  "t",
);
sql(migration);
const tenant = uid(1),
  account = uid(950),
  binding = uid(951),
  mailbox = uid(952),
  directory = uid(953),
  client = uid(954),
  token = uid(955),
  job = uid(956);
const payload = {
  email_account_id: account,
  mailbox_id: mailbox,
  binding_id: binding,
  kind: "folders",
  folder_id: "",
};
const association = {
  contract: "microsoft-delegated-credential/1",
  microsoftTenantId: directory,
  mailboxId: mailbox,
  bindingId: binding,
  clientId: client,
};
sql(`insert into email_accounts(id,tenant_id,provider,status,auth_state,email_address) values(${q(account)},${q(tenant)},'microsoft_365','active','ok','synthetic-credentials@example.invalid');
insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(binding)},${q(tenant)},${q(account)},${q(directory)},${q(mailbox)},true);
insert into email_oauth_tokens(id,tenant_id,email_account_id,provider,access_token,refresh_token,expires_at,scope,token_type,raw_payload) values(${q(token)},${q(tenant)},${q(account)},'microsoft_365','PRIVATE-old','PRIVATE-refresh',clock_timestamp()-interval '1 second','Mail.Read','Bearer',${j({ learnMicrosoft: association })});
insert into platform_jobs(id,tenant_id,status,claimed_by,attempt_count,lease_expires_at,connector_id,module_id,job_type,payload,job_key) values(${q(job)},${q(tenant)},'running','credential-worker',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email','email.microsoft_discovery',${j(payload)},${q(`email.microsoft_discovery:${binding}:`)});`);
const args = {
  p_tenant: tenant,
  p_account: account,
  p_mailbox: mailbox,
  p_binding: binding,
  p_kind: "folders",
  p_folder: "",
  p_job: job,
  p_worker: "credential-worker",
  p_claim: 1,
  p_client: client,
};
const expression = (name, args) =>
  `public.${name}(${Object.entries(args)
    .map(
      ([k, v]) =>
        `${k}=>${v === null ? "null" : typeof v === "object" ? j(v) : typeof v === "number" ? String(v) : q(v)}`,
    )
    .join(",")})`;
function rpc(name, args, role = "service_role") {
  try {
    return {
      data: JSON.parse(
        sql(`set role ${role};select ${expression(name, args)};`)
          .split("\n")
          .at(-1),
      ),
      error: null,
    };
  } catch {
    return { data: null, error: { message: "private database rejection" } };
  }
}
let calls = 0,
  refreshes = 0,
  reads = 0;
const db = {
  async rpc(name, args) {
    calls++;
    return rpc(name, args);
  },
};
const read = () => rpc("learn_microsoft_credential_read", args);
assert.ok(read().data);
for (const role of ["anon", "authenticated"])
  assert.ok(rpc("learn_microsoft_credential_read", args, role).error);
for (const patch of [
  { p_tenant: uid(999) },
  { p_worker: "stale" },
  { p_claim: 2 },
  { p_client: uid(999) },
  { p_mailbox: uid(999) },
])
  assert.ok(rpc("learn_microsoft_credential_read", { ...args, ...patch }).error);
for (const [change, restore] of [
  [
    `update learn_microsoft_mailbox_bindings set enabled=false where id=${q(binding)}`,
    `update learn_microsoft_mailbox_bindings set enabled=true where id=${q(binding)}`,
  ],
  [
    `update email_accounts set auth_state='revoked' where id=${q(account)}`,
    `update email_accounts set auth_state='ok' where id=${q(account)}`,
  ],
  [
    `insert into feature_flags values(${q(tenant)},'learn.inputs.email.enabled','false')`,
    `delete from feature_flags where tenant_id=${q(tenant)} and flag='learn.inputs.email.enabled'`,
  ],
  [
    `update email_oauth_tokens set raw_payload='{}' where id=${q(token)}`,
    `update email_oauth_tokens set raw_payload=${j({ learnMicrosoft: association })} where id=${q(token)}`,
  ],
  [
    `update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(job)}`,
    `update platform_jobs set lease_expires_at=clock_timestamp()+interval '10 minutes' where id=${q(job)}`,
  ],
]) {
  sql(change);
  assert.ok(read().error);
  sql(restore);
}
const before = read().data;
const update = {
  ...args,
  p_token: token,
  p_updated_at: before.updatedAt,
  p_old_refresh: before.refreshToken,
  p_access: "PRIVATE-new",
  p_refresh: "PRIVATE-rotated",
  p_expires: new Date(Date.now() + 3600000).toISOString(),
  p_scope: "Mail.Read",
};
assert.equal(
  rpc("learn_microsoft_credential_refresh", { ...update, p_scope: "Mail.ReadBasic" }).data,
  null,
);
assert.equal(rpc("learn_microsoft_credential_refresh", update).data.state, "saved");
assert.equal(
  rpc("learn_microsoft_credential_refresh", { ...update, p_access: "PRIVATE-stale" }).data.state,
  "changed",
);
assert.equal(read().data.accessToken, "PRIVATE-new");
assert.equal(read().data.refreshToken, "PRIVATE-rotated");
// Set up a real port refresh, then revoke during its synthetic token response.
sql(
  `update email_oauth_tokens set expires_at=clock_timestamp()-interval '1 second' where id=${q(token)}`,
);
let revoke = true;
const ports = createMicrosoftCapturePorts(db, {
  config: () => ({ clientId: client, clientSecret: "PRIVATE-synthetic" }),
  refresh: async () => {
    refreshes++;
    if (revoke)
      sql(`update learn_microsoft_mailbox_bindings set enabled=false where id=${q(binding)}`);
    return {
      accessToken: "PRIVATE-committed",
      refreshToken: "PRIVATE-next-refresh",
      expiresIn: 3600,
      scope: "Mail.Read",
    };
  },
});
ports.fetcher = async (_url, init) => {
  reads++;
  assert.equal(init.headers.Authorization, "Bearer PRIVATE-committed");
  return Response.json({ value: [] });
};
const claim = { tenantId: tenant, jobId: job, claimedBy: "credential-worker", attemptCount: 1 };
await assert.rejects(
  runMicrosoftCaptureJob(db, claim, ports),
  (e) => e.code === "credential_save_unconfirmed",
);
assert.equal(reads, 0);
assert.equal(
  sql(`select refresh_token from email_oauth_tokens where id=${q(token)}`),
  "PRIVATE-rotated",
);
sql(`update learn_microsoft_mailbox_bindings set enabled=true where id=${q(binding)}`);
revoke = false;
const completion = await runMicrosoftCaptureJob(db, claim, ports);
assert.equal(completion.state, "completed");
assert.equal(completion.mailboxCoverage, "unverified");
assert.equal(reads, 1);
assert.equal(refreshes, 2);
assert.equal(sql(`select status from platform_jobs where id=${q(job)}`), "succeeded");
assert.equal(sql(`select count(*) from learn_microsoft_source_pages where job_id=${q(job)}`), "1");
assert.equal(
  sql(`select refresh_token from email_oauth_tokens where id=${q(token)}`),
  "PRIVATE-next-refresh",
);
// Recover after revocation without token access, provider reads, or new jobs.
sql(`update learn_microsoft_mailbox_bindings set enabled=false where id=${q(binding)}`);
assert.deepEqual(await runMicrosoftCaptureJob(db, claim, ports), completion);
assert.equal(reads, 1);
assert.equal(refreshes, 2);
// A message job uses the committed cached token and reaches canonical mail plus
// interaction/event evidence. This closes the local credential-to-projection path.
const messageJob = uid(957),
  folder = "CredentialFolder",
  messageId = "CredentialMessage";
const messagePayload = { ...payload, kind: "messages", folder_id: folder };
sql(`update learn_microsoft_mailbox_bindings set enabled=true where id=${q(binding)};
insert into platform_jobs(id,tenant_id,status,claimed_by,attempt_count,lease_expires_at,connector_id,module_id,job_type,payload,job_key) values(${q(messageJob)},${q(tenant)},'running','credential-worker',1,clock_timestamp()+interval '10 minutes','microsoft-365','communications.email','email.microsoft_sync',${j(messagePayload)},${q(`email.microsoft_sync:${binding}:${folder}`)});`);
ports.fetcher = async (_url, init) => {
  reads++;
  assert.equal(init.headers.Authorization, "Bearer PRIVATE-committed");
  return Response.json({
    value: [
      {
        id: messageId,
        changeKey: "V1",
        conversationId: "CredentialThread",
        parentFolderId: folder,
        internetMessageId: "<credential@example.invalid>",
        subject: "Synthetic credential journey",
        body: {
          contentType: "text",
          content: "Synthetic body retained through the credential port",
        },
        bodyPreview: "Synthetic body",
        from: { emailAddress: { address: "synthetic-customer@example.invalid" } },
        toRecipients: [{ emailAddress: { address: "synthetic-credentials@example.invalid" } }],
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
};
const messageResult = await runMicrosoftCaptureJob(db, { ...claim, jobId: messageJob }, ports);
assert.equal(messageResult.observationsStored, 1);
assert.equal(refreshes, 2);
assert.equal(reads, 2);
assert.equal(
  sql(
    `select body_text from email_messages where tenant_id=${q(tenant)} and provider_message_id=${q(directory + ":" + mailbox + ":" + messageId)}`,
  ),
  "Synthetic body retained through the credential port",
);
assert.equal(
  sql(
    `select count(*) from interactions i join email_messages m on i.source_id=m.id where m.tenant_id=${q(tenant)} and m.provider_message_id=${q(directory + ":" + mailbox + ":" + messageId)} and i.source_connector_id='microsoft-365'`,
  ),
  "1",
);
console.log(
  JSON.stringify({
    state: "passed",
    checks: [
      "Credential RPC migration rolls back cleanly",
      "Anon/authenticated, foreign company/client/mailbox, stale claim and revoked/paused binding rejected",
      "Refresh persists rotated token; stale update cannot overwrite winner",
      "Revocation during refresh prevents token save and Graph access",
      "Real port/SQL/reader/settlement retain a synthetic page and recover completion after revocation without provider access",
      "Cached committed token carries a complete synthetic message into canonical email and Microsoft interaction",
    ],
    provider: "synthetic only",
    database: "network-isolated minimal dependencies; not hosted/full-schema",
  }),
);
