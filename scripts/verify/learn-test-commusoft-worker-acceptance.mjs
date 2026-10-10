/** Synthetic TEST queue/authority acceptance. A nonexistent Vault reference is
 * verified before seeding, so no provider request can acquire a credential. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { readStoredCommusoftScope } from "../../supabase/functions/_shared/commusoft/stored_scope.ts";
import { readCommusoftCatalog } from "./learn-commusoft-catalog.mjs";
import { installedCommusoftWorker } from "./learn-test-commusoft-runtime.mjs";
import { commusoftFingerprint } from "./learn-test-commusoft-release.mjs";
import { readAcceptanceResponse } from "./learn-test-launch-acceptance.mjs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const tables = [
  "email_messages",
  "phone_calls",
  "phone_recordings",
  "phone_transcripts",
  "slack_messages",
  "slack_message_versions",
  "interactions",
  "people",
  "companies",
  "customer_cards",
  "sites",
  "jobs",
  "provider_connections",
  "tenant_connectors",
  "connector_accounts",
  "platform_jobs",
  "learn_business_input_request_permits",
  "learn_business_input_pages",
];
export function workerFixturePlan() {
  return Object.fromEntries(
    [
      "runId",
      "tenant",
      "connector",
      "connection",
      "account",
      "approval",
      "secret",
      "job",
      "disabledJob",
      "claimWorker",
    ].map((k) => [k, randomUUID()]),
  );
}
export function workerFixtureSeed(p) {
  const approval = {
    approved: true,
    approvalId: p.approval,
    connectionId: p.connection,
    consentReference: `Synthetic TEST ${p.runId}`,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    maxPages: 1,
    pageSize: 10,
    resource: "properties",
  };
  const marker = { synthetic: true, learn_commusoft_worker_run: p.runId };
  return `begin;
 do $$begin if exists(select 1 from vault.secrets where id=${q(p.secret)}) then raise exception 'Synthetic secret reference exists';end if;
 if exists(select 1 from platform_jobs where job_type='commusoft.source_sync' and status in ('queued','retrying','running')) then raise exception 'Other Commusoft work is active';end if;end $$;
 insert into tenants(id,slug,display_name,status,metadata) values(${q(p.tenant)},${q("commusoft-worker-" + p.runId)},'Synthetic Commusoft worker acceptance','active',${q(JSON.stringify(marker))});
 insert into feature_flags(tenant_id,flag,value) values(${q(p.tenant)},'learn.enabled','true'),(${q(p.tenant)},'learn.inputs.commusoft.enabled','true');
 insert into tenant_connectors(id,tenant_id,connector_id,provider,category,status,enabled,settings) values(${q(p.connector)},${q(p.tenant)},'commusoft','commusoft','business_input','active',true,${q(JSON.stringify(marker))});
 insert into provider_connections(id,tenant_id,provider,status,auth_mode,verified_at,non_secret_config,configured_fields,secret_refs) values(${q(p.connection)},${q(p.tenant)},'commusoft','configured','private_api_key',clock_timestamp(),${q(JSON.stringify({ ...marker, account_key: p.account, region: "uk" }))},array['api_key'],${q(JSON.stringify({ api_key: p.secret }))});
 insert into connector_accounts(id,tenant_id,tenant_connector_id,account_key,display_name,status,settings) values(${q(p.account)},${q(p.tenant)},${q(p.connector)},${q(p.account)},'Synthetic missing credential','active',${q(JSON.stringify({ ...marker, commusoft_import: approval }))});
 ${workerFixtureJob(p, p.job)} commit;`;
}
export function workerFixtureJob(p, id) {
  return `insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,max_attempts,payload,metadata)
 values(${q(id)},${q(p.tenant)},'commusoft','learn','commusoft.source_sync',${q(`commusoft.source:${p.account}:${p.approval}`)},'queued',3,${q(JSON.stringify({ connector_account_id: p.account }))},${q(JSON.stringify({ learn_commusoft_worker_run: p.runId }))});`;
}
export function workerFixtureRetire(p) {
  const owns = `exists(select 1 from tenants where id=${q(p.tenant)} and metadata->>'learn_commusoft_worker_run'=${q(p.runId)})`;
  return `begin;update feature_flags set value='false' where tenant_id=${q(p.tenant)} and ${owns};
 update tenant_connectors set enabled=false,status='disabled' where id=${q(p.connector)} and tenant_id=${q(p.tenant)} and ${owns};
 update provider_connections set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) where id=${q(p.connection)} and tenant_id=${q(p.tenant)} and ${owns};
 update connector_accounts set status='disabled' where id=${q(p.account)} and tenant_id=${q(p.tenant)} and ${owns};
 update platform_jobs set status='dead_letter',lease_expires_at=null,dead_lettered_at=clock_timestamp(),failed_at=clock_timestamp(),error_code='commusoft_synthetic_retired'
 where id in (${q(p.job)},${q(p.disabledJob)}) and tenant_id=${q(p.tenant)} and metadata->>'learn_commusoft_worker_run'=${q(p.runId)} and status in ('queued','running','retrying') and ${owns};commit;`;
}
export async function acceptCommusoftWorker({ allowProjectRef, token, fetcher = fetch }) {
  assert.equal(allowProjectRef, TEST_PROJECT, "Explicit TEST project required");
  const args = { allowProjectRef, token, fetcher },
    before = await readCommusoftCatalog(args);
  assert.ok(installedCommusoftWorker(before), "Exact worker/schema contract required");
  const management = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  async function request(url, options = {}) {
    return readAcceptanceResponse(
      await fetcher(url, { ...options, redirect: "error", signal: AbortSignal.timeout(45000) }),
    );
  }
  async function sql(query, readOnly = false) {
    const r = await request(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`,
      {
        method: "POST",
        headers: management,
        body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }),
      },
    );
    assert.ok(r.ok, `Synthetic worker SQL failed (HTTP ${r.status})`);
    return r.data;
  }
  const keys = await request(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    { headers: management },
  );
  assert.ok(keys.ok && Array.isArray(keys.data), "Existing TEST keys unavailable");
  const serviceRows = keys.data.filter((k) => k.name === "service_role");
  assert.equal(serviceRows.length, 1, "Unique service key required");
  const service = serviceRows[0].api_key,
    claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url").toString());
  assert.ok(
    claims.ref === TEST_PROJECT && claims.role === "service_role",
    "TEST key scope differs",
  );
  const base = `https://${TEST_PROJECT}.supabase.co`,
    admin = createClient(base, service, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetcher },
    });
  const p = workerFixturePlan(),
    manifest = `/private/tmp/serviceos-commusoft-worker-${p.runId}.json`;
  writeFileSync(manifest, JSON.stringify({ projectRef: TEST_PROJECT, ...p }, null, 2) + "\n", {
    mode: 0o600,
  });
  const snapshot = async () =>
    (
      await sql(
        tables
          .map(
            (t) =>
              `select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from public.${t} s where tenant_id<>${q(p.tenant)}`,
          )
          .join(" union all "),
        true,
      )
    ).sort((a, b) => a.name.localeCompare(b.name));
  const existing = await snapshot(),
    checks = [];
  let stage = "seed",
    failure = null,
    retirement = null;
  async function invoke(id) {
    // A singleton synthetic queue is required immediately before each invocation.
    const active = await sql(
      "select id::text from platform_jobs where job_type='commusoft.source_sync' and status in ('queued','retrying','running')",
      true,
    );
    assert.deepEqual(active, [{ id }], "Only the planned fixture may be claimable");
    const r = await request(`${base}/functions/v1/learn-commusoft-worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${service}`, "x-serviceos-worker-key": service },
    });
    assert.equal(r.status, 200, "Worker invocation did not complete");
    assert.deepEqual(
      r.data,
      {
        ok: true,
        result: {
          claimed: 1,
          outcomes: [{ job_id: id, status: "dead_letter", successor_id: null }],
        },
      },
      "Worker must retain a terminal authority failure",
    );
    const [j] = await sql(
      `select status,error_code,attempt_count,lease_expires_at,metadata->'commusoft_finish_v1'->'outcome' as outcome from platform_jobs where id=${q(id)} and tenant_id=${q(p.tenant)}`,
      true,
    );
    assert.equal(j.error_code, "commusoft_authority_unavailable", "Unexpected worker error");
    assert.equal(j.lease_expires_at, null);
    assert.deepEqual(j.outcome, {
      success: false,
      code: "commusoft_authority_unavailable",
      retryable: false,
      retry_after_seconds: 0,
    });
    return j;
  }
  try {
    await sql(workerFixtureSeed(p));
    stage = "claim_and_scope";
    const claimed = await admin.rpc("learn_commusoft_claim_jobs", { p_worker: p.claimWorker });
    assert.ok(
      !claimed.error && claimed.data?.length === 1 && claimed.data[0].id === p.job,
      "Dedicated claim failed",
    );
    const job = claimed.data[0],
      claim = { claimedBy: job.claimed_by, attemptCount: job.attempt_count };
    const scope = await readStoredCommusoftScope({
      tenantId: p.tenant,
      jobId: p.job,
      jobType: "commusoft.source_sync",
      claim,
      supabaseAdmin: admin,
    });
    assert.ok(
      scope && scope.accountId === p.account && scope.secretId === p.secret,
      "Stored authority must be readable before testing missing credential",
    );
    const permit = await admin.rpc("learn_commusoft_acquire_page", {
      p_tenant_id: p.tenant,
      p_job_id: p.job,
      p_claimed_by: claim.claimedBy,
      p_attempt_count: claim.attemptCount,
      p_expected: scope,
    });
    assert.ok(!permit.error && permit.data === null, "Missing credential must refuse acquisition");
    checks.push(
      "Real service client resolved complete stored scope; scoped acquisition refused the verified nonexistent Vault reference.",
    );
    // Simulate an interrupted prior claimant without waiting for the 180s lease.
    stage = "expired_claim";
    await sql(
      `update platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(p.job)} and tenant_id=${q(p.tenant)} and claimed_by=${q(claim.claimedBy)} and status='running';`,
    );
    const recovered = await invoke(p.job);
    assert.equal(recovered.attempt_count, 2, "Expired claim was not recovered");
    checks.push(
      "Deployed worker recovered the expired claim and retained a non-retryable authority failure at attempt two, with no successor.",
    );
    stage = "disabled_module";
    await sql(
      `begin;update feature_flags set value='false' where tenant_id=${q(p.tenant)} and flag='learn.inputs.commusoft.enabled';${workerFixtureJob(p, p.disabledJob)}commit;`,
    );
    const disabled = await invoke(p.disabledJob);
    assert.equal(disabled.attempt_count, 1);
    checks.push(
      "Deployed worker refused source work after the tenant Commusoft switch was disabled.",
    );
    const [history] = await sql(
      `select (select count(*)::int from learn_business_input_request_permits where tenant_id=${q(p.tenant)}) as permits,(select count(*)::int from learn_business_input_pages where tenant_id=${q(p.tenant)}) as pages,(select count(*)::int from platform_jobs where tenant_id=${q(p.tenant)}) as jobs,(select count(*)::int from vault.secrets where id=${q(p.secret)}) as secrets;`,
      true,
    );
    assert.deepEqual(
      history,
      { permits: 0, pages: 0, jobs: 2, secrets: 0 },
      "Unexpected source acquisition or successor",
    );
    assert.deepEqual(await snapshot(), existing, "Existing source/queue records changed");
    stage = "passed";
  } catch {
    failure = stage;
  } finally {
    try {
      await sql(workerFixtureRetire(p));
      const [r] = await sql(
        `select
    (select count(*)::int from feature_flags where tenant_id=${q(p.tenant)} and value='true'::jsonb) as enabled_flags,
    (select count(*)::int from tenant_connectors where tenant_id=${q(p.tenant)} and enabled) as enabled_connectors,
    (select count(*)::int from provider_connections where tenant_id=${q(p.tenant)} and revoked_at is null) as active_connections,
    (select count(*)::int from connector_accounts where tenant_id=${q(p.tenant)} and status='active') as active_accounts,
    (select count(*)::int from platform_jobs where tenant_id=${q(p.tenant)} and status in ('queued','retrying','running')) as active_jobs;`,
        true,
      );
      assert.deepEqual(r, {
        enabled_flags: 0,
        enabled_connectors: 0,
        active_connections: 0,
        active_accounts: 0,
        active_jobs: 0,
      });
      retirement = r;
    } catch {
      failure = failure ?? "retirement";
    }
  }
  const after = await readCommusoftCatalog(args),
    catalogPreserved =
      installedCommusoftWorker(after) &&
      commusoftFingerprint(after) === commusoftFingerprint(before);
  if (!catalogPreserved) failure = failure ?? "catalog_changed";
  const sourcesPreserved = JSON.stringify(await snapshot()) === JSON.stringify(existing);
  if (!sourcesPreserved) failure = failure ?? "sources_changed";
  return {
    version: "learn-test-commusoft-worker-acceptance/1",
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    runId: p.runId,
    state: failure ? "requires_inspection" : "passed",
    failure,
    checks,
    retirement,
    catalogPreserved,
    preExistingSourcesPreserved: sourcesPreserved,
    manifest,
    limitations: [
      "Synthetic missing-credential and disabled-module work only; no real Commusoft credential, provider request, successful page ingestion or production change.",
      "Synthetic job history is retained; fixture switches/accounts/connectors are disabled and connection revoked.",
    ],
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert.equal(process.argv.slice(2).join(" "), "--accept --existing-cli-login");
    const r = await acceptCommusoftWorker({
      allowProjectRef: process.env.LEARN_TEST_ALLOW_PROJECT_REF,
      token: savedCliToken(),
    });
    console.log(JSON.stringify(r, null, 2));
    if (r.state !== "passed") process.exitCode = 1;
  } catch {
    console.error(
      JSON.stringify({
        state: "requires_inspection",
        error:
          "Worker acceptance did not complete; inspect the private fixture manifest before any retry.",
      }),
    );
    process.exitCode = 1;
  }
}
