import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { bindEmailJobAttempt } from "../../supabase/functions/_shared/email_job_attempt.ts";
import { prepareEmailTransition } from "../../supabase/functions/_shared/email_ingestion_protocol.ts";
import { applyDurableEmailTransition } from "../../supabase/functions/_shared/email_ingestion_outbox.ts";
import { runEmailCaptureJob } from "../../supabase/functions/_shared/email_capture_engine.ts";

export async function verifyEmailPausedRecovery({ t, sql, db, queueJob, q, reference }) {
  const read = (path) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
  const controls = read("supabase/migrations/20261031230000_learn_capture_controls.sql");
  const migration = read("supabase/migrations/20261101000500_learn_email_paused_recovery.sql");
  // Only capture-admission dependencies are reconstructed here. The complete
  // operator/Slack/phone migration has its separate capture-controls fixture.
  const captureFunction = (name) => {
    const start = controls.indexOf("create function public." + name + "(");
    assert.ok(start >= 0);
    const end = controls.indexOf("$$;", start);
    assert.ok(end > start);
    return controls.slice(start, end + 3);
  };
  sql(
    "create table tenants(id uuid primary key,status text);create table feature_flags(tenant_id uuid,flag text,value jsonb,primary key(tenant_id,flag));",
  );
  sql(
    captureFunction("learn_capture_allowed") +
      captureFunction("learn_capture_job_allowed") +
      captureFunction("learn_capture_defer_job"),
  );
  sql(reference.functions.find((f) => f.name === "platform_jobs_claim").definition);
  // Apply the original claim filter verbatim, omitting unrelated claimants.
  const start = controls.indexOf("do $$declare d text;needle text;begin");
  const end = controls.indexOf(" d:=pg_get_functiondef('public.learn_slack_claim_jobs", start);
  assert.ok(start >= 0 && end > start);
  sql(controls.slice(start, end) + "end $$;");
  for (const signature of [
    "learn_capture_allowed(uuid,text)",
    "learn_capture_job_allowed(uuid,text,jsonb)",
    "learn_capture_defer_job(uuid,uuid,text,integer,text)",
    "platform_jobs_claim(text,integer,integer,text[])",
  ])
    sql(
      `revoke all on function ${signature} from public,anon,authenticated;grant execute on function ${signature} to service_role;`,
    );
  const before = sql(
    "select pg_get_functiondef('platform_jobs_claim(text,integer,integer,text[])'::regprocedure)",
  );
  const signature = "learn_capture_job_allowed(uuid,text,jsonb,uuid)";
  await t.test(
    "paused-recovery migration rolls back exactly and grants only the service claimant",
    () => {
      sql(migration.replace("\ncommit;", "\nrollback;"));
      assert.equal(sql(`select to_regprocedure(${q(signature)}) is null`), "t");
      assert.equal(
        sql(
          "select pg_get_functiondef('platform_jobs_claim(text,integer,integer,text[])'::regprocedure)",
        ),
        before,
      );
      sql(migration);
      assert.equal(
        sql(
          "select pg_get_functiondef('platform_jobs_claim(text,integer,integer,text[])'::regprocedure)",
        ),
        before.replace(
          "c.tenant_id,c.job_type,c.metadata)",
          "c.tenant_id,c.job_type,c.metadata,c.id)",
        ),
      );
      for (const role of ["anon", "authenticated"])
        assert.equal(
          sql(`select has_function_privilege(${q(role)},${q(signature)},'EXECUTE')`),
          "f",
        );
      assert.equal(
        sql(`select has_function_privilege('service_role',${q(signature)},'EXECUTE')`),
        "t",
      );
    },
  );
  // Exclude earlier suite jobs from selection while retaining all their history.
  sql("update platform_jobs set available_at=clock_timestamp()+interval '1 year'");
  const make = () => {
    const j = queueJob();
    sql(
      `insert into tenants values(${q(j.tenantId)},'active') on conflict do nothing;insert into feature_flags values(${q(j.tenantId)},'learn.inputs.email.enabled','false') on conflict(tenant_id,flag) do update set value='false';`,
    );
    return j;
  };
  const queued = (j) =>
    sql(
      `update platform_jobs set status='retrying',lease_expires_at=null,available_at=null where id=${q(j.jobId)}`,
    );
  const allowed = (j, tenant = j.tenantId, type = "email.workspace_sync", metadata = {}) =>
    sql(
      `set role service_role;select learn_capture_job_allowed(${q(tenant)},${q(type)},${q(JSON.stringify(metadata))}::jsonb,${q(j.jobId)})`,
    ) === "t";
  const claim = () =>
    JSON.parse(
      sql(
        "set role service_role;select coalesce(jsonb_agg(to_jsonb(j)),'[]') from platform_jobs_claim('recovery-worker',50,300,null)j",
      ),
    );
  const pausePorts = {
    admission: async () => ({
      allowed: false,
      reason: "paused",
      code: "learn_capture_paused",
      message: "Paused",
      httpStatus: 409,
    }),
    mailbox: async () => {
      throw Error("Paused recovery requested a mailbox");
    },
    accessToken: async () => {
      throw Error("Paused recovery requested credentials");
    },
    fetcher: async () => {
      throw Error("Paused recovery requested a provider");
    },
  };
  const resume = (j, row) => ({ ...j, claimedBy: row.claimed_by, attemptCount: row.attempt_count });
  const evidence = {
    persistence: "confirmed",
    message_upsert_count: 0,
    thread_upsert_count: 0,
    ids_seen: 0,
    gone_count: 0,
    unresolved_count: 0,
    coverage_complete: false,
  };
  async function save(j, scope, request) {
    await db.rpc("learn_email_transition_prepare", {
      p_document: request,
      p_claimed_by: j.claimedBy,
      p_claim: j.attemptCount,
    });
    assert.equal(request.attemptId, scope.attemptId);
  }
  await t.test(
    "pause excludes fresh and merely-bound jobs without consuming attempts; metadata cannot bypass it",
    async () => {
      const fresh = make(),
        bound = make();
      await bindEmailJobAttempt(db, bound);
      for (const j of [fresh, bound]) {
        queued(j);
        assert.equal(
          allowed(j, j.tenantId, "email.workspace_sync", {
            slack_page_v1: {},
            learn_email_recovery: true,
          }),
          false,
        );
      }
      assert.deepEqual(claim(), []);
      assert.equal(
        sql(
          `select string_agg(attempt_count::text,',' order by id) from platform_jobs where id in (${q(fresh.jobId)},${q(bound.jobId)})`,
        ),
        "1,1",
      );
    },
  );
  await t.test(
    "a pending claim is recovered while paused, then defers without credentials or another attempt charge",
    async () => {
      const j = make(),
        scope = await bindEmailJobAttempt(db, j);
      await save(
        j,
        scope,
        prepareEmailTransition(scope, null, randomUUID(), "claim", { recovery: null }),
      );
      queued(j);
      assert.equal(allowed(j), true);
      assert.equal(allowed(j, randomUUID()), false);
      assert.equal(allowed(j, j.tenantId, "email.gmail_sync"), false);
      const rows = claim();
      assert.deepEqual(
        rows.map((r) => r.id),
        [j.jobId],
      );
      const lease = resume(j, rows[0]);
      assert.equal((await runEmailCaptureJob(db, lease, pausePorts)).state, "deferred");
      assert.equal(
        sql(
          `select count(*) from learn_email_transition_settlements s join learn_email_transition_requests r on r.id=s.request_id where r.attempt_id=${q(scope.attemptId)}`,
        ),
        "1",
      );
      sql(
        `set role service_role;select learn_capture_defer_job(${q(j.tenantId)},${q(j.jobId)},${q(lease.claimedBy)},${lease.attemptCount},'paused')`,
      );
      assert.equal(
        sql(`select status||':'||attempt_count from platform_jobs where id=${q(j.jobId)}`),
        "queued:1",
      );
      assert.equal(allowed(j), false);
    },
  );
  await t.test("changed job definitions cannot use a saved request to bypass pause", async () => {
    const j = make(),
      scope = await bindEmailJobAttempt(db, j);
    await save(
      j,
      scope,
      prepareEmailTransition(scope, null, randomUUID(), "claim", { recovery: null }),
    );
    sql(`update platform_jobs set payload=payload||'{"force":true}'::jsonb where id=${q(j.jobId)}`);
    queued(j);
    assert.equal(allowed(j), false);
    assert.deepEqual(claim(), []);
    sql(
      `update platform_jobs set available_at=clock_timestamp()+interval '1 year' where id=${q(j.jobId)}`,
    );
  });
  await t.test(
    "pending release and terminal success settle while paused with no successor or provider access",
    async () => {
      for (const pending of [true, false]) {
        const j = make(),
          scope = await bindEmailJobAttempt(db, j);
        const c = await applyDurableEmailTransition(
          db,
          prepareEmailTransition(scope, null, randomUUID(), "claim", { recovery: null }),
          j,
        );
        const release = prepareEmailTransition(scope, c.checkpoint, randomUUID(), "release", {
          reason_code: "requested_yield",
          attempt_evidence: evidence,
        });
        if (pending) await save(j, scope, release);
        else await applyDurableEmailTransition(db, release, j);
        queued(j);
        assert.equal(allowed(j), true);
        const rows = claim();
        assert.deepEqual(
          rows.map((r) => r.id),
          [j.jobId],
        );
        const outcome = await runEmailCaptureJob(db, resume(j, rows[0]), pausePorts);
        assert.equal(outcome.state, "completed");
        assert.equal(outcome.historicalReceipt, true);
        assert.equal(outcome.successorId, null);
        assert.equal(sql(`select status from platform_jobs where id=${q(j.jobId)}`), "succeeded");
      }
    },
  );
  await t.test(
    "terminal failure remains recoverable after account disablement and settles only under the new lease",
    async () => {
      const j = make(),
        scope = await bindEmailJobAttempt(db, j);
      const c = await applyDurableEmailTransition(
        db,
        prepareEmailTransition(scope, null, randomUUID(), "claim", { recovery: null }),
        j,
      );
      const blocked = await applyDurableEmailTransition(
        db,
        prepareEmailTransition(scope, c.checkpoint, randomUUID(), "block", {
          error_code: "fetch_failed",
          attempt_evidence: { ...evidence, classification: "fetch_failure" },
        }),
        j,
      );
      assert.equal(blocked.accepted?.attempt_status, "failed");
      sql(`update email_accounts set status='disabled' where id=${q(j.accountId)}`);
      queued(j);
      const rows = claim();
      assert.deepEqual(
        rows.map((r) => r.id),
        [j.jobId],
      );
      const lease = resume(j, rows[0]);
      assert.equal((await runEmailCaptureJob(db, lease, pausePorts)).state, "failed");
      const result = await db.rpc("learn_email_job_fail", {
        p_tenant: j.tenantId,
        p_job: j.jobId,
        p_attempt: scope.attemptId,
        p_claimed_by: lease.claimedBy,
        p_claim: lease.attemptCount,
      });
      assert.equal(result.data.disposition, "applied");
      assert.equal(sql(`select status from platform_jobs where id=${q(j.jobId)}`), "dead_letter");
    },
  );
  await t.test(
    "recovery covers all three mailbox types while discovery stays paused and normal admission still resumes",
    async () => {
      for (const type of ["email.gmail_sync", "email.workspace_sync", "email.workspace_backfill"]) {
        const j = make();
        sql(
          `update platform_jobs set job_type=${q(type)},job_key=${q(type + ":" + j.accountId)},connector_id=${q(type === "email.gmail_sync" ? "gmail" : "google-workspace")} where id=${q(j.jobId)}`,
        );
        const scope = await bindEmailJobAttempt(db, j);
        await save(
          j,
          scope,
          prepareEmailTransition(scope, null, randomUUID(), "claim", { recovery: null }),
        );
        queued(j);
        assert.equal(allowed(j, j.tenantId, type), true);
        assert.equal(allowed(j, j.tenantId, "email.mailbox_discovery"), false);
        assert.deepEqual(
          claim().map((r) => r.id),
          [j.jobId],
        );
      }
      const fresh = make();
      assert.equal(allowed(fresh), false);
      sql(`delete from feature_flags where tenant_id=${q(fresh.tenantId)};`);
      assert.equal(allowed(fresh), true);
      sql(`insert into feature_flags values(${q(fresh.tenantId)},'learn.enabled','false')`);
      assert.equal(allowed(fresh), false);
      sql(`update feature_flags set value='"invalid"' where tenant_id=${q(fresh.tenantId)}`);
      assert.equal(allowed(fresh), false);
    },
  );
}
