import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { bindEmailJobAttempt } from "../../supabase/functions/_shared/email_job_attempt.ts";

export async function verifyEmailEnqueue({ t, sql, sqlAsync, queueJob, q, db }) {
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261101001500_learn_email_enqueue.sql", import.meta.url),
    "utf8",
  );
  const signature = "learn_email_enqueue(uuid,uuid,text,jsonb)";
  const make = (oauth = false) => {
    const j = queueJob();
    sql(
      `update platform_jobs set status='cancelled' where id=${q(j.jobId)};delete from feature_flags where tenant_id=${q(j.tenantId)};update email_accounts set status=${q(oauth ? "active" : "active_dwd")},auth_state='ok' where id=${q(j.accountId)}`,
    );
    return j;
  };
  const query = (j, type = "email.workspace_sync", options = {}) =>
    `set role service_role;select learn_email_enqueue(${q(j.tenantId)},${q(j.accountId)},${q(type)},${q(JSON.stringify(options))}::jsonb)`;
  const enqueue = (...args) => JSON.parse(sql(query(...args)));
  const count = (table) => sql(`select count(*) from ${table}`);
  await t.test("enqueue migration is reversible and inaccessible to client roles", () => {
    sql(migration.replace("\ncommit;", "\nrollback;"));
    assert.equal(sql(`select to_regprocedure(${q(signature)}) is null`), "t");
    sql(migration);
    for (const role of ["anon", "authenticated"])
      assert.equal(sql(`select has_function_privilege(${q(role)},${q(signature)},'EXECUTE')`), "f");
  });
  await t.test(
    "manual queue acknowledgements bind all mailbox types without changing source progress or opening runs",
    async () => {
      for (const type of ["email.gmail_sync", "email.workspace_sync", "email.workspace_backfill"]) {
        const j = make(type === "email.gmail_sync"),
          before = count("email_sync_runs");
        const account = sql(
          `select row_to_json(a) from email_accounts a where id=${q(j.accountId)}`,
        );
        const result = enqueue(j, type);
        assert.equal(result.state, "queued");
        assert.equal(result.duplicate, false);
        assert.equal(count("email_sync_runs"), before);
        assert.equal(
          sql(`select row_to_json(a) from email_accounts a where id=${q(j.accountId)}`),
          account,
        );
        const row = JSON.parse(
          sql(`select row_to_json(j) from platform_jobs j where id=${q(result.job_id)}`),
        );
        assert.equal(row.job_key, type + ":" + j.accountId);
        assert.equal(row.priority, type === "email.workspace_backfill" ? 200 : 100);
        assert.deepEqual(
          row.payload,
          type === "email.workspace_backfill"
            ? { email_account_id: j.accountId }
            : { email_account_id: j.accountId, max_results: 25 },
        );
        sql(
          `update platform_jobs set status='running',claimed_by='manual-worker',attempt_count=1,lease_expires_at=clock_timestamp()+interval '5 minutes' where id=${q(row.id)}`,
        );
        const bound = await bindEmailJobAttempt(db, {
          ...j,
          jobId: row.id,
          claimedBy: "manual-worker",
          attemptCount: 1,
        });
        assert.equal(bound.accountId, j.accountId);
        assert.equal(bound.stream, type === "email.workspace_backfill" ? "historical" : "recent");
      }
    },
  );
  await t.test(
    "repeated requests reuse matching work and reject conflicting rescan/page-size intent without overwriting it",
    () => {
      const j = make(),
        first = enqueue(j);
      const before = sql(`select row_to_json(j) from platform_jobs j where id=${q(first.job_id)}`);
      const duplicate = enqueue(j, "email.workspace_sync", { force: false });
      assert.equal(duplicate.job_id, first.job_id);
      assert.equal(duplicate.duplicate, true);
      for (const options of [{ force: true }, { max_results: 50 }])
        assert.throws(
          () => enqueue(j, "email.workspace_sync", options),
          /learn_email_active_request_conflict/,
        );
      assert.equal(
        sql(`select row_to_json(j) from platform_jobs j where id=${q(first.job_id)}`),
        before,
      );
    },
  );
  await t.test(
    "pause, disabled/foreign accounts, wrong methods and restart cannot enqueue or reset progress",
    () => {
      const j = make(),
        before = count("platform_jobs");
      for (const options of [
        { restart: true },
        { max_results: 0 },
        { max_results: 500.5 },
        { max_results: "25" },
        { force: true },
      ])
        assert.throws(
          () => enqueue(j, "email.workspace_backfill", options),
          /learn_email_(explicit_recovery_required|enqueue_invalid)/,
        );
      assert.throws(() => enqueue(j, "email.gmail_sync"), /source_ineligible/);
      assert.throws(() => enqueue({ ...j, accountId: randomUUID() }), /source_ineligible/);
      sql(
        `insert into feature_flags values(${q(j.tenantId)},'learn.inputs.email.enabled','false')`,
      );
      assert.throws(() => enqueue(j), /learn_capture_paused/);
      sql(
        `delete from feature_flags where tenant_id=${q(j.tenantId)};update email_accounts set status='disabled' where id=${q(j.accountId)}`,
      );
      assert.throws(() => enqueue(j), /source_ineligible/);
      assert.equal(count("platform_jobs"), before);
    },
  );
  await t.test(
    "simultaneous manual submissions produce one active job and lost acknowledgements recover it",
    async () => {
      const j = make();
      const replies = await Promise.all([sqlAsync(query(j)), sqlAsync(query(j))]);
      const results = replies.map(JSON.parse);
      assert.equal(results[0].job_id, results[1].job_id);
      assert.deepEqual(results.map((r) => r.duplicate).sort(), [false, true]);
      const recovered = enqueue(j);
      assert.equal(recovered.job_id, results[0].job_id);
      assert.equal(recovered.duplicate, true);
      assert.equal(
        sql(
          `select count(*) from platform_jobs where tenant_id=${q(j.tenantId)} and job_key=${q("email.workspace_sync:" + j.accountId)} and status in ('queued','running','retrying')`,
        ),
        "1",
      );
    },
  );
  await t.test("normal and forced submissions racing never claim each other's intent", async () => {
    const j = make();
    const results = await Promise.allSettled([
      sqlAsync(query(j)),
      sqlAsync(query(j, "email.workspace_sync", { force: true })),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(results.filter((r) => r.status === "rejected").length, 1);
    assert.match(
      String(results.find((r) => r.status === "rejected").reason),
      /learn_email_active_request_conflict/,
    );
  });
}
