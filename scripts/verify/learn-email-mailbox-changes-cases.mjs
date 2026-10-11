/** Real worker engine, page persistence and receipt protocol in disposable SQL. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runEmailCaptureJob } from "../../supabase/functions/_shared/email_capture_engine.ts";

export async function verifyEmailMailboxChanges({ t, sql, db, queueJob, q }) {
  // The older protocol snapshot omits the unrelated tenant catalog; supply only
  // its foreign-key target, while all capture/storage functions below are real.
  sql(
    "insert into tenants(id,status) select distinct tenant_id,'active' from email_accounts on conflict do nothing;",
  );
  const candidate = readFileSync(
    "supabase/migrations/20261101400000_learn_email_mailbox_changes.sql",
    "utf8",
  );
  const before = sql(
    "select md5(string_agg(row_to_json(m)::text,',' order by id)) from email_messages m",
  );
  sql(candidate.replace(/\ncommit;\s*$/, "\nrollback;"));
  assert.equal(sql("select to_regclass('learn_email_source_versions') is null"), "t");
  sql(candidate);
  assert.equal(
    sql("select md5(string_agg(row_to_json(m)::text,',' order by id)) from email_messages m"),
    before,
  );
  const j = queueJob();
  sql(
    `update email_accounts set email_address=${q(j.accountId + "@example.invalid")} where id=${q(j.accountId)}`,
  );
  const messageId = "changing-" + j.accountId;
  const read = () =>
    JSON.parse(
      sql(`select row_to_json(m) from email_messages m where provider_message_id=${q(messageId)}`),
    );
  const cursor = () =>
    sql(`select coalesce(history_id,'NULL') from email_accounts where id=${q(j.accountId)}`);
  const versions = () =>
    JSON.parse(
      sql(
        `select coalesce(jsonb_agg(source_row order by captured_at),'[]') from learn_email_source_versions where email_message_id=${q(read().id)}`,
      ),
    );
  function round() {
    const r = JSON.parse(
      sql(
        `set role service_role;select learn_email_enqueue(${q(j.tenantId)},${q(j.accountId)},'email.workspace_sync','{}')`,
      ),
    );
    sql(
      `update platform_jobs set status='running',claimed_by='changes-worker',attempt_count=1,lease_expires_at=clock_timestamp()+interval '1 hour' where id=${q(r.job_id)}`,
    );
    return { ...j, jobId: r.job_id, claimedBy: "changes-worker", attemptCount: 1 };
  }
  function ports(
    boundary,
    changes,
    { labels = ["INBOX"], text = "Original captured body", status = 200, history = boundary } = {},
  ) {
    return {
      admission: async () => ({ allowed: true }),
      accessToken: async () => "synthetic",
      mailbox: async () => ({
        tenantId: j.tenantId,
        accountId: j.accountId,
        mailbox: j.accountId + "@example.invalid",
        historical: null,
      }),
      fetcher: async (url) => {
        const u = new URL(url);
        if (u.pathname.endsWith("/profile"))
          return Response.json({
            emailAddress: j.accountId + "@example.invalid",
            historyId: boundary,
          });
        if (u.pathname.endsWith("/messages")) {
          assert.equal(u.searchParams.get("includeSpamTrash"), "true");
          return Response.json({ messages: [{ id: messageId }] });
        }
        if (u.pathname.endsWith("/history")) {
          assert.equal(u.searchParams.has("historyTypes"), false);
          return Response.json({ historyId: boundary, history: changes });
        }
        if (status !== 200) return Response.json({}, { status });
        return Response.json({
          id: messageId,
          threadId: "thread-" + messageId,
          internalDate: "1700000000000",
          historyId: history,
          labelIds: labels,
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "customer@example.invalid" },
              { name: "To", value: j.accountId + "@example.invalid" },
              { name: "Subject", value: "Mutable synthetic source" },
            ],
            body: { data: btoa(text) },
          },
        });
      },
    };
  }
  const labelChange = (id, label = "TRASH") => [
    { id, labelsAdded: [{ message: { id: messageId }, labelIds: [label] }] },
  ];
  await t.test(
    "v4 initial reconciliation stores full source without rewriting pre-existing records at install",
    async () => {
      const result = await runEmailCaptureJob(db, j, ports("100", []));
      assert.equal(result.coverageComplete, true);
      assert.equal(cursor(), "100");
      assert.equal(read().body_text, "Original captured body");
      assert.equal(read().raw_payload.provider_availability, "available");
      assert.equal(versions().length, 0);
    },
  );
  await t.test(
    "v4 label-only history refreshes an existing message and retains original body and labels",
    async () => {
      const result = await runEmailCaptureJob(
        db,
        round(),
        ports("200", labelChange("150"), { labels: ["TRASH"], text: "Updated captured body" }),
      );
      assert.equal(result.coverageComplete, true);
      assert.equal(cursor(), "200");
      assert.deepEqual(read().raw_payload.label_ids, ["TRASH"]);
      assert.equal(read().body_text, "Updated captured body");
      assert.equal(versions().length, 1);
      assert.equal(versions()[0].body_text, "Original captured body");
      assert.deepEqual(versions()[0].raw_payload.label_ids, ["INBOX"]);
    },
  );
  await t.test(
    "provider deletion preserves the source row, relationships and previous version",
    async () => {
      const id = read().id;
      const result = await runEmailCaptureJob(
        db,
        round(),
        ports("300", [{ id: "250", messagesDeleted: [{ message: { id: messageId } }] }], {
          status: 404,
        }),
      );
      assert.equal(result.coverageComplete, true);
      assert.equal(cursor(), "300");
      assert.equal(read().id, id);
      assert.equal(read().body_text, "Updated captured body");
      assert.equal(read().raw_payload.provider_availability, "unavailable");
      assert.equal(versions().length, 2);
    },
  );
  await t.test(
    "an older fetched history cannot overwrite a newer absence observation",
    async () => {
      const retained = JSON.stringify(read());
      await runEmailCaptureJob(
        db,
        round(),
        ports("400", labelChange("350"), { history: "200", labels: ["INBOX"], text: "stale body" }),
      );
      assert.equal(JSON.stringify(read()), retained);
      assert.equal(versions().length, 2);
    },
  );
  await t.test(
    "newer available state recovers without duplicating the source or discarding versions",
    async () => {
      const result = await runEmailCaptureJob(
        db,
        round(),
        ports("500", labelChange("450", "SENT"), { labels: ["SENT"], text: "Restored source" }),
      );
      assert.equal(result.coverageComplete, true);
      assert.equal(read().raw_payload.provider_availability, "available");
      assert.equal(read().body_text, "Restored source");
      assert.equal(versions().length, 3);
      assert.equal(versions()[2].raw_payload.provider_availability, "unavailable");
    },
  );
  await t.test(
    "archive is inaccessible to client roles and cannot be altered by the capture role",
    async () => {
      for (const role of ["anon", "authenticated", "service_role"])
        assert.throws(() => sql(`set role ${role};select * from learn_email_source_versions`));
      assert.throws(() =>
        sql(`set role authenticated;select learn_email_store_unavailable('{}','[]')`),
      );
      assert.throws(() => sql(`set role service_role;delete from learn_email_source_versions`));
    },
  );
  await t.test(
    "another mailbox cannot overwrite a bound source with a coincident provider ID",
    async () => {
      const other = queueJob();
      const address = other.accountId + "@example.invalid";
      sql(`update email_accounts set email_address=${q(address)} where id=${q(other.accountId)}`);
      const retained = JSON.stringify(read()),
        archived = versions().length;
      const p = ports("550", [], { text: "Foreign mailbox body" });
      const fetcher = p.fetcher;
      p.mailbox = async () => ({
        tenantId: other.tenantId,
        accountId: other.accountId,
        mailbox: address,
        historical: null,
      });
      p.fetcher = async (url) =>
        new URL(url).pathname.endsWith("/profile")
          ? Response.json({ emailAddress: address, historyId: "550" })
          : fetcher(url);
      const result = await runEmailCaptureJob(db, other, p);
      assert.equal(result.state, "failed");
      assert.equal(result.code, "persistence_failed");
      assert.equal(JSON.stringify(read()), retained);
      assert.equal(versions().length, archived);
      assert.equal(
        sql(`select history_id is null from email_accounts where id=${q(other.accountId)}`),
        "t",
      );
    },
  );
  await t.test(
    "unknown absence acknowledgement keeps the old cursor and retains the committed prior version",
    async () => {
      const current = round();
      let dropped = false;
      const lost = {
        rpc: async (name, args) => {
          const result = await db.rpc(name, args);
          if (name === "learn_email_store_unavailable" && !dropped) {
            dropped = true;
            throw Error("synthetic response loss");
          }
          return result;
        },
      };
      const result = await runEmailCaptureJob(
        lost,
        current,
        ports("600", [{ id: "550", messagesDeleted: [{ message: { id: messageId } }] }], {
          status: 410,
        }),
      );
      assert.equal(dropped, true);
      assert.equal(result.state, "failed");
      assert.equal(cursor(), "500");
      assert.equal(read().raw_payload.provider_availability, "unavailable");
      assert.equal(versions().length, 4);
    },
  );
}
