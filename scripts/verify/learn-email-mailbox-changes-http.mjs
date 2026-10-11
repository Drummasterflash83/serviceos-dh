/** Hosted storage API acceptance, synthetic data only, no user/grant/provider requests. */
import { writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import {
  readMailboxChangesCatalog,
  mailboxChangesSnapshot,
} from "./learn-email-mailbox-changes-catalog.mjs";
const prefix = ".verification-results/email-mailbox-changes-http-v1";
const tenant = "ec400710-aaaa-4000-8000-000000000001",
  account = "ec400710-aaaa-4000-8000-000000000002",
  job = "ec400710-aaaa-4000-8000-000000000003";
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const check = (v, message) => {
  if (!v) throw Error(message);
};
if (
  process.argv.slice(2).join(" ") !== "--run --existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST scope required");
const token = savedCliToken(),
  sql = (query, readOnly = true) => communicationQuery(token, query, { readOnly });
const catalog = await readMailboxChangesCatalog(token);
check(catalog.fingerprint === "6feb54fea0efbe744d0775cf01f90e22", "Exact release 071 required");
check(
  (await sql(`select not exists(select 1 from tenants where id=${q(tenant)}) as absent`))[0].absent,
  "Fixture exists; inspect before retry",
);
const inventory = await sql(mailboxChangesSnapshot(catalog.catalog.phone, { archive: true }));
check(inventory.length === 124, "All 124 preservation datasets required");
const snapshot = inventory
  .map(({ name }) => {
    check(/^(public|auth|vault|storage)\.[a-z_]+$/.test(name), "Unrecognized table");
    return `select ${q(name)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${name} s where coalesce(to_jsonb(s)->>'tenant_id','')<>${q(tenant)} ${name === "public.tenants" ? `and s.id<>${q(tenant)}` : ""}`;
  })
  .join(" union all ");
const before = await sql(snapshot),
  stable = (r) => JSON.stringify([...r].sort((a, b) => a.name.localeCompare(b.name)));
const keysResponse = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  },
);
check(keysResponse.ok, "Existing TEST credential unavailable");
const matching = (await keysResponse.json()).filter((k) => k.name === "service_role");
check(matching.length === 1, "Unique existing service credential required");
const service = matching[0].api_key,
  claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url").toString());
check(claims.ref === TEST_PROJECT && claims.role === "service_role", "Credential target differs");
const journal = {
  projectRef: TEST_PROJECT,
  tenant,
  account,
  job,
  startedAt: new Date().toISOString(),
  before,
  scope:
    "One synthetic tenant/email account, zero Auth users/grants, at most 12 storage RPCs, no Google or other provider requests",
};
const fd = openSync(prefix + "-journal.json", "wx", 0o600);
try {
  writeSync(fd, JSON.stringify(journal, null, 2));
  fsyncSync(fd);
} finally {
  closeSync(fd);
}
let calls = 0,
  submitted = false,
  failure = null,
  context,
  checkpoint,
  attempt;
const checks = [];
async function rpc(name, args, { valid = true, auth = true } = {}) {
  check(++calls <= 12, "RPC budget exceeded");
  const response = await fetch(`https://${TEST_PROJECT}.supabase.co/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { apikey: service, Authorization: `Bearer ${service}` } : {}),
    },
    body: JSON.stringify(args),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (valid) check(response.ok, `RPC ${name} unconfirmed HTTP ${response.status}`);
  return { status: response.status, data };
}
async function step(op, payload) {
  const r = await rpc("email_ingestion_transition_v2", {
    p_tenant_id: tenant,
    p_email_account_id: account,
    p_stream: "recent",
    p_attempt_id: attempt,
    p_transition_id: randomUUID(),
    p_operation: op,
    p_expected_generation: checkpoint?.generation ?? null,
    p_expected_revision: checkpoint?.revision ?? null,
    p_expected_owner_attempt_id: checkpoint?.owner_attempt_id ?? null,
    p_payload: payload,
  });
  check(r.data?.disposition === "applied", "Protocol transition refused");
  checkpoint = r.data.current_checkpoint;
  return r.data;
}
try {
  submitted = true;
  await sql(
    `begin;
 insert into tenants(id,slug,display_name,status,metadata) values(${q(tenant)},'email-change-api-v1','Synthetic email change API acceptance','active','{"email_change_api_fixture":true}');
 insert into feature_flags(tenant_id,flag,value) values(${q(tenant)},'learn.inputs.email.enabled','false');
 insert into email_accounts(id,tenant_id,provider,email_address,status) values(${q(account)},${q(tenant)},'gmail','capture-probe@example.invalid','active_dwd');
 insert into platform_jobs(id,tenant_id,job_type,job_key,connector_id,module_id,payload,status,claimed_by,attempt_count,lease_expires_at) values(${q(job)},${q(tenant)},'email.workspace_sync',${q("email.workspace_sync:" + account)},'google-workspace','communications.email',jsonb_build_object('email_account_id',${q(account)},'max_results',25),'running','mailbox-http-probe',1,clock_timestamp()+interval '10 minutes');commit;`,
    false,
  );
  const unauthed = await rpc(
    "learn_email_store_unavailable",
    { p_context: {}, p_ids: [] },
    { valid: false, auth: false },
  );
  check([401, 403].includes(unauthed.status), "Unsigned storage request accepted");
  checks.push({ name: "unsigned_storage_denied", status: unauthed.status });
  const bound = await rpc("learn_email_job_attempt", {
    p_tenant: tenant,
    p_job: job,
    p_claimed_by: "mailbox-http-probe",
    p_claim: 1,
  });
  attempt = bound.data.attempt_id;
  check(typeof attempt === "string", "Attempt not bound");
  await step("claim", { recovery: null });
  await step("initialize_traversal", {
    captured_history_id: "200",
    captured_at: new Date().toISOString(),
    page_size: 25,
    query: null,
  });
  context = {
    tenant_id: tenant,
    email_account_id: account,
    attempt_id: attempt,
    stream: "recent",
    generation: checkpoint.generation,
    revision: checkpoint.revision,
    mailbox: "capture-probe@example.invalid",
    fetch_policy: "refetch_all",
  };
  const lease = { p_claimed_by: "mailbox-http-probe", p_claim: 1 };
  const threads = [
    {
      tenant_id: tenant,
      provider: "gmail",
      provider_thread_id: "synthetic-change-thread",
      subject: "Synthetic source history",
      participants: ["customer@example.invalid"],
      last_message_at: "2026-10-11T20:00:00Z",
      updated_at: "2026-10-11T20:00:00Z",
    },
  ];
  const message = {
    tenant_id: tenant,
    provider: "gmail",
    provider_message_id: "synthetic-change-message",
    provider_thread_id: "synthetic-change-thread",
    from_email: "capture-probe@example.invalid",
    from_name: null,
    to_emails: ["customer@example.invalid"],
    cc_emails: [],
    subject: "Synthetic source history",
    snippet: null,
    body_text: "Synthetic retained draft",
    body_html: null,
    sent_at: null,
    received_at: "2026-10-11T20:00:00Z",
    direction: "unknown",
    raw_payload: {
      label_ids: ["DRAFT"],
      history_id: "100",
      provider_availability: "available",
      provider_observed_history_id: "100",
    },
  };
  const stored = await rpc("learn_email_store_page", {
    p_context: context,
    p_threads: threads,
    p_messages: [message],
    ...lease,
  });
  check(stored.data.message_upsert_count === 1, "Source not stored");
  const denied = await rpc(
    "learn_email_store_unavailable",
    {
      p_context: { ...context, tenant_id: randomUUID() },
      p_ids: ["synthetic-change-message"],
      ...lease,
    },
    { valid: false },
  );
  check(denied.status === 409, "Foreign context was not refused");
  checks.push({ name: "foreign_context_denied", status: denied.status });
  const absent = await rpc("learn_email_store_unavailable", {
    p_context: context,
    p_ids: ["synthetic-change-message"],
    ...lease,
  });
  check(absent.data.observed_count === 1, "Absence not stored");
  const replay = await rpc("learn_email_store_unavailable", {
    p_context: context,
    p_ids: ["synthetic-change-message"],
    ...lease,
  });
  check(replay.data.observed_count === 0, "Repeated absence changed history");
  const sent = {
    ...message,
    body_text: "Synthetic sent revision",
    direction: "outbound",
    sent_at: "2026-10-11T20:01:00Z",
    raw_payload: {
      ...message.raw_payload,
      label_ids: ["SENT"],
      history_id: "201",
      provider_observed_history_id: "201",
    },
  };
  const restored = await rpc("learn_email_store_page", {
    p_context: context,
    p_threads: threads,
    p_messages: [sent],
    ...lease,
  });
  check(restored.data.message_upsert_count === 1, "Newer state not restored");
  const stale = await rpc("learn_email_store_unavailable", {
    p_context: context,
    p_ids: ["synthetic-change-message"],
    ...lease,
  });
  check(stale.data.observed_count === 0, "Older absence overwrote newer source");
  const evidence = (
    await sql(
      `select (select count(*) from email_messages where tenant_id=${q(tenant)})::int as messages,(select count(*) from learn_email_source_versions where tenant_id=${q(tenant)})::int as archived_versions,(select bool_and(body_text='Synthetic sent revision' and direction='outbound' and raw_payload->>'provider_availability'='available') from email_messages where tenant_id=${q(tenant)}) as restored,(select count(*) from learn_email_source_versions where tenant_id=${q(tenant)} and source_row->>'body_text'='Synthetic retained draft')::int as retained_drafts`,
    )
  )[0];
  check(
    evidence.messages === 1 &&
      evidence.archived_versions === 2 &&
      evidence.restored &&
      evidence.retained_drafts === 2,
    "Stored source history differs",
  );
  checks.push({ name: "source_history_and_recovery", ...evidence });
  await step("checkpoint", {
    label: "ALL",
    expected_input_page_token: null,
    returned_next_page_token: null,
    exhausted: true,
    page_evidence: {
      persistence: "confirmed",
      message_upsert_count: 1,
      thread_upsert_count: 1,
      ids_seen: 1,
      gone_count: 0,
      unresolved_count: 0,
    },
    yield_after_page: true,
  });
  const progress = (
    await sql(
      `select a.history_id,c.state from email_accounts a join email_ingestion_checkpoints c on c.email_account_id=a.id and c.tenant_id=a.tenant_id where a.id=${q(account)} and a.tenant_id=${q(tenant)} and c.stream='recent'`,
    )
  )[0];
  check(
    progress?.history_id === "200" && progress?.state === "completed",
    "Durable cursor not confirmed",
  );
  checks.push({ name: "cursor_advanced_only_after_confirmed_storage", ...progress });
  const completed = await rpc("platform_jobs_complete_email_v1", {
    p_job_id: job,
    p_tenant_id: tenant,
    p_claimed_by: "mailbox-http-probe",
    p_attempt_count: 1,
    p_document: {
      result: {
        sync_run_id: attempt,
        ingestion: {
          success: true,
          stream: "recent",
          email_account_id: account,
          sync_run_id: attempt,
          records_processed: 1,
          invocation_records_processed: 1,
          threads_processed: 1,
          historical_receipt: false,
          coverage_complete: true,
          retry_action: "none",
          persistence_certainty: "confirmed",
          checkpoint_certainty: "confirmed",
        },
      },
      records_processed: 1,
      continuation: null,
    },
  });
  check(
    completed.data?.version === 1 &&
      ["applied", "replayed"].includes(completed.data.disposition) &&
      completed.data.job_id === job &&
      completed.data.successor_id === null,
    "Job completion not confirmed",
  );
  checks.push({ name: "atomic_job_completion", disposition: completed.data.disposition });
} catch (e) {
  failure = e.message;
} finally {
  try {
    if (submitted)
      await sql(
        `begin;
 update email_accounts set status='disabled' where id=${q(account)} and tenant_id=${q(tenant)};
 update platform_jobs set status='cancelled',cancelled_at=clock_timestamp() where tenant_id=${q(tenant)} and status in('queued','running','retrying');
 update tenants set status='archived' where id=${q(tenant)};commit;`,
        false,
      );
  } catch (e) {
    failure = [failure, "Cleanup unconfirmed: " + e.message].filter(Boolean).join("; ");
  }
}
const after = await sql(snapshot),
  preserved = stable(before) === stable(after),
  schemaAfter = await readMailboxChangesCatalog(token);
const cleanup = (
  await sql(
    `select exists(select 1 from tenants where id=${q(tenant)} and status='archived') as archived,not exists(select 1 from email_accounts where tenant_id=${q(tenant)} and status<>'disabled') as account_disabled,not exists(select 1 from platform_jobs where tenant_id=${q(tenant)} and status in('queued','running','retrying')) as no_active_jobs,not exists(select 1 from profiles where tenant_id=${q(tenant)}) as no_user_access`,
  )
)[0];
const ok =
  !failure &&
  preserved &&
  Object.values(cleanup).every(Boolean) &&
  schemaAfter.fingerprint === catalog.fingerprint;
const report = {
  state: ok ? "hosted_storage_api_verified" : "requires_inspection",
  observedAt: new Date().toISOString(),
  projectRef: TEST_PROJECT,
  rpcCalls: calls,
  checks,
  cleanup,
  preservedDatasets: preserved ? 124 : null,
  schemaUnchanged: schemaAfter.fingerprint === catalog.fingerprint,
  newAuthUsers: 0,
  newGrants: 0,
  providerRequests: 0,
  productionChanged: false,
  failure,
  limitations: [
    "Synthetic storage API acceptance. No real Gmail request, positive Edge worker capture or signed-in user journey.",
  ],
};
writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;
