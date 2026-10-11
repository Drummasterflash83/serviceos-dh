import {
  GmailCaptureError,
  DELEGATION_CAPTURE_CODES,
} from "../../supabase/functions/_shared/gmail_capture_page.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  runEmailCaptureJob,
  EmailQueueCompletionUnconfirmed,
} from "../../supabase/functions/_shared/email_capture_engine.ts";
import {
  EmailTransitionUnconfirmed,
  prepareEmailTransition,
} from "../../supabase/functions/_shared/email_ingestion_protocol.ts";
import { bindEmailJobAttempt } from "../../supabase/functions/_shared/email_job_attempt.ts";
import { applyDurableEmailTransition } from "../../supabase/functions/_shared/email_ingestion_outbox.ts";
export async function verifyEmailCaptureEngine({ t, sql, db, queueJob, q, reference }) {
  const complete = reference.functions.find((f) => f.name === "platform_jobs_complete_email_v1");
  sql(
    complete.definition +
      ";revoke all on function platform_jobs_complete_email_v1(uuid,uuid,text,integer,jsonb) from public;grant execute on function platform_jobs_complete_email_v1(uuid,uuid,text,integer,jsonb) to service_role;",
  );
  function job(historical = false) {
    const j = queueJob();
    sql(
      `update email_accounts set email_address=${q(j.accountId + "@example.invalid")} where id=${q(j.accountId)};` +
        (historical
          ? `update platform_jobs set job_type='email.workspace_backfill',job_key=${q("email.workspace_backfill:" + j.accountId)},priority=200 where id=${q(j.jobId)};`
          : ""),
    );
    return j;
  }
  function ports(j, list) {
    const calls = [],
      counter = { admission: 0, token: 0 };
    return {
      calls,
      counter,
      admission: async () => {
        counter.admission++;
        return { allowed: true };
      },
      mailbox: async () => {
        const a = JSON.parse(
          sql(
            `select row_to_json(a) from (select email_address,backfill_page_token,backfill_total_fetched from email_accounts where id=${q(j.accountId)})a`,
          ),
        );
        return {
          tenantId: j.tenantId,
          accountId: j.accountId,
          mailbox: a.email_address,
          historical: { pageToken: a.backfill_page_token, total: a.backfill_total_fetched },
        };
      },
      accessToken: async () => {
        counter.token++;
        return "synthetic";
      },
      fetcher: async (url) => {
        const u = new URL(String(url));
        calls.push(u.pathname + u.search);
        if (u.pathname.endsWith("/profile"))
          return Response.json({
            emailAddress: j.accountId + "@example.invalid",
            historyId: String(99 + calls.filter((x) => x.endsWith("/profile")).length),
          });
        if (u.pathname.endsWith("/messages") || u.pathname.endsWith("/history")) return list(u);
        const id = u.pathname.split("/").at(-1);
        return Response.json({
          id,
          threadId: "thread-" + id,
          internalDate: "1700000000000",
          historyId: "100",
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "sender@example.invalid" },
              { name: "To", value: j.accountId + "@example.invalid" },
              { name: "Subject", value: "Synthetic engine page" },
            ],
            body: { data: btoa("Synthetic engine body") },
          },
        });
      },
    };
  }
  function next(j, outcome) {
    assert.ok(outcome.successorId);
    const n = { ...j, jobId: outcome.successorId, claimedBy: "next-worker", attemptCount: 1 };
    sql(
      `update platform_jobs set status='running',claimed_by=${q(n.claimedBy)},attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 hour' where id=${q(n.jobId)}`,
    );
    return n;
  }
  function replace(j) {
    const n = { ...j, claimedBy: "replacement", attemptCount: j.attemptCount + 1 };
    sql(
      `update platform_jobs set claimed_by=${q(n.claimedBy)},attempt_count=${n.attemptCount},lease_expires_at=clock_timestamp()+interval '1 hour' where id=${q(n.jobId)}`,
    );
    return n;
  }
  function pageOperation(args) {
    return sql(
      `select document->>'operation' from learn_email_transition_requests where id=${q(args.p_request)}`,
    );
  }
  await t.test(
    "bound alias profile captures through the original account and rejects an unrelated profile",
    async () => {
      const j = job(true),
        prefix = "alias-" + j.accountId;
      const p = ports(j, () => Response.json({ messages: [{ id: prefix }] })),
        mailbox = p.mailbox,
        fetcher = p.fetcher;
      p.mailbox = async () => ({ ...(await mailbox()), profileMailbox: "primary@example.invalid" });
      p.fetcher = async (url) =>
        String(url).endsWith("/profile")
          ? Response.json({ emailAddress: "primary@example.invalid", historyId: "100" })
          : fetcher(url);
      const result = await runEmailCaptureJob(db, j, p);
      assert.equal(result.state, "completed");
      assert.equal(result.recordsProcessed, 1);
      assert.equal(
        sql(`select email_address from email_accounts where id=${q(j.accountId)}`),
        j.accountId + "@example.invalid",
      );
      assert.equal(
        sql(`select count(*) from email_messages where provider_message_id=${q(prefix)}`),
        "1",
      );
      const bad = job(true),
        b = ports(bad, () => {
          throw Error("Unrelated profile must not reach message listing");
        }),
        read = b.mailbox;
      b.mailbox = async () => ({ ...(await read()), profileMailbox: "primary@example.invalid" });
      const refused = await runEmailCaptureJob(db, bad, b);
      assert.equal(refused.state, "failed");
      assert.equal(refused.code, "source_ineligible");
    },
  );
  await t.test(
    "mailbox engine traverses both recent labels across atomic queue successors before advancing the captured cursor",
    async () => {
      let j = job();
      const prefix = "engine-" + j.accountId;
      const p = ports(j, (u) => {
        const sent = u.searchParams.get("labelIds") === "SENT",
          second = u.searchParams.get("pageToken") === "page-two";
        return Response.json(
          sent
            ? { messages: [{ id: prefix + "-1" }, { id: prefix + "-3" }] }
            : second
              ? { messages: [{ id: prefix + "-2" }] }
              : { messages: [{ id: prefix + "-1" }], nextPageToken: "page-two" },
        );
      });
      let r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.state, "completed");
      assert.equal(r.historicalReceipt, false);
      assert.equal(
        sql(`select coalesce(history_id,'NULL') from email_accounts where id=${q(j.accountId)}`),
        "NULL",
      );
      const first = j;
      j = next(j, r);
      r = await runEmailCaptureJob(db, j, p);
      assert.equal(
        sql(`select coalesce(history_id,'NULL') from email_accounts where id=${q(j.accountId)}`),
        "NULL",
      );
      j = next(j, r);
      r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.successorId, null);
      assert.equal(sql(`select history_id from email_accounts where id=${q(j.accountId)}`), "100");
      assert.equal(
        sql(
          `select count(*) from email_messages where provider_message_id like ${q(prefix + "%")}`,
        ),
        "3",
      );
      assert.equal(p.calls.filter((x) => x.includes("/messages?")).length, 3);
      assert.equal(
        p.calls.filter((x) => x.includes("/messages/") && x.endsWith("format=full")).length,
        3,
      );
      assert.equal(
        sql(
          `select count(*) from platform_jobs where tenant_id=${q(j.tenantId)} and payload->>'email_account_id'=${q(j.accountId)} and status='succeeded'`,
        ),
        "3",
      );
      assert.equal(
        sql(
          `select result->'ingestion'->>'coverage_complete' from platform_jobs where id=${q(first.jobId)}`,
        ),
        "false",
      );
      assert.equal(
        sql(
          `select result->'ingestion'->>'coverage_complete' from platform_jobs where id=${q(j.jobId)}`,
        ),
        "true",
      );
    },
  );
  await t.test(
    "historical engine retains exact page tokens and totals and completes only after the final page",
    async () => {
      let j = job(true);
      const prefix = "history-" + j.accountId;
      const p = ports(j, (u) =>
        Response.json(
          u.searchParams.get("pageToken") === "next-history"
            ? { messages: [{ id: prefix + "-2" }] }
            : { messages: [{ id: prefix + "-1" }], nextPageToken: "next-history" },
        ),
      );
      let r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.state, "completed");
      assert.equal(
        sql(`select backfill_page_token from email_accounts where id=${q(j.accountId)}`),
        "next-history",
      );
      assert.equal(
        sql(`select backfill_status from email_accounts where id=${q(j.accountId)}`),
        "running",
      );
      j = next(j, r);
      r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.successorId, null);
      assert.equal(
        sql(
          `select backfill_status||':'||backfill_total_fetched from email_accounts where id=${q(j.accountId)}`,
        ),
        "completed:2",
      );
      assert.ok(p.calls.every((x) => !x.includes("labelIds")));
    },
  );
  await t.test(
    "saved page transitions settle while capture is paused without token acquisition or another provider request",
    async () => {
      let j = job();
      const p = ports(j, () =>
        Response.json({
          messages: [{ id: "pending-" + j.accountId }],
          nextPageToken: "retained-page",
        }),
      );
      const lost = {
        rpc: async (name, args) => {
          if (name === "learn_email_transition_apply" && pageOperation(args) === "checkpoint")
            throw Error("synthetic interruption before apply");
          return db.rpc(name, args);
        },
      };
      await assert.rejects(runEmailCaptureJob(lost, j, p), EmailTransitionUnconfirmed);
      const count = p.calls.length;
      j = replace(j);
      p.admission = async () => {
        throw Error("recovery must not require admission");
      };
      p.accessToken = async () => {
        throw Error("recovery must not mint token");
      };
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.state, "completed");
      assert.equal(r.historicalReceipt, true);
      assert.equal(r.successorId, null);
      assert.equal(p.calls.length, count);
      assert.equal(
        sql(
          `select continuation#>>'{labels_state,INBOX,next_page_token}' from email_ingestion_checkpoints where email_account_id=${q(j.accountId)} and stream='recent'`,
        ),
        "retained-page",
      );
      assert.equal(
        sql(
          `select result->'ingestion'->>'invocation_records_processed' from platform_jobs where id=${q(j.jobId)}`,
        ),
        "0",
      );
    },
  );
  await t.test(
    "lost checkpoint acknowledgement recovers the same terminal run and does not repeat provider work",
    async () => {
      let j = job();
      const p = ports(j, () => Response.json({ messages: [{ id: "ack-" + j.accountId }] }));
      const lost = {
        rpc: async (name, args) => {
          const r = await db.rpc(name, args);
          if (name === "learn_email_transition_apply" && pageOperation(args) === "checkpoint")
            throw Error("synthetic lost checkpoint acknowledgement");
          return r;
        },
      };
      await assert.rejects(runEmailCaptureJob(lost, j, p), EmailTransitionUnconfirmed);
      const before = p.calls.length;
      j = replace(j);
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.historicalReceipt, true);
      assert.equal(p.calls.length, before);
      assert.equal(
        sql(
          `select count(*) from email_sync_runs where metadata->>'learn_email_job_id'=${q(j.jobId)}`,
        ),
        "1",
      );
    },
  );
  await t.test(
    "lost atomic queue completion remains unknown while the committed successor and receipt stay recoverable",
    async () => {
      const j = job(),
        p = ports(j, () => Response.json({ messages: [], nextPageToken: "queue-next" }));
      let saved;
      const lost = {
        rpc: async (name, args) => {
          const r = await db.rpc(name, args);
          if (name === "platform_jobs_complete_email_v1") {
            saved = structuredClone(args);
            throw Error("synthetic lost queue acknowledgement");
          }
          return r;
        },
      };
      await assert.rejects(runEmailCaptureJob(lost, j, p), EmailQueueCompletionUnconfirmed);
      assert.equal(sql(`select status from platform_jobs where id=${q(j.jobId)}`), "succeeded");
      const receipt = await db.rpc("platform_jobs_complete_email_v1", saved);
      assert.equal(receipt.data.disposition, "replayed");
      assert.ok(receipt.data.successor_id);
      assert.equal(
        sql(
          `select count(*) from platform_jobs where job_key=${q("email.workspace_sync:" + j.accountId)} and status='queued'`,
        ),
        "1",
      );
    },
  );
  await t.test(
    "expired provider history blocks its generation without resetting the existing cursor",
    async () => {
      const j = job();
      sql(
        `set role email_ingestion_protocol_owner;update email_accounts set history_id='1' where id=${q(j.accountId)}`,
      );
      const p = ports(j, () =>
        Response.json({ error: "synthetic expired history" }, { status: 404 }),
      );
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.state, "failed");
      assert.equal(r.code, "history_expired");
      assert.equal(sql(`select history_id from email_accounts where id=${q(j.accountId)}`), "1");
      assert.equal(
        sql(
          `select state||':'||block_code from email_ingestion_checkpoints where email_account_id=${q(j.accountId)}`,
        ),
        "blocked:history_expired",
      );
      assert.equal(p.calls.filter((x) => x.includes("/messages?")).length, 0);
    },
  );
  await t.test(
    "paused new work defers before mailbox access and invalid saved continuation blocks before credentials",
    async () => {
      const j = job(),
        p = ports(j, () => {
          throw Error("unexpected provider request");
        });
      p.admission = async () => ({
        allowed: false,
        reason: "paused",
        code: "learn_capture_paused",
        message: "paused",
        httpStatus: 409,
      });
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.state, "deferred");
      assert.equal(p.counter.token, 0);
      assert.equal(p.calls.length, 0);
      const scope = await bindEmailJobAttempt(db, j);
      const claimed = await applyDurableEmailTransition(
        db,
        prepareEmailTransition(scope, null, randomUUID(), "claim", { recovery: null }),
        j,
      );
      sql(
        `update email_ingestion_checkpoints set continuation=continuation||'{"injected":true}'::jsonb where email_account_id=${q(j.accountId)}`,
      );
      p.admission = async () => ({ allowed: true });
      const failed = await runEmailCaptureJob(db, j, p);
      assert.equal(failed.state, "failed");
      assert.equal(failed.code, "parse_failed");
      assert.equal(p.counter.token, 0);
      assert.equal(p.calls.length, 0);
    },
  );
  await t.test("foreign token identity is refused before message listing", async () => {
    const j = job(),
      p = ports(j, () => {
        throw Error("unexpected message listing");
      });
    p.fetcher = async () =>
      Response.json({ emailAddress: "foreign@example.invalid", historyId: "100" });
    const r = await runEmailCaptureJob(db, j, p);
    assert.equal(r.state, "failed");
    assert.equal(r.code, "source_ineligible");
    assert.equal(
      sql(
        `select count(*) from email_ingestion_transitions where email_account_id=${q(j.accountId)} and operation='initialize_traversal'`,
      ),
      "0",
    );
  });
  await t.test(
    "page-storage failure records uncertainty without advancing mailbox progress or completing the job",
    async () => {
      const j = job(),
        id = "refused-" + j.accountId,
        p = ports(j, () => Response.json({ messages: [{ id }] }));
      sql(
        `alter table email_messages add constraint engine_refuse_page check(provider_message_id<>${q(id)})`,
      );
      try {
        const r = await runEmailCaptureJob(db, j, p);
        assert.equal(r.state, "failed");
        assert.equal(r.code, "persistence_failed");
        assert.equal(
          sql(
            `select state||':'||block_code from email_ingestion_checkpoints where email_account_id=${q(j.accountId)}`,
          ),
          "blocked:persistence_failed",
        );
        assert.equal(
          sql(
            `select metadata#>>'{email_ingestion_v2,evidence,persistence}' from email_sync_runs where id=${q(r.attemptId)}`,
          ),
          "unknown",
        );
        assert.equal(
          sql(`select count(*) from email_messages where provider_message_id=${q(id)}`),
          "0",
        );
        assert.equal(
          sql(`select count(*) from email_threads where provider_thread_id=${q("thread-" + id)}`),
          "0",
        );
        assert.equal(
          sql(`select coalesce(history_id,'NULL') from email_accounts where id=${q(j.accountId)}`),
          "NULL",
        );
        assert.equal(sql(`select status from platform_jobs where id=${q(j.jobId)}`), "running");
      } finally {
        sql("alter table email_messages drop constraint engine_refuse_page");
      }
    },
  );
  await t.test(
    "forced reconciliation keeps refetch policy across successors without resetting the generation",
    async () => {
      let j = job();
      const id = "force-" + j.accountId;
      sql(
        `update platform_jobs set payload=payload||'{"force":true}'::jsonb where id=${q(j.jobId)};set role email_ingestion_protocol_owner;update email_accounts set history_id='50' where id=${q(j.accountId)}`,
      );
      const p = ports(j, (u) =>
        Response.json(
          u.searchParams.get("pageToken") === "force-next"
            ? { messages: [{ id }] }
            : { messages: [{ id }], nextPageToken: "force-next" },
        ),
      );
      let r = await runEmailCaptureJob(db, j, p);
      const generation = sql(
        `select generation from email_ingestion_checkpoints where email_account_id=${q(j.accountId)}`,
      );
      const messageId = sql(`select id from email_messages where provider_message_id=${q(id)}`);
      assert.equal(
        sql(`select payload ? 'force' from platform_jobs where id=${q(r.successorId)}`),
        "f",
      );
      j = next(j, r);
      r = await runEmailCaptureJob(db, j, p);
      assert.equal(p.calls.filter((x) => x.includes("/messages/" + id + "?")).length, 2);
      assert.equal(
        sql(
          `select generation from email_ingestion_checkpoints where email_account_id=${q(j.accountId)}`,
        ),
        generation,
      );
      assert.equal(
        sql(
          `select continuation->>'fetch_policy' from email_ingestion_checkpoints where email_account_id=${q(j.accountId)}`,
        ),
        "refetch_all",
      );
      assert.equal(
        sql(`select id from email_messages where provider_message_id=${q(id)}`),
        messageId,
      );
      assert.equal(sql(`select history_id from email_accounts where id=${q(j.accountId)}`), "50");
      assert.equal(
        p.calls.some((x) => x.includes("/history?")),
        false,
      );
    },
  );
  const failureMigration = readFileSync(
    new URL(
      "../../supabase/migrations/20261031235900_learn_email_job_failure.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await t.test("email failure settlement migration is reversible and service-only", async () => {
    sql(failureMigration.replace("\ncommit;", "\nrollback;"));
    assert.equal(
      sql("select to_regprocedure('learn_email_job_fail(uuid,uuid,uuid,text,integer)') is null"),
      "t",
    );
    sql(failureMigration);
    for (const role of ["anon", "authenticated"])
      assert.equal(
        sql(
          `select has_function_privilege(${q(role)},'learn_email_job_fail(uuid,uuid,uuid,text,integer)','EXECUTE')`,
        ),
        "f",
      );
  });
  async function failedJob() {
    const j = job(),
      p = ports(j, () => Response.json({ error: "synthetic provider failure" }, { status: 503 }));
    const outcome = await runEmailCaptureJob(db, j, p);
    assert.equal(outcome.state, "failed");
    return {
      j,
      outcome,
      args: {
        p_tenant: j.tenantId,
        p_job: j.jobId,
        p_attempt: outcome.attemptId,
        p_claimed_by: j.claimedBy,
        p_claim: j.attemptCount,
      },
    };
  }
  await t.test(
    "failed email attempts settle once under the current lease and recover a lost failure acknowledgement",
    async () => {
      const { j, outcome, args } = await failedJob();
      await assert.rejects(
        db.rpc("learn_email_job_fail", { ...args, p_claimed_by: "stale-worker" }),
      );
      await assert.rejects(db.rpc("learn_email_job_fail", { ...args, p_attempt: randomUUID() }));
      await assert.rejects(db.rpc("learn_email_job_fail", { ...args, p_tenant: randomUUID() }));
      assert.equal(sql(`select status from platform_jobs where id=${q(j.jobId)}`), "running");
      sql(`update email_accounts set status='disabled' where id=${q(j.accountId)}`);
      await assert.rejects(
        (async () => {
          await db.rpc("learn_email_job_fail", args);
          throw Error("synthetic lost failure reply");
        })(),
      );
      const replay = await db.rpc("learn_email_job_fail", args);
      assert.equal(replay.data.disposition, "replayed");
      assert.equal(replay.data.attempt_id, outcome.attemptId);
      assert.equal(replay.data.code, "fetch_failed");
      assert.equal(sql(`select status from platform_jobs where id=${q(j.jobId)}`), "dead_letter");
    },
  );
  await t.test(
    "lease expiry inside failure settlement rolls back the queue update and the replacement can finish it",
    async () => {
      const { j, args } = await failedJob();
      sql(
        `create sequence email_fail_delay_observed;grant usage on sequence email_fail_delay_observed to service_role;create function test_email_fail_delay() returns trigger language plpgsql as $$begin if new.id=${q(j.jobId)}::uuid and new.status='dead_letter' then perform nextval('public.email_fail_delay_observed');perform pg_sleep(1.2);end if;return new;end$$;create trigger test_email_fail_delay before update on platform_jobs for each row execute function test_email_fail_delay();update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=${q(j.jobId)};`,
      );
      await assert.rejects(db.rpc("learn_email_job_fail", args));
      assert.equal(sql("select is_called from email_fail_delay_observed"), "t");
      assert.equal(sql(`select status from platform_jobs where id=${q(j.jobId)}`), "running");
      sql("drop trigger test_email_fail_delay on platform_jobs");
      const replacement = replace(j);
      const settled = await db.rpc("learn_email_job_fail", {
        ...args,
        p_claimed_by: replacement.claimedBy,
        p_claim: replacement.attemptCount,
      });
      assert.equal(settled.data.disposition, "applied");
    },
  );
  await t.test(
    "safe Workspace diagnostic migration rolls back exactly and preserves durable failure receipts",
    async () => {
      const migration = readFileSync(
        new URL(
          "../../supabase/migrations/20261101190000_learn_email_safe_failures.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const definitions = () =>
        sql(
          "select string_agg(pg_get_functiondef(oid)||proowner::text||coalesce(proacl::text,''),E'\n' order by proname) from pg_proc where proname in ('email_ingestion_payload_v2','learn_email_job_fail')",
        );
      const before = definitions();
      sql(migration.replace("\ncommit;", "\nrollback;"));
      assert.equal(definitions(), before);
      sql(migration);
      const sources = () =>
        sql(
          "select md5(coalesce(jsonb_agg(to_jsonb(m) order by id)::text,'')) from email_messages m",
        );
      const retainedSources = sources();
      for (const code of DELEGATION_CAPTURE_CODES) {
        for (const historical of [false, true]) {
          const j = job(historical),
            p = ports(j, () => {
              throw Error("No provider request permitted after token refusal");
            });
          p.accessToken = async () => {
            throw new GmailCaptureError(code);
          };
          const outcome = await runEmailCaptureJob(db, j, p);
          assert.equal(outcome.state, "failed");
          assert.equal(outcome.code, code);
          assert.equal(p.calls.length, 0);
          assert.equal(
            sql(
              `select state||':'||block_code from email_ingestion_checkpoints where email_account_id=${q(j.accountId)}`,
            ),
            "blocked:" + code,
          );
          assert.equal(
            sql(`select error_message from email_sync_runs where id=${q(outcome.attemptId)}`),
            code,
          );
          assert.equal(
            sql(
              `select metadata#>>'{email_ingestion_v2,evidence,classification}' from email_sync_runs where id=${q(outcome.attemptId)}`,
            ),
            "source_ineligible",
          );
          const args = {
            p_tenant: j.tenantId,
            p_job: j.jobId,
            p_attempt: outcome.attemptId,
            p_claimed_by: j.claimedBy,
            p_claim: j.attemptCount,
          };
          const settled = await db.rpc("learn_email_job_fail", args);
          assert.equal(settled.data.code, code);
          assert.equal((await db.rpc("learn_email_job_fail", args)).data.disposition, "replayed");
          assert.equal(
            sql(`select status||':'||error_code from platform_jobs where id=${q(j.jobId)}`),
            "dead_letter:" + code,
          );
          assert.equal(sources(), retainedSources);
          assert.equal(
            sql(
              `select coalesce(history_id,'NULL') from email_accounts where id=${q(j.accountId)}`,
            ),
            "NULL",
          );
        }
      }
    },
  );
}
