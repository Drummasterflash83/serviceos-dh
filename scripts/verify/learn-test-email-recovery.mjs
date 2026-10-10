/** Synthetic TEST mailbox pages + deployed recovery. No login, grant or provider credential. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { RUNTIME_PRESERVED, readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import {
  EMAIL_RUNTIME_DATABASE,
  EMAIL_RUNTIME_EDGE_SHA,
  edgeInventory,
} from "./learn-test-email-runtime-deploy.mjs";
import { EMAIL_RUNTIME_ENDPOINTS, emailRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { runEmailCaptureJob } from "../../supabase/functions/_shared/email_capture_engine.ts";
import { EmailTransitionUnconfirmed } from "../../supabase/functions/_shared/email_ingestion_protocol.ts";
import { captureAdmission } from "../../supabase/functions/_shared/learn_capture_control.ts";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const types = ["email.gmail_sync", "email.workspace_sync", "email.workspace_backfill"];
export function fixturePlan() {
  return {
    runId: randomUUID(),
    tenantId: randomUUID(),
    accounts: types.map((type) => ({
      id: randomUUID(),
      type,
      endpoint:
        type === types[0]
          ? "gmail-sync-messages"
          : type === types[1]
            ? "gmail-workspace-sync-messages"
            : "gmail-workspace-backfill-messages",
    })),
  };
}
function validPlan(p) {
  assert.ok(uuid.test(p.runId) && uuid.test(p.tenantId));
  assert.deepEqual(
    p.accounts.map((a) => a.type),
    types,
  );
  assert.equal(new Set([p.runId, p.tenantId, ...p.accounts.map((a) => a.id)]).size, 5);
  assert.ok(p.accounts.every((a) => uuid.test(a.id)));
}
export function preservationSql(p) {
  validPlan(p);
  const tables = [
    ...new Set([
      ...RUNTIME_PRESERVED,
      "public.learn_capture_control_requests",
      "public.learn_email_job_attempts",
      "public.learn_email_transition_requests",
      "public.learn_email_transition_settlements",
    ]),
  ];
  return tables
    .map((table) => {
      const filter =
        table === "public.tenants"
          ? `s.id is distinct from ${q(p.tenantId)}::uuid`
          : table === "public.learn_email_transition_settlements"
            ? `not exists(select 1 from public.learn_email_transition_requests r where r.id=s.request_id and r.tenant_id=${q(p.tenantId)})`
            : `(to_jsonb(s)->>'tenant_id') is distinct from ${q(p.tenantId)}`;
      return `select ${q(table)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by md5(row_to_json(s)::text)),'')) as fingerprint from ${table} s where ${filter}`;
    })
    .join(" union all ");
}
export function setupSql(p) {
  validPlan(p);
  return `begin;
    insert into public.tenants(id,slug,display_name,status,metadata) values(
      ${q(p.tenantId)},${q("learn-email-recovery-" + p.runId)},'Synthetic email recovery acceptance','active',
      ${q(JSON.stringify({ synthetic: true, acceptance_run: p.runId }))}::jsonb);
    insert into public.feature_flags(tenant_id,flag,value) values
      (${q(p.tenantId)},'learn.enabled','true'),
      (${q(p.tenantId)},'learn.inputs.email.enabled','true'),
      (${q(p.tenantId)},'learn.inputs.phone.enabled','false'),
      (${q(p.tenantId)},'learn.inputs.slack.enabled','false');
    insert into public.email_accounts(id,tenant_id,provider,email_address,display_name,status,auth_state) values
      ${p.accounts.map((a) => `(${q(a.id)},${q(p.tenantId)},'gmail',${q(a.id + "@example.invalid")},'Synthetic mailbox',${q(a.type === types[0] ? "active" : "active_dwd")},'ok')`).join(",")};
    commit;`;
}
export function pauseSql(p, retire = false) {
  validPlan(p);
  return `begin;
    do $$begin
      if exists(select 1 from public.tenants where id=${q(p.tenantId)} and
        metadata->>'acceptance_run' is distinct from ${q(p.runId)}) then
        raise exception 'fixture_identity_mismatch';end if;
    end $$;
    select pg_advisory_xact_lock(hashtextextended('learn-input-setup:'||${q(p.tenantId)},0));
    update public.feature_flags set value='false' where tenant_id=${q(p.tenantId)}
      and flag ${retire ? "in ('learn.enabled','learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled')" : "='learn.inputs.email.enabled'"};
    ${
      retire
        ? `update public.email_accounts set status='disabled' where tenant_id=${q(p.tenantId)} and id in (${p.accounts.map((a) => q(a.id)).join(",")});
      update public.tenants set status='archived' where id=${q(p.tenantId)};`
        : `update public.platform_jobs set lease_expires_at=clock_timestamp()-interval '1 second'
        where tenant_id=${q(p.tenantId)} and status='running';`
    }
    commit;`;
}
export function syntheticPorts(p, account, db) {
  const counts = { admission: 0, mailbox: 0, token: 0, provider: 0 };
  return {
    counts,
    admission: async (tenant) => {
      counts.admission++;
      return captureAdmission(db, tenant, "email");
    },
    mailbox: async (attempt) => {
      assert.equal(attempt.tenantId, p.tenantId);
      assert.equal(attempt.accountId, account.id);
      counts.mailbox++;
      return {
        tenantId: p.tenantId,
        accountId: account.id,
        mailbox: account.id + "@example.invalid",
        historical: { pageToken: null, total: 0 },
      };
    },
    accessToken: async () => {
      counts.token++;
      return "synthetic-not-a-provider-credential";
    },
    fetcher: async (url) => {
      counts.provider++;
      const u = new URL(String(url));
      assert.equal(u.origin, "https://gmail.googleapis.com");
      if (u.pathname.endsWith("/profile"))
        return Response.json({ emailAddress: account.id + "@example.invalid", historyId: "100" });
      if (u.pathname.endsWith("/messages"))
        return Response.json({
          messages: [{ id: "synthetic-" + account.id }],
          nextPageToken: "synthetic-saved-page",
        });
      assert.ok(u.pathname.endsWith("/messages/synthetic-" + account.id));
      return Response.json({
        id: "synthetic-" + account.id,
        threadId: "synthetic-thread-" + account.id,
        internalDate: "1700000000000",
        historyId: "100",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "sender@example.invalid" },
            { name: "To", value: account.id + "@example.invalid" },
            { name: "Subject", value: "Synthetic hosted recovery acceptance" },
          ],
          body: {
            data: Buffer.from("Synthetic acceptance body. No customer data.").toString("base64url"),
          },
        },
      });
    },
  };
}
export function evidenceSql(p) {
  validPlan(p);
  const tenant = q(p.tenantId);
  return `select jsonb_build_object(
    'tenant_status',(select status from public.tenants where id=${tenant}),
    'capture_allowed',exists(select 1 from public.tenants where id=${tenant} and status='active')
      and not exists(select 1 from public.feature_flags where tenant_id=${tenant}
        and flag in ('learn.enabled','learn.inputs.email.enabled')
        and (jsonb_typeof(value) is distinct from 'boolean' or value is distinct from 'true'::jsonb)),
    'accounts',(select jsonb_agg(jsonb_build_object('id',id,'status',status,'history_id',history_id,
      'backfill_page_token',backfill_page_token,'backfill_total_fetched',backfill_total_fetched) order by id) from public.email_accounts where tenant_id=${tenant}),
    'jobs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'job_type',job_type,'attempt_count',attempt_count,'result',result) order by job_type),'[]') from public.platform_jobs where tenant_id=${tenant}),
    'runs',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'records_processed',records_processed) order by id),'[]') from public.email_sync_runs where tenant_id=${tenant}),
    'checkpoints',(select coalesce(jsonb_agg(jsonb_build_object('email_account_id',email_account_id,'stream',stream,'state',state,'continuation',continuation) order by email_account_id),'[]') from public.email_ingestion_checkpoints where tenant_id=${tenant}),
    'messages',(select count(*)::int from public.email_messages where tenant_id=${tenant}),
    'threads',(select count(*)::int from public.email_threads where tenant_id=${tenant}),
    'pending',(select count(*)::int from public.learn_email_transition_requests r where r.tenant_id=${tenant} and not exists(select 1 from public.learn_email_transition_settlements s where s.request_id=r.id)),
    'profiles',(select count(*)::int from public.profiles where tenant_id=${tenant})
  ) as evidence`;
}
export function assertRecovered(e) {
  assert.equal(e.capture_allowed, false);
  assert.equal(e.messages, 3);
  assert.equal(e.threads, 3);
  assert.equal(e.pending, 0);
  assert.equal(e.profiles, 0);
  assert.equal(e.jobs.length, 3);
  assert.equal(e.runs.length, 3);
  assert.equal(e.checkpoints.length, 3);
  for (const job of e.jobs) {
    assert.equal(job.status, "succeeded");
    assert.equal(job.attempt_count, 2);
    assert.equal(job.result?.ingestion?.historical_receipt, true);
    assert.equal(job.result?.ingestion?.invocation_records_processed, 0);
  }
  for (const run of e.runs) {
    assert.equal(run.status, "success");
    assert.equal(run.records_processed, 1);
  }
  for (const c of e.checkpoints) {
    assert.equal(c.state, "ready");
    assert.equal(
      c.stream === "recent"
        ? c.continuation.labels_state.INBOX.next_page_token
        : e.accounts.find((a) => a.id === c.email_account_id)?.backfill_page_token,
      "synthetic-saved-page",
    );
    if (c.stream === "historical")
      assert.equal(e.accounts.find((a) => a.id === c.email_account_id)?.backfill_total_fetched, 1);
  }
  for (const a of e.accounts) assert.equal(a.history_id, null);
}

async function main() {
  const command = process.argv.slice(2).join(" ");
  assert.ok(
    ["--run --existing-cli-login", "--recover-saved-pages --existing-cli-login"].includes(command),
  );
  const resume = command.startsWith("--recover-saved-pages");
  assert.equal(process.env.LEARN_TEST_ALLOW_PROJECT_REF, TEST_PROJECT);
  const journalPath = ".verification-results/email-hosted-recovery-journal.json";
  const saved = resume ? JSON.parse(readFileSync(journalPath, "utf8")) : null;
  if (saved) {
    assert.equal(saved.projectRef, TEST_PROJECT);
    assert.equal(saved.version, "learn-email-hosted-recovery/1");
    assert.ok(!saved.actions.some((a) => a.action === "deployed_worker_recovery"));
  }
  const p = saved ?? fixturePlan(),
    token = savedCliToken();
  validPlan(p);
  let phase = "preflight",
    writeAttempted = false,
    retired = false,
    before,
    evidence,
    failure;
  const journal = saved ?? {
    version: "learn-email-hosted-recovery/1",
    projectRef: TEST_PROJECT,
    ...p,
    actions: [],
  };
  const save = (action) => {
    phase = action;
    journal.actions.push({ action, at: new Date().toISOString() });
    writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
  };
  const query = (sql, readOnly = true) => communicationQuery(token, sql, { readOnly });
  const noForeignJobs = async () => {
    const r = await query(
      `select count(*)::int as count from public.platform_jobs where status in ('queued','running','retrying') and tenant_id is distinct from ${q(p.tenantId)}`,
    );
    assert.equal(r[0].count, 0);
  };
  const snapshot = () => query(preservationSql(p));
  const normalize = (rows) =>
    JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
  const readEvidence = async () => (await query(evidenceSql(p)))[0].evidence;
  try {
    assert.equal(emailRuntimeBundle().sha256, EMAIL_RUNTIME_EDGE_SHA);
    const [catalog, endpoints] = await Promise.all([
      readRuntimeCatalog(token),
      edgeInventory(token),
    ]);
    assert.equal(catalog.fingerprint, EMAIL_RUNTIME_DATABASE);
    for (const endpoint of EMAIL_RUNTIME_ENDPOINTS)
      assert.ok(
        endpoints.some(
          (e) =>
            e.slug === endpoint.name &&
            e.version === 4 &&
            e.status === "ACTIVE" &&
            e.verify_jwt === endpoint.verifyJwt,
        ),
      );
    await noForeignJobs();
    const observed = await snapshot();
    if (resume) {
      assert.equal(normalize(observed), normalize(journal.before));
      before = journal.before;
      evidence = await readEvidence();
      assert.equal(evidence.tenant_status, "archived");
      assert.equal(evidence.capture_allowed, false);
      assert.equal(evidence.accounts.length, 3);
      assert.ok(
        evidence.accounts.every(
          (a) => a.status === "disabled" && p.accounts.some((x) => x.id === a.id),
        ),
      );
      assert.equal(evidence.jobs.length, 3);
      assert.ok(
        evidence.jobs.every(
          (j) =>
            j.status === "running" &&
            j.attempt_count === 1 &&
            p.accounts.some((a) => a.jobId === j.id && a.type === j.job_type),
        ),
      );
      assert.equal(evidence.messages, 3);
      assert.equal(evidence.threads, 3);
      assert.equal(evidence.pending, 3);
      assert.equal(evidence.runs.length, 3);
      assert.ok(evidence.runs.every((r) => r.status === "running"));
    } else {
      before = observed;
      journal.before = before;
      writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", {
        mode: 0o600,
        flag: "wx",
      });
    }
    const keyResponse = await fetch(
      `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    assert.equal(keyResponse.status, 200);
    const candidates = (await keyResponse.json()).filter((k) => k.name === "service_role");
    assert.equal(candidates.length, 1);
    const service = candidates[0].api_key;
    const claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url"));
    assert.equal(claims.ref, TEST_PROJECT);
    assert.equal(claims.role, "service_role");
    const headers = {
      Authorization: `Bearer ${service}`,
      apikey: service,
      "content-type": "application/json",
    };
    const db = {
      rpc: async (name, args) => {
        assert.match(
          name,
          /^(learn_email_|email_ingestion_|platform_jobs_complete_email_v1|learn_capture_admission)/,
        );
        const r = await fetch(`https://${TEST_PROJECT}.supabase.co/rest/v1/rpc/${name}`, {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        const data = await r.json();
        return r.ok ? { data, error: null } : { data: null, error: { code: "rpc_unconfirmed" } };
      },
    };
    const endpoint = async (name, body, tenant = p.tenantId) => {
      const r = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/${name}`, {
        method: "POST",
        headers: {
          ...headers,
          "x-serviceos-internal-key": service,
          "x-internal-tenant-id": tenant,
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(45000),
      });
      return { status: r.status, body: await r.json() };
    };
    const counts = [];
    if (!resume) {
      save("create_synthetic_mailboxes");
      writeAttempted = true;
      await query(setupSql(p), false);
      for (const a of p.accounts) {
        save("enqueue:" + a.type);
        const response = await endpoint(a.endpoint, { email_account_id: a.id });
        assert.equal(response.status, 202);
        assert.equal(response.body.duplicate, false);
        assert.ok(uuid.test(response.body.job_id));
        a.jobId = response.body.job_id;
        const duplicate = await endpoint(a.endpoint, { email_account_id: a.id });
        assert.equal(duplicate.status, 202);
        assert.equal(duplicate.body.job_id, a.jobId);
        assert.equal(duplicate.body.duplicate, true);
        const conflict = await endpoint(a.endpoint, { email_account_id: a.id, max_results: 50 });
        assert.equal(conflict.status, 409);
        assert.equal(conflict.body.error.code, "active_request_conflict");
      }
      await noForeignJobs();
      save("claim_synthetic_pages");
      const worker = "synthetic-page-" + p.runId;
      const claimed = await query(
        `begin;set local role service_role;select id,tenant_id,job_type,claimed_by,attempt_count from public.platform_jobs_claim(${q(worker)},3,600,array[${types.map(q).join(",")}]);commit;`,
        false,
      );
      assert.equal(claimed.length, 3);
      for (const a of p.accounts) {
        const job = claimed.find((j) => j.id === a.jobId);
        assert.equal(job?.tenant_id, p.tenantId);
        assert.equal(job?.job_type, a.type);
        save("persist_then_interrupt:" + a.type);
        const transitions = new Map();
        const interrupted = {
          rpc: async (name, args) => {
            if (name === "learn_email_transition_prepare")
              transitions.set(args.p_document.transitionId, args.p_document.operation);
            if (
              name === "learn_email_transition_apply" &&
              transitions.get(args.p_request) === "checkpoint"
            )
              throw new Error("synthetic_interruption_before_apply");
            return db.rpc(name, args);
          },
        };
        const ports = syntheticPorts(p, a, db);
        await assert.rejects(
          runEmailCaptureJob(
            interrupted,
            {
              tenantId: p.tenantId,
              jobId: a.jobId,
              claimedBy: job.claimed_by,
              attemptCount: job.attempt_count,
            },
            ports,
          ),
          EmailTransitionUnconfirmed,
        );
        assert.equal(ports.counts.provider, 3);
        counts.push({ type: a.type, ...ports.counts });
      }
    } else {
      save("restore_saved_page_eligibility_with_capture_paused");
      writeAttempted = true;
      // The archived tenant and all false capture switches stay unchanged. Only
      // the synthetic mailbox status required to settle its saved page returns.
      const restore = p.accounts
        .map(
          (a) =>
            `update public.email_accounts set status=${q(a.type === types[0] ? "active" : "active_dwd")} where tenant_id=${q(p.tenantId)} and id=${q(a.id)};`,
        )
        .join("\n");
      await query(pauseSql(p).replace("commit;", restore + "\ncommit;"), false);
    }
    save("verify_saved_pages");
    evidence = await readEvidence();
    assert.equal(evidence.messages, 3);
    assert.equal(evidence.threads, 3);
    assert.equal(evidence.pending, 3);
    assert.ok(evidence.runs.every((r) => r.status === "running"));
    save("pause_and_expire_synthetic_leases");
    await query(pauseSql(p), false);
    await noForeignJobs();
    assert.equal((await readEvidence()).capture_allowed, false);
    save("deployed_worker_recovery");
    const recovered = await endpoint("platform-worker", { batch_size: 3, job_types: types });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.claimed, 3);
    // The worker can return before background processing completes. Read only;
    // never resubmit an ambiguous worker invocation.
    for (let attempt = 0; attempt < 6; attempt++) {
      evidence = await readEvidence();
      if (evidence.jobs.every((j) => j.status === "succeeded")) break;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assertRecovered(evidence);
    journal.recovery = {
      worker: recovered.body,
      resumedSavedPages: resume,
      syntheticProviderCalls: resume ? null : counts,
      evidence,
    };
    save("verify_preservation");
    assert.equal(normalize(await snapshot()), normalize(before));
    assert.equal((await readRuntimeCatalog(token)).fingerprint, EMAIL_RUNTIME_DATABASE);
  } catch {
    failure = { phase, state: "unconfirmed" };
  } finally {
    if (writeAttempted) {
      try {
        save("retire_synthetic_mailboxes");
        await query(pauseSql(p, true), false);
        evidence = await readEvidence();
        retired =
          evidence.tenant_status === "archived" &&
          evidence.capture_allowed === false &&
          evidence.accounts.length === 3 &&
          evidence.accounts.every((a) => a.status === "disabled");
        assert.ok(retired);
        assert.equal(normalize(await snapshot()), normalize(before));
      } catch {
        failure ??= { phase: "retirement_or_preservation", state: "unconfirmed" };
      }
    }
  }
  const report = {
    version: journal.version,
    projectRef: TEST_PROJECT,
    observedAt: new Date().toISOString(),
    state: !failure && retired ? "synthetic_recovery_verified" : "unconfirmed",
    runId: p.runId,
    tenantId: p.tenantId,
    retired,
    writeAttempted,
    preservedDataSets: before?.length ?? 0,
    failure,
    recovery: journal.recovery ?? null,
    retirement: retired
      ? {
          tenantStatus: evidence.tenant_status,
          captureAllowed: evidence.capture_allowed,
          accounts: evidence.accounts.map((a) => ({ id: a.id, status: a.status })),
          profiles: evidence.profiles,
        }
      : null,
    limitations: [
      "Mailbox pages came from in-memory synthetic provider responses; real Google authorization/capture is not established.",
      "The deployed worker recovered saved pages while paused; no new provider work, signed-in user acceptance or scheduling was tested.",
      "No login, operator grant, OAuth/Vault credential, production change or retained-source deletion.",
    ],
  };
  writeFileSync(
    failure
      ? ".verification-results/email-hosted-recovery-unconfirmed.json"
      : "docs/operations/evidence/learn-email-hosted-recovery-2026-10-10.json",
    JSON.stringify(report, null, 2) + "\n",
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      state: report.state,
      failure,
      retired,
      preservedDataSets: report.preservedDataSets,
    }),
  );
  if (failure) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
