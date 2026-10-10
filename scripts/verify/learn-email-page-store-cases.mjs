import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { bindEmailJobAttempt } from "../../supabase/functions/_shared/email_job_attempt.ts";
import { prepareEmailTransition } from "../../supabase/functions/_shared/email_ingestion_protocol.ts";
import { applyDurableEmailTransition } from "../../supabase/functions/_shared/email_ingestion_outbox.ts";
import { createGmailPageStore } from "../../supabase/functions/_shared/gmail_page_store.ts";
import { parseGmailMessages } from "../../supabase/functions/_shared/gmail_message.ts";
import {
  persistGmailCapturePage,
  GmailCaptureError,
} from "../../supabase/functions/_shared/gmail_capture_page.ts";
export async function verifyEmailPageStore({ t, sql, db, queueJob, q, i }) {
  const source = readFileSync(
    new URL("../../supabase/reference/learn-email-storage-test-2026-10-10.json", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "3cc3fa240bd256f68b7963dc2df9493e09eff5c9d3fff392d3b0fe6c9f6cbced",
  );
  const ref = JSON.parse(source),
    setup = [];
  for (const table of ref.tables) {
    setup.push(
      "create table " +
        i(table.name) +
        "(" +
        table.columns
          .map(
            (c) =>
              i(c.name) +
              " " +
              c.type +
              (c.default ? " default " + c.default : "") +
              (c.notNull ? " not null" : ""),
          )
          .join(",") +
        ");",
    );
    for (const c of table.constraints)
      setup.push(
        "alter table " + i(table.name) + " add constraint " + i(c.name) + " " + c.definition + ";",
      );
    for (const idx of table.indexes.filter(
      (x) => !table.constraints.some((c) => c.name === x.name),
    ))
      setup.push(idx.definition + ";");
    setup.push("alter table " + i(table.name) + " enable row level security;");
  }
  for (const helper of ref.helpers) setup.push(helper.definition + ";");
  for (const table of ref.tables)
    for (const trigger of table.triggers) setup.push(trigger.definition + ";");
  for (const g of ref.serviceTableGrants)
    setup.push(
      "revoke all on " +
        i(g.name) +
        " from service_role;grant " +
        g.privileges.join(",") +
        " on " +
        i(g.name) +
        " to service_role;",
    );
  sql(setup.join("\n"));
  const migration = readFileSync(
    new URL("../../supabase/migrations/20261031235500_learn_email_page_store.sql", import.meta.url),
    "utf8",
  );
  const mailbox = "mailbox@example.invalid";
  let lastSqlError;
  const inspectedDb = {
    rpc: async (...args) => {
      try {
        return await db.rpc(...args);
      } catch (e) {
        lastSqlError = e;
        throw e;
      }
    },
  };
  async function owned(force = false) {
    const job = queueJob();
    const accountMailbox = current ? job.accountId + "@example.invalid" : mailbox;
    sql(
      `update email_accounts set email_address=${q(accountMailbox)} where id=${q(job.accountId)};` +
        (force
          ? `update platform_jobs set payload=payload||'{"force":true}'::jsonb where id=${q(job.jobId)};`
          : ""),
    );
    const scope = await bindEmailJobAttempt(db, job);
    const claimed = await applyDurableEmailTransition(
      db,
      prepareEmailTransition(scope, null, randomUUID(), "claim", {
        recovery: null,
        ...(force ? { force: true } : {}),
      }),
      job,
    );
    const initialized = await applyDurableEmailTransition(
      db,
      prepareEmailTransition(scope, claimed.checkpoint, randomUUID(), "initialize_traversal", {
        captured_history_id: "100",
        captured_at: "2026-10-10T00:00:00.000Z",
        page_size: 25,
        query: null,
      }),
      job,
    );
    return {
      job,
      scope,
      checkpoint: initialized.checkpoint,
      store: createGmailPageStore(
        inspectedDb,
        scope,
        initialized.checkpoint,
        accountMailbox,
        force ? "refetch_all" : "missing_only",
        job,
      ),
    };
  }
  function rows(
    scope,
    id = "m1",
    date = "1700000000000",
    sender = "first@example.invalid",
    subject = "Newer",
    history = "100",
  ) {
    return parseGmailMessages(
      [
        {
          id,
          threadId: "thread1",
          internalDate: date,
          historyId: history,
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: sender },
              { name: "To", value: mailbox },
              { name: "Subject", value: subject },
            ],
            body: { data: btoa(subject) },
          },
        },
      ],
      { tenantId: scope.tenantId, provider: "gmail", mailbox },
    );
  }
  let current;
  await t.test(
    "atomic page migration rolls back cleanly and exposes only service APIs",
    async () => {
      sql(migration.replace("\ncommit;", "\nrollback;"));
      assert.equal(
        sql(
          "select to_regprocedure('learn_email_store_page(jsonb,jsonb,jsonb,text,integer)') is null",
        ),
        "t",
      );
      sql(migration);
      for (const role of ["anon", "authenticated"])
        assert.equal(
          sql(
            `select has_function_privilege(${q(role)},'learn_email_store_page(jsonb,jsonb,jsonb,text,integer)','EXECUTE')`,
          ),
          "f",
        );
      assert.equal(
        sql("select has_table_privilege('service_role','email_ingestion_checkpoints','UPDATE')"),
        "f",
      );
      current = await owned();
    },
  );
  await t.test(
    "old email pages preserve newer thread summaries, union participants and keep source identities",
    async () => {
      const { store, scope } = current;
      const before = sql("select count(*) from email_ingestion_transitions");
      const newer = rows(scope);
      assert.deepEqual(
        await store.savePage(newer.threadRows, newer.messageRows).catch((e) => {
          throw lastSqlError ?? e;
        }),
        {
          thread_upsert_count: 1,
          message_upsert_count: 1,
        },
      );
      const id = sql("select id from email_messages where provider_message_id='m1'");
      const old = rows(scope, "m2", "1600000000000", "second@example.invalid", "Older", "90");
      await store.savePage(old.threadRows, old.messageRows);
      assert.equal(
        sql("select subject from email_threads where provider_thread_id='thread1'"),
        "Newer",
      );
      assert.deepEqual(
        JSON.parse(
          sql("select participants from email_threads where provider_thread_id='thread1'"),
        ),
        ["first@example.invalid", "mailbox@example.invalid", "second@example.invalid"],
      );
      assert.deepEqual(await store.existingMessageIds(["m1", "m2", "absent"]), ["m1", "m2"]);
      assert.deepEqual(await store.savePage(old.threadRows, old.messageRows), {
        thread_upsert_count: 1,
        message_upsert_count: 0,
      });
      assert.equal(sql("select id from email_messages where provider_message_id='m1'"), id);
      assert.equal(
        sql(`select records_processed from email_sync_runs where id=${q(scope.attemptId)}`),
        "0",
      );
      assert.equal(sql("select count(*) from email_ingestion_transitions"), before);
    },
  );
  await t.test(
    "message failure rolls back its thread write and never yields persistence evidence",
    async () => {
      const isolated = await owned();
      const fixture = rows(
        isolated.scope,
        "rollback-message",
        "1800000000000",
        "rollback@example.invalid",
        "Never committed",
      );
      sql(
        "alter table email_messages add constraint synthetic_page_failure check(provider_message_id<>'rollback-message')",
      );
      const prior = sql(
        "select row_to_json(t) from email_threads t where provider_thread_id='thread1'",
      );
      await assert.rejects(
        isolated.store.savePage(fixture.threadRows, fixture.messageRows),
        /could not be confirmed/,
      );
      assert.match(lastSqlError?.stderr ?? "", /synthetic_page_failure/);
      assert.equal(
        sql("select row_to_json(t) from email_threads t where provider_thread_id='thread1'"),
        prior,
      );
      assert.equal(
        sql("select count(*) from email_messages where provider_message_id='rollback-message'"),
        "0",
      );
      sql("alter table email_messages drop constraint synthetic_page_failure");
    },
  );
  await t.test(
    "stale leases, changed checkpoints, foreign identities and disabled mailboxes cannot write",
    async () => {
      const { scope, job, checkpoint } = current;
      const fixture = rows(scope, "refused");
      const stale = createGmailPageStore(db, scope, checkpoint, mailbox, "missing_only", {
        claimedBy: "foreign-worker",
        attemptCount: 1,
      });
      await assert.rejects(
        stale.savePage(fixture.threadRows, fixture.messageRows),
        /could not be confirmed/,
      );
      await assert.rejects(
        createGmailPageStore(
          db,
          scope,
          { ...checkpoint, revision: String(BigInt(checkpoint.revision) + 1n) },
          mailbox,
          "missing_only",
          job,
        ).existingMessageIds(["m1"]),
        /could not be confirmed/,
      );
      await assert.rejects(
        createGmailPageStore(
          db,
          scope,
          checkpoint,
          "foreign@example.invalid",
          "missing_only",
          job,
        ).savePage(fixture.threadRows, fixture.messageRows),
        /could not be confirmed/,
      );
      const foreign = structuredClone(fixture.messageRows);
      foreign[0].tenant_id = randomUUID();
      await assert.rejects(
        current.store.savePage(fixture.threadRows, foreign),
        /could not be confirmed/,
      );
      const invalid = structuredClone(fixture.messageRows);
      invalid[0].direction = null;
      await assert.rejects(
        current.store.savePage(fixture.threadRows, invalid),
        /could not be confirmed/,
      );
      sql(`update email_accounts set status='disabled' where id=${q(job.accountId)}`);
      await assert.rejects(
        current.store.savePage(fixture.threadRows, fixture.messageRows),
        /could not be confirmed/,
      );
      sql(`update email_accounts set status='active_dwd' where id=${q(job.accountId)}`);
      assert.equal(
        sql("select count(*) from email_messages where provider_message_id='refused'"),
        "0",
      );
    },
  );
  await t.test(
    "explicit refetch retains message IDs and cannot replace a newer history version with an older one",
    async () => {
      const forced = await owned(true),
        newer = rows(
          forced.scope,
          "m-refetch",
          "1700000000000",
          "first@example.invalid",
          "Fresh",
          "200",
        );
      await forced.store.savePage(newer.threadRows, newer.messageRows);
      const id = sql("select id from email_messages where provider_message_id='m-refetch'");
      const older = rows(
        forced.scope,
        "m-refetch",
        "1600000000000",
        "old@example.invalid",
        "Stale",
        "100",
      );
      assert.equal(
        (await forced.store.savePage(older.threadRows, older.messageRows)).message_upsert_count,
        0,
      );
      assert.equal(
        sql("select body_text from email_messages where provider_message_id='m-refetch'"),
        "Fresh",
      );
      const fresh = rows(
        forced.scope,
        "m-refetch",
        "1800000000000",
        "first@example.invalid",
        "Refreshed",
        "300",
      );
      assert.equal(
        (await forced.store.savePage(fresh.threadRows, fresh.messageRows)).message_upsert_count,
        1,
      );
      assert.equal(
        sql("select body_text from email_messages where provider_message_id='m-refetch'"),
        "Refreshed",
      );
      assert.equal(sql("select id from email_messages where provider_message_id='m-refetch'"), id);
    },
  );
  await t.test(
    "a lost page-write response remains uncertain; retry retains the committed message",
    async () => {
      const { scope, checkpoint, job } = current;
      const lost = createGmailPageStore(
        {
          rpc: async (...args) => {
            const r = await db.rpc(...args);
            if (args[0] === "learn_email_store_page") throw Error("PRIVATE_REPLY_LOST");
            return r;
          },
        },
        scope,
        checkpoint,
        mailbox,
        "missing_only",
        job,
      );
      let fetches = 0;
      const fetcher = async () => {
        fetches++;
        return Response.json({
          id: "lost-message",
          threadId: "thread-lost",
          internalDate: "1700000000000",
          payload: { mimeType: "text/plain", body: { data: btoa("Synthetic") } },
        });
      };
      const options = {
        tenantId: scope.tenantId,
        mailbox,
        accessToken: "synthetic",
        page: { ids: ["lost-message"], nextPageToken: null, exhausted: true },
        fetchPolicy: "missing_only",
        fetcher,
      };
      await assert.rejects(
        persistGmailCapturePage({ ...options, store: lost }),
        (e) =>
          e instanceof GmailCaptureError && e.persistenceUnknown && !e.message.includes("PRIVATE"),
      );
      const id = sql("select id from email_messages where provider_message_id='lost-message'");
      assert.ok(id);
      const result = await persistGmailCapturePage({ ...options, store: current.store });
      assert.equal(result.message_upsert_count, 0);
      assert.equal(fetches, 1);
      assert.equal(
        sql("select id from email_messages where provider_message_id='lost-message'"),
        id,
      );
    },
  );
  await t.test(
    "lease expiry during a page transaction rolls back messages and threads",
    async () => {
      const ownedPage = await owned(),
        fixture = rows(ownedPage.scope, "expire-message");
      fixture.messageRows[0].provider_thread_id = "expire-thread";
      fixture.threadRows[0].provider_thread_id = "expire-thread";
      sql(
        `create sequence page_delay_observed;grant usage on sequence page_delay_observed to service_role;create function test_page_delay() returns trigger language plpgsql as $$begin if new.provider_message_id='expire-message' then perform nextval('public.page_delay_observed');perform pg_sleep(1.2);end if;return new;end$$;create trigger test_page_delay before insert on email_messages for each row execute function test_page_delay();update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=${q(ownedPage.job.jobId)};`,
      );
      await assert.rejects(
        ownedPage.store.savePage(fixture.threadRows, fixture.messageRows),
        /could not be confirmed/,
      );
      assert.equal(sql("select is_called from page_delay_observed"), "t");
      assert.equal(
        sql("select count(*) from email_messages where provider_message_id='expire-message'"),
        "0",
      );
      assert.equal(
        sql("select count(*) from email_threads where provider_thread_id='expire-thread'"),
        "0",
      );
      sql("drop trigger test_page_delay on email_messages");
    },
  );
}
