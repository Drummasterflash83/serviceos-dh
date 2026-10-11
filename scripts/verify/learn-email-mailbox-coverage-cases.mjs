/** Actual engine + durable SQL protocol across a legacy-to-whole-mailbox upgrade. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runEmailCaptureJob } from "../../supabase/functions/_shared/email_capture_engine.ts";
import { bindEmailJobAttempt } from "../../supabase/functions/_shared/email_job_attempt.ts";
import {
  prepareEmailTransition,
  readEmailTransition,
  EmailTransitionUnconfirmed,
} from "../../supabase/functions/_shared/email_ingestion_protocol.ts";
import { applyDurableEmailTransition } from "../../supabase/functions/_shared/email_ingestion_outbox.ts";

export async function verifyEmailMailboxCoverage({ t, sql, db, queueJob, q }) {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20261101370000_learn_email_mailbox_coverage.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const row = (j) =>
    JSON.parse(
      sql(
        `select row_to_json(c) from email_ingestion_checkpoints c where email_account_id=${q(j.accountId)} and stream='recent'`,
      ),
    );
  const cursor = (j) =>
    sql(`select coalesce(history_id,'NULL') from email_accounts where id=${q(j.accountId)}`);
  function job() {
    const j = queueJob();
    sql(
      `update email_accounts set email_address=${q(j.accountId + "@example.invalid")} where id=${q(j.accountId)}`,
    );
    return j;
  }
  function next(j, result) {
    assert.ok(result.successorId);
    return claim({ ...j, jobId: result.successorId });
  }
  function claim(j) {
    sql(
      `update platform_jobs set status='running',claimed_by='coverage-worker',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 hour' where id=${q(j.jobId)}`,
    );
    return { ...j, claimedBy: "coverage-worker", attemptCount: 1 };
  }
  function round(j) {
    const answer = JSON.parse(
      sql(
        `set role service_role;select learn_email_enqueue(${q(j.tenantId)},${q(j.accountId)},'email.workspace_sync','{}')`,
      ),
    );
    return claim({ ...j, jobId: answer.job_id });
  }
  function ports(j, list, boundary = "100") {
    const calls = [];
    return {
      calls,
      admission: async () => ({ allowed: true }),
      mailbox: async () => ({
        tenantId: j.tenantId,
        accountId: j.accountId,
        mailbox: j.accountId + "@example.invalid",
        historical: null,
      }),
      accessToken: async () => "synthetic",
      fetcher: async (url) => {
        const u = new URL(url);
        calls.push(u);
        if (u.pathname.endsWith("/profile"))
          return Response.json({
            emailAddress: j.accountId + "@example.invalid",
            historyId: boundary,
          });
        if (u.pathname.endsWith("/messages") || u.pathname.endsWith("/history")) return list(u);
        const id = u.pathname.split("/").at(-1);
        return Response.json({
          id,
          threadId: "thread-" + id,
          internalDate: "1700000000000",
          historyId: boundary,
          labelIds: id.includes("spam")
            ? ["SPAM"]
            : id.includes("trash")
              ? ["TRASH"]
              : ["Label_customer"],
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "customer@example.invalid" },
              { name: "To", value: j.accountId + "@example.invalid" },
              { name: "Subject", value: "Synthetic archived customer message" },
            ],
            body: { data: btoa("Synthetic coverage proof") },
          },
        });
      },
    };
  }
  // Leave a real v2 generation incomplete, with an immutable receipt predating deployment.
  const legacy = job();
  const p = ports(legacy, () =>
    Response.json({ messages: [{ id: "legacy-" + legacy.accountId }] }),
  );
  const first = await runEmailCaptureJob(db, legacy, p);
  assert.equal(first.coverageComplete, false);
  assert.equal(row(legacy).continuation.version, 2);
  const legacyState = JSON.stringify(row(legacy));
  const frozen = sql(
    `select jsonb_agg(to_jsonb(t) order by transition_id) from email_ingestion_transitions t where email_account_id=${q(legacy.accountId)}`,
  );
  sql(migration);
  await t.test(
    "upgrade leaves pending legacy scope, durable receipts and original cursor untouched",
    async () => {
      assert.equal(JSON.stringify(row(legacy)), legacyState);
      assert.equal(
        sql(
          `select jsonb_agg(to_jsonb(t) order by transition_id) from email_ingestion_transitions t where email_account_id=${q(legacy.accountId)}`,
        ),
        frozen,
      );
      assert.equal(cursor(legacy), "NULL");
      const n = next(legacy, first);
      const p = ports(n, (u) => {
        assert.equal(u.searchParams.get("labelIds"), "SENT");
        assert.equal(u.searchParams.has("includeSpamTrash"), false);
        return Response.json({});
      });
      const result = await runEmailCaptureJob(db, n, p);
      assert.equal(result.coverageComplete, true);
      assert.equal(cursor(n), "100");
      const transitionId = sql(
        `select transition_id from email_ingestion_transitions where attempt_id=${q(first.attemptId)} and operation='checkpoint'`,
      );
      const replay = await readEmailTransition(
        db,
        { ...legacy, attemptId: first.attemptId, stream: "recent" },
        transitionId,
      );
      assert.equal(replay.disposition, "replayed");
      assert.equal(replay.currentMatchesReceipt, false);
      assert.equal(replay.accepted.coverage_complete, false);
    },
  );
  await t.test(
    "completed legacy generation performs mailbox-wide reconciliation before using history, with archived/spam/trash pages",
    async () => {
      let j = round(legacy);
      const id = "archived-" + j.accountId;
      const p = ports(
        j,
        (u) => {
          assert.equal(u.pathname.endsWith("/messages"), true);
          assert.equal(u.searchParams.has("labelIds"), false);
          assert.equal(u.searchParams.get("includeSpamTrash"), "true");
          assert.equal(u.searchParams.has("q"), false);
          return u.searchParams.has("pageToken")
            ? Response.json({
                messages: [{ id: "spam-" + j.accountId }, { id: "trash-" + j.accountId }],
              })
            : Response.json({ messages: [{ id }], nextPageToken: "all-next" });
        },
        "200",
      );
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.coverageComplete, false);
      assert.equal(cursor(j), "100");
      assert.equal(row(j).continuation.version, 3);
      assert.equal(row(j).continuation.mode, "reconcile");
      assert.deepEqual(row(j).continuation.labels, ["ALL"]);
      j = next(j, r);
      const done = await runEmailCaptureJob(db, j, p);
      assert.equal(done.coverageComplete, true);
      assert.equal(cursor(j), "200");
      assert.equal(done.successorId, null);
      assert.equal(
        sql(
          `select count(*) from email_messages where provider_message_id in (${q(id)},${q("spam-" + j.accountId)},${q("trash-" + j.accountId)})`,
        ),
        "3",
      );
      assert.deepEqual(
        JSON.parse(
          sql(
            `select raw_payload->'label_ids' from email_messages where provider_message_id=${q("spam-" + j.accountId)}`,
          ),
        ),
        ["SPAM"],
      );
      assert.deepEqual(
        JSON.parse(
          sql(
            `select raw_payload->'label_ids' from email_messages where provider_message_id=${q("trash-" + j.accountId)}`,
          ),
        ),
        ["TRASH"],
      );
    },
  );
  await t.test(
    "next generation uses unfiltered history, saves archived additions and commits only the captured boundary",
    async () => {
      let j = round(legacy);
      const id = "new-archive-" + j.accountId;
      const p = ports(
        j,
        (u) => {
          assert.equal(u.pathname.endsWith("/history"), true);
          assert.equal(u.searchParams.has("labelId"), false);
          assert.equal(u.searchParams.get("startHistoryId"), "200");
          assert.equal(u.searchParams.get("historyTypes"), "messageAdded");
          return Response.json({
            historyId: "350",
            history: [{ id: "301", messagesAdded: [{ message: { id } }] }],
          });
        },
        "300",
      );
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.coverageComplete, true);
      assert.equal(cursor(j), "300");
      assert.equal(row(j).continuation.mode, "history");
      assert.equal(
        sql(`select count(*) from email_messages where provider_message_id=${q(id)}`),
        "1",
      );
    },
  );
  await t.test(
    "new protocol account with an old cursor also reconciles, and resumed pages cannot switch label scope",
    async () => {
      const j = job();
      sql(
        `set role email_ingestion_protocol_owner;update email_accounts set history_id='50' where id=${q(j.accountId)}`,
      );
      const p = ports(j, (u) => {
        assert.equal(u.pathname.endsWith("/messages"), true);
        return Response.json({ nextPageToken: "pending" });
      });
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.coverageComplete, false);
      assert.equal(cursor(j), "50");
      const n = next(j, r),
        a = await bindEmailJobAttempt(db, n);
      const c = row(n);
      c.revision = String(c.revision);
      const claimed = await applyDurableEmailTransition(
        db,
        prepareEmailTransition(a, c, randomUUID(), "claim", { recovery: null }),
        n,
      );
      const wrong = prepareEmailTransition(a, claimed.checkpoint, randomUUID(), "checkpoint", {
        label: "INBOX",
        expected_input_page_token: null,
        returned_next_page_token: null,
        exhausted: true,
        page_evidence: {
          persistence: "confirmed",
          message_upsert_count: 0,
          thread_upsert_count: 0,
          ids_seen: 0,
          gone_count: 0,
          unresolved_count: 0,
        },
        yield_after_page: true,
      });
      const before = JSON.stringify(row(n));
      const rejected = await applyDurableEmailTransition(db, wrong, n);
      assert.equal(rejected.accepted, null);
      assert.equal(JSON.stringify(row(n)), before);
      assert.equal(cursor(n), "50");
    },
  );
  await t.test(
    "lost mailbox-wide checkpoint response recovers its exact page without refetching or duplicating messages",
    async () => {
      const j = job();
      let dropped = false;
      const unreliable = {
        rpc: async (fn, args) => {
          const r = await db.rpc(fn, args);
          if (
            !dropped &&
            fn === "learn_email_transition_apply" &&
            sql(
              `select document->>'operation' from learn_email_transition_requests where id=${q(args.p_request)}`,
            ) === "checkpoint"
          ) {
            dropped = true;
            throw Error("Synthetic lost reply");
          }
          if (dropped && fn === "email_ingestion_transition_result_v2")
            throw Error("Synthetic receipt read unavailable");
          return r;
        },
      };
      const p = ports(j, () => Response.json({ messages: [{ id: "lost-" + j.accountId }] }));
      await assert.rejects(runEmailCaptureJob(unreliable, j, p), EmailTransitionUnconfirmed);
      const calls = p.calls.length;
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.state, "completed");
      assert.equal(r.historicalReceipt, true);
      assert.equal(p.calls.length, calls);
      assert.equal(cursor(j), "100");
      assert.equal(
        sql(
          `select count(*) from email_messages where provider_message_id=${q("lost-" + j.accountId)}`,
        ),
        "1",
      );
    },
  );
  await t.test(
    "paused mailbox-wide capture needs no provider token and advances no cursor",
    async () => {
      const j = job(),
        p = ports(j, () => {
          throw Error("Paused capture reached provider");
        });
      p.admission = async () => ({ allowed: false, reason: "paused" });
      p.accessToken = async () => {
        throw Error("Paused capture reached credentials");
      };
      const r = await runEmailCaptureJob(db, j, p);
      assert.equal(r.state, "deferred");
      assert.equal(p.calls.length, 0);
      assert.equal(cursor(j), "NULL");
    },
  );
}
