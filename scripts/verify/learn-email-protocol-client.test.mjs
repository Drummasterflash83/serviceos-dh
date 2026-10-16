/** Actual hosted v2 function definitions in disposable Postgres; no provider or
 * hosted database access. Unrelated launch-reader policy dependencies are omitted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  applyEmailTransition,
  prepareEmailTransition,
  readEmailTransition,
  EmailTransitionUnconfirmed,
} from "../../supabase/functions/_shared/email_ingestion_protocol.ts";
import {
  applyDurableEmailTransition,
  pendingEmailTransition,
} from "../../supabase/functions/_shared/email_ingestion_outbox.ts";
import { bindEmailJobAttempt } from "../../supabase/functions/_shared/email_job_attempt.ts";
import { verifyEmailPageStore } from "./learn-email-page-store-cases.mjs";
import { verifyEmailCaptureEngine } from "./learn-email-capture-engine-cases.mjs";
import { verifyEmailPausedRecovery } from "./learn-email-paused-recovery-cases.mjs";
import { verifyEmailEnqueue } from "./learn-email-enqueue-cases.mjs";
import { verifyEmailMailboxCoverage } from "./learn-email-mailbox-coverage-cases.mjs";
import { verifyEmailMailboxChanges } from "./learn-email-mailbox-changes-cases.mjs";
const docker = "/usr/local/bin/docker",
  name = "learn-email-protocol-" + randomUUID().slice(0, 8);
const source = readFileSync(
  new URL("../../supabase/reference/learn-email-ingestion-test-2026-10-10.json", import.meta.url),
);
assert.equal(
  createHash("sha256").update(source).digest("hex"),
  "8070cf839267c323b60a677b94e5a92cb553b43edaa59d16dcb0fb3b8ee8d062",
);
const reference = JSON.parse(source),
  q = (v) => (v === null ? "null" : "'" + String(v).replaceAll("'", "''") + "'"),
  i = (v) => '"' + v.replaceAll('"', '""') + '"';
function sql(s) {
  return execFileSync(
    docker,
    [
      "exec",
      "-i",
      name,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-XAtq",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: s, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 20000 },
  ).trim();
}
async function sqlAsync(s) {
  const { stdout } = await promisify(execFile)(
    docker,
    [
      "exec",
      "-i",
      name,
      "psql",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
      "-XAtq",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      s,
    ],
    { encoding: "utf8", timeout: 20000 },
  );
  return stdout.trim();
}
const db = {
  async rpc(fn, args) {
    assert.ok(
      [
        "email_ingestion_transition_v2",
        "email_ingestion_transition_result_v2",
        "learn_email_transition_prepare",
        "learn_email_transition_pending",
        "learn_email_transition_apply",
        "learn_email_job_attempt",
        "learn_email_store_existing",
        "learn_email_store_page",
        "learn_email_store_unavailable",
        "platform_jobs_complete_email_v1",
        "learn_email_job_fail",
      ].includes(fn),
    );
    return {
      data: JSON.parse(
        sql(
          "set role service_role;select public." +
            fn +
            "(" +
            Object.entries(args)
              .map(
                ([k, v]) =>
                  k +
                  "=>" +
                  ([
                    "p_payload",
                    "p_document",
                    "p_context",
                    "p_ids",
                    "p_threads",
                    "p_messages",
                  ].includes(k)
                    ? q(JSON.stringify(v)) + "::jsonb"
                    : q(v)),
              )
              .join(",") +
            ");",
        ) || "null",
      ),
      error: null,
    };
  },
};
const tenant = randomUUID(),
  account = randomUUID(),
  scopeFor = (attemptId, stream = "recent") => ({
    tenantId: tenant,
    accountId: account,
    attemptId,
    stream,
  });
const evidence = {
  persistence: "confirmed",
  message_upsert_count: 0,
  thread_upsert_count: 0,
  ids_seen: 0,
  gone_count: 0,
  unresolved_count: 0,
};
const count = () => sql("select count(*) from email_ingestion_transitions");
function attempt(stream = "recent") {
  const id = randomUUID();
  sql(
    `insert into email_sync_runs(id,tenant_id,provider,sync_type,status,metadata) values(${q(id)},${q(tenant)},'gmail',${q(stream === "recent" ? "workspace_messages" : "workspace_backfill")},'running',${q(JSON.stringify({ email_account_id: account }))}::jsonb)`,
  );
  return scopeFor(id, stream);
}
test("email client preserves the existing hosted progress protocol", async (t) => {
  let created = false;
  const dir = mkdtempSync(join(tmpdir(), "learn-email-protocol-"));
  async function retain(r) {
    const file = join(dir, r.transitionId + ".json");
    if (!existsSync(file)) {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, JSON.stringify(r));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    }
    return JSON.parse(readFileSync(file));
  }
  try {
    execFileSync(
      docker,
      [
        "run",
        "-d",
        "--pull=never",
        "--network",
        "none",
        "--name",
        name,
        "-e",
        "POSTGRES_HOST_AUTH_METHOD=trust",
        "postgres:15",
      ],
      { stdio: "pipe", timeout: 30000 },
    );
    created = true;
    for (let n = 0; n < 60; n++) {
      try {
        sql("select 1");
        break;
      } catch {
        if (n === 59) throw Error("Disposable postgres unavailable");
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    const setup = [
      "create role service_role nologin bypassrls;create role email_ingestion_protocol_owner nologin;grant usage on schema public to service_role,email_ingestion_protocol_owner;",
    ];
    for (const table of reference.tables)
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
    for (const table of reference.tables)
      for (const c of table.constraints.filter((c) => c.kind !== "f"))
        setup.push(
          "alter table " +
            i(table.name) +
            " add constraint " +
            i(c.name) +
            " " +
            c.definition +
            ";",
        );
    for (const table of reference.tables)
      for (const idx of table.indexes.filter(
        (x) =>
          !table.constraints.some((c) => ["p", "u", "x"].includes(c.kind) && c.name === x.name),
      ))
        setup.push(idx.definition + ";");
    for (const table of reference.tables)
      for (const c of table.constraints.filter((c) => c.kind === "f"))
        setup.push(
          "alter table " +
            i(table.name) +
            " add constraint " +
            i(c.name) +
            " " +
            c.definition +
            ";",
        );
    setup.push("set check_function_bodies=off;");
    for (const f of reference.functions.filter((f) => f.name.startsWith("email_ingestion_"))) {
      const sig = "public." + i(f.name) + "(" + f.arguments + ")";
      setup.push(
        f.definition +
          ";alter function " +
          sig +
          " owner to " +
          i(f.owner) +
          ";revoke all on function " +
          sig +
          " from public;",
      );
      for (const g of f.grants)
        setup.push("grant " + g.privilege + " on function " + sig + " to " + i(g.role) + ";");
    }
    setup.push("reset check_function_bodies;");
    for (const table of reference.tables) {
      setup.push("alter table " + i(table.name) + " enable row level security;");
      for (const p of table.policies.filter((p) =>
        p.roles.includes("email_ingestion_protocol_owner"),
      ))
        setup.push(
          "create policy " +
            i(p.name) +
            " on " +
            i(table.name) +
            " for " +
            p.command +
            " to email_ingestion_protocol_owner" +
            (p.using ? " using(" + p.using + ")" : "") +
            (p.check ? " with check(" + p.check + ")" : "") +
            ";",
        );
      for (const tr of table.triggers.filter((tr) => tr.function.startsWith("email_ingestion_")))
        setup.push(tr.definition + ";");
    }
    for (const g of reference.protocolGrants)
      setup.push(
        "grant " +
          g.privilege +
          (g.column ? "(" + i(g.column) + ")" : "") +
          " on " +
          i(g.table) +
          " to email_ingestion_protocol_owner;",
      );
    setup.push(
      "grant select,insert,update,delete on email_accounts,email_sync_runs to service_role;",
    );
    setup.push(
      `insert into email_accounts(id,tenant_id,provider,status) values(${q(account)},${q(tenant)},'gmail','active_dwd');`,
    );
    sql(setup.join("\n"));
    let s = attempt(),
      claim = prepareEmailTransition(s, null, randomUUID(), "claim", { recovery: null }),
      claimed;
    await t.test(
      "retention fails before dispatch; saved requests cannot change under the same identity",
      async () => {
        const before = count();
        let calls = 0;
        const port = {
          rpc: async () => {
            calls++;
            throw Error("unexpected");
          },
        };
        await assert.rejects(
          applyEmailTransition(port, claim, async () => {
            throw Error("disk full");
          }),
          /disk full/,
        );
        await assert.rejects(
          applyEmailTransition(port, claim, async (r) => ({
            ...r,
            payload: { recovery: null, force: true },
          })),
          /not retained exactly/,
        );
        assert.equal(calls, 0);
        assert.equal(count(), before);
      },
    );
    await t.test(
      "lost claim response is recovered from a durable request and one receipt",
      async () => {
        let calls = 0;
        const lost = {
          rpc: async (...a) => {
            calls++;
            await db.rpc(...a);
            throw Error("PRIVATE_TRANSPORT");
          },
        };
        await assert.rejects(applyEmailTransition(lost, claim, retain), EmailTransitionUnconfirmed);
        assert.equal(calls, 1);
        assert.equal(count(), "1");
        const saved = JSON.parse(readFileSync(join(dir, claim.transitionId + ".json")));
        claimed = await readEmailTransition(db, s, saved.transitionId, "claim");
        assert.equal(claimed.disposition, "replayed");
        assert.equal(claimed.currentMatchesReceipt, true);
        assert.equal(claimed.accepted.attempt_status, "running");
        const replay = await applyEmailTransition(db, saved, retain);
        assert.equal(replay.disposition, "replayed");
        assert.equal(count(), "1");
      },
    );
    let current;
    await t.test(
      "all label pages must complete before advancing the original mailbox cursor",
      async () => {
        const init = prepareEmailTransition(
          s,
          claimed.checkpoint,
          randomUUID(),
          "initialize_traversal",
          {
            captured_history_id: "18446744073709551614",
            captured_at: new Date().toISOString(),
            page_size: 25,
            query: null,
          },
        );
        current = await applyEmailTransition(db, init, retain);
        assert.equal(current.disposition, "applied");
        for (const [label, input, next] of [
          ["INBOX", null, "page2"],
          ["INBOX", "page2", null],
          ["SENT", null, null],
        ]) {
          const r = prepareEmailTransition(s, current.checkpoint, randomUUID(), "checkpoint", {
            label,
            expected_input_page_token: input,
            returned_next_page_token: next,
            exhausted: next === null,
            yield_after_page: false,
            page_evidence: evidence,
          });
          current = await applyEmailTransition(db, r, retain);
          assert.equal(current.disposition, "applied");
          const cursor = sql(
            `select coalesce(history_id,'NULL') from email_accounts where id=${q(account)}`,
          );
          assert.equal(cursor, label === "SENT" ? "18446744073709551614" : "NULL");
        }
        assert.equal(current.accepted.coverage_complete, true);
        assert.equal(current.accepted.attempt_status, "success");
      },
    );
    await t.test(
      "old receipts remain historical after a later attempt owns a new generation",
      async () => {
        const newer = attempt(),
          probe = await readEmailTransition(db, newer, randomUUID());
        assert.equal(probe.code, "not_found");
        const next = await applyEmailTransition(
          db,
          prepareEmailTransition(newer, probe.checkpoint, randomUUID(), "claim", {
            recovery: null,
          }),
          retain,
        );
        assert.equal(next.disposition, "applied");
        assert.notEqual(next.checkpoint.generation, current.checkpoint.generation);
        const before = count(),
          old = await readEmailTransition(db, s, claim.transitionId, "claim");
        assert.equal(old.disposition, "replayed");
        assert.equal(old.currentMatchesReceipt, false);
        assert.equal(old.checkpoint.owner_attempt_id, newer.attemptId);
        await applyEmailTransition(db, claim, retain);
        assert.equal(count(), before);
        const stale = await applyEmailTransition(
          db,
          prepareEmailTransition(newer, current.checkpoint, randomUUID(), "claim", {
            recovery: null,
          }),
          retain,
        );
        assert.equal(stale.code, "checkpoint_conflict");
        assert.equal(count(), before);
        s = newer;
        current = next;
      },
    );
    await t.test(
      "reused IDs and unresolved pages cannot overwrite or advance progress",
      async () => {
        const before = count();
        const reused = await applyEmailTransition(
          db,
          { ...claim, payload: { recovery: null, force: true } },
          async (r) => r,
        );
        assert.equal(reused.code, "transition_id_reused");
        const bad = await applyEmailTransition(
          db,
          prepareEmailTransition(s, current.checkpoint, randomUUID(), "checkpoint", {
            label: "INBOX",
            expected_input_page_token: null,
            returned_next_page_token: null,
            exhausted: true,
            yield_after_page: true,
            page_evidence: { ...evidence, unresolved_count: 1 },
          }),
          retain,
        );
        assert.equal(bad.disposition, "denied");
        assert.equal(count(), before);
      },
    );
    await t.test(
      "historical page yield saves its own continuation without claiming full coverage",
      async () => {
        const h = attempt("historical"),
          c = await applyEmailTransition(
            db,
            prepareEmailTransition(h, null, randomUUID(), "claim", { recovery: null }),
            retain,
          );
        const page = await applyEmailTransition(
          db,
          prepareEmailTransition(h, c.checkpoint, randomUUID(), "checkpoint", {
            expected_page_token: null,
            expected_total: 0,
            listed_count: 2,
            returned_next_page_token: "historical2",
            exhausted: false,
            yield_after_page: true,
            page_evidence: { ...evidence, ids_seen: 2 },
          }),
          retain,
        );
        assert.equal(page.accepted.attempt_status, "success");
        assert.equal(page.accepted.coverage_complete, false);
        assert.equal(page.checkpoint.state, "ready");
        assert.equal(
          sql(
            `select backfill_page_token||':'||backfill_total_fetched from email_accounts where id=${q(account)}`,
          ),
          "historical2:2",
        );
        assert.equal(
          sql(`select history_id from email_accounts where id=${q(account)}`),
          "18446744073709551614",
        );
      },
    );
    await t.test(
      "large revisions remain exact strings; retention accepts JSONB key ordering",
      async () => {
        sql(
          `update email_ingestion_checkpoints set revision=9007199254740992 where tenant_id=${q(tenant)} and email_account_id=${q(account)} and stream='recent'`,
        );
        const probe = await readEmailTransition(db, s, randomUUID());
        const r = prepareEmailTransition(s, probe.checkpoint, randomUUID(), "release", {
          reason_code: "requested_yield",
          attempt_evidence: { ...evidence, coverage_complete: false },
        });
        assert.equal(r.expectedRevision, "9007199254740992");
        const result = await applyEmailTransition(db, r, async (r) =>
          Object.fromEntries(Object.entries(await retain(r)).reverse()),
        );
        assert.equal(result.accepted.revision, "9007199254740993");
        assert.equal(result.accepted.coverage_complete, false);
      },
    );
    await t.test(
      "absent receipts retain the same request and malformed envelopes remain unconfirmed",
      async () => {
        const before = count(),
          r = prepareEmailTransition(s, current.checkpoint, randomUUID(), "claim", {
            recovery: null,
          });
        let sent = 0;
        await assert.rejects(
          applyEmailTransition(
            {
              rpc: async () => {
                sent++;
                throw Error("PRIVATE_FAILURE");
              },
            },
            r,
            retain,
          ),
          EmailTransitionUnconfirmed,
        );
        assert.equal(sent, 1);
        assert.equal(count(), before);
        const missing = await readEmailTransition(db, s, r.transitionId);
        assert.equal(missing.code, "not_found");
        assert.equal(missing.accepted, null);
        assert.ok(existsSync(join(dir, r.transitionId + ".json")));
        const raw = (
          await db.rpc("email_ingestion_transition_result_v2", {
            p_tenant_id: claim.tenantId,
            p_email_account_id: claim.accountId,
            p_stream: claim.stream,
            p_attempt_id: claim.attemptId,
            p_transition_id: claim.transitionId,
          })
        ).data;
        for (const mutate of [
          (x) => {
            x.accepted_result.tenant_id = randomUUID();
          },
          (x) => {
            x.accepted_result.revision = 42;
          },
          (x) => {
            x.accepted_result.coverage_complete = true;
          },
          (x) => {
            x.current_checkpoint.email_account_id = randomUUID();
          },
          (x) => {
            x.transition_id = randomUUID();
          },
          (x) => {
            x.code = "PRIVATE_DIAGNOSTIC";
          },
        ]) {
          const data = structuredClone(raw);
          mutate(data);
          await assert.rejects(
            readEmailTransition(
              { rpc: async () => ({ data, error: null }) },
              claim,
              claim.transitionId,
            ),
            (e) => e instanceof EmailTransitionUnconfirmed && !e.message.includes("PRIVATE"),
          );
        }
      },
    );
    await t.test("protocol guards and tenant/attempt boundaries remain effective", async () => {
      assert.throws(() =>
        sql(
          `set role service_role;update email_accounts set history_id='1' where id=${q(account)}`,
        ),
      );
      assert.throws(() =>
        sql(
          `set role service_role;update email_sync_runs set status='success' where id=${q(s.attemptId)}`,
        ),
      );
      await assert.rejects(
        readEmailTransition(db, { ...s, tenantId: randomUUID() }, claim.transitionId),
        EmailTransitionUnconfirmed,
      );
      assert.equal(
        sql(`select history_id from email_accounts where id=${q(account)}`),
        "18446744073709551614",
      );
    });
    const outboxMigration = readFileSync(
      new URL(
        "../../supabase/migrations/20261031233000_learn_email_transition_outbox.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await t.test("outbox migration rolls back without changing the existing protocol", async () => {
      sql("create role anon nologin;create role authenticated nologin;");
      const before = count();
      sql(outboxMigration.replace("\ncommit;", "\nrollback;"));
      assert.equal(
        sql("select to_regclass('public.learn_email_transition_requests') is null"),
        "t",
      );
      assert.equal(count(), before);
      sql(outboxMigration);
    });
    let outScope = attempt(),
      outRequest,
      outResult;
    await t.test(
      "a lost prepare response recovers the same durable request without applying it",
      async () => {
        const probe = await readEmailTransition(db, outScope, randomUUID());
        outRequest = prepareEmailTransition(outScope, probe.checkpoint, randomUUID(), "claim", {
          recovery: null,
        });
        const before = count(),
          calls = [];
        const lost = {
          rpc: async (fn, args) => {
            calls.push(fn);
            const result = await db.rpc(fn, args);
            if (fn === "learn_email_transition_prepare") throw Error("PRIVATE_LOST_PREPARE");
            return result;
          },
        };
        await assert.rejects(
          applyDurableEmailTransition(lost, outRequest),
          EmailTransitionUnconfirmed,
        );
        assert.deepEqual(calls, ["learn_email_transition_prepare"]);
        assert.equal(count(), before);
        assert.deepEqual(await pendingEmailTransition(db, outScope), outRequest);
        await assert.rejects(
          applyDurableEmailTransition(db, { ...outRequest, transitionId: randomUUID() }),
          EmailTransitionUnconfirmed,
        );
        await assert.rejects(
          applyDurableEmailTransition(db, {
            ...outRequest,
            payload: { recovery: null, force: true },
          }),
          EmailTransitionUnconfirmed,
        );
        assert.equal(count(), before);
      },
    );
    await t.test(
      "lost apply acknowledgement retains one atomic settlement and replays once",
      async () => {
        const before = Number(count()),
          request = await pendingEmailTransition(db, outScope);
        const lost = {
          rpc: async (fn, args) => {
            const result = await db.rpc(fn, args);
            if (fn === "learn_email_transition_apply") throw Error("PRIVATE_LOST_APPLY");
            return result;
          },
        };
        await assert.rejects(
          applyDurableEmailTransition(lost, request),
          EmailTransitionUnconfirmed,
        );
        assert.equal(Number(count()), before + 1);
        assert.equal(await pendingEmailTransition(db, outScope), null);
        outResult = await applyDurableEmailTransition(db, request);
        assert.equal(outResult.disposition, "replayed");
        assert.equal(outResult.currentMatchesReceipt, true);
        assert.equal(Number(count()), before + 1);
        assert.equal(sql("select count(*) from learn_email_transition_settlements"), "1");
      },
    );
    await t.test(
      "settlement failure rolls back progress and leaves the original request pending",
      async () => {
        const r = prepareEmailTransition(outScope, outResult.checkpoint, randomUUID(), "release", {
          reason_code: "requested_yield",
          attempt_evidence: { ...evidence, coverage_complete: false },
        });
        sql(
          `alter table learn_email_transition_settlements add constraint reject_receipt check(request_id<>${q(r.transitionId)}::uuid)`,
        );
        const before = count();
        await assert.rejects(applyDurableEmailTransition(db, r), EmailTransitionUnconfirmed);
        assert.equal(count(), before);
        assert.deepEqual(await pendingEmailTransition(db, outScope), r);
        assert.equal(
          sql(`select status from email_sync_runs where id=${q(outScope.attemptId)}`),
          "running",
        );
        sql("alter table learn_email_transition_settlements drop constraint reject_receipt");
        const release = await applyDurableEmailTransition(
          db,
          await pendingEmailTransition(db, outScope),
        );
        assert.equal(release.accepted.attempt_status, "success");
        assert.equal(Number(count()), Number(before) + 1);
      },
    );
    await t.test(
      "successful replay reads current ownership; a refused request remains refused",
      async () => {
        const fresh = attempt(),
          probe = await readEmailTransition(db, fresh, randomUUID());
        const r = prepareEmailTransition(fresh, probe.checkpoint, randomUUID(), "claim", {
          recovery: null,
        });
        sql(`update email_accounts set status='disabled' where id=${q(account)}`);
        const denied = await applyDurableEmailTransition(db, r);
        assert.equal(denied.code, "source_ineligible");
        sql(`update email_accounts set status='active_dwd' where id=${q(account)}`);
        const before = count(),
          retry = await applyDurableEmailTransition(db, r);
        assert.equal(retry.code, "source_ineligible");
        assert.equal(count(), before);
        const applied = await applyDurableEmailTransition(db, { ...r, transitionId: randomUUID() });
        assert.equal(applied.disposition, "applied");
        const old = await applyDurableEmailTransition(db, outRequest);
        assert.equal(old.disposition, "replayed");
        assert.equal(old.currentMatchesReceipt, false);
        assert.equal(old.checkpoint.owner_attempt_id, fresh.attemptId);
      },
    );
    await t.test(
      "outbox history is immutable and unavailable to client roles or a foreign scope",
      async () => {
        for (const table of [
          "learn_email_transition_requests",
          "learn_email_transition_settlements",
        ]) {
          assert.throws(() => sql(`set role authenticated;select * from ${table}`));
          assert.throws(() => sql(`delete from ${table}`));
        }
        assert.throws(() =>
          sql(
            `update learn_email_transition_requests set document='{}'::jsonb where id=${q(outRequest.transitionId)}`,
          ),
        );
        assert.equal(
          await pendingEmailTransition(db, { ...outScope, tenantId: randomUUID() }),
          null,
        );
        await assert.rejects(
          db.rpc("learn_email_transition_apply", {
            p_tenant: randomUUID(),
            p_account: account,
            p_stream: "recent",
            p_attempt: outScope.attemptId,
            p_request: outRequest.transitionId,
          }),
        );
        assert.equal(
          sql(
            "select has_function_privilege('authenticated','learn_email_transition_prepare(jsonb)','EXECUTE')",
          ),
          "f",
        );
      },
    );
    await t.test(
      "two simultaneous preparations retain only one unresolved request per attempt",
      async () => {
        const concurrent = attempt(),
          probe = await readEmailTransition(db, concurrent, randomUUID());
        const candidates = [0, 1].map(() =>
          prepareEmailTransition(concurrent, probe.checkpoint, randomUUID(), "claim", {
            recovery: null,
          }),
        );
        const results = await Promise.allSettled(
          candidates.map((r) =>
            promisify(execFile)(
              docker,
              [
                "exec",
                name,
                "psql",
                "-h",
                "127.0.0.1",
                "-U",
                "postgres",
                "-XAtq",
                "-v",
                "ON_ERROR_STOP=1",
                "-c",
                `set role service_role;select learn_email_transition_prepare(${q(JSON.stringify(r))}::jsonb);`,
              ],
              { encoding: "utf8", timeout: 20000 },
            ),
          ),
        );
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const pending = await pendingEmailTransition(db, concurrent);
        assert.ok(candidates.some((r) => r.transitionId === pending.transitionId));
        assert.equal(
          sql(
            `select count(*) from learn_email_transition_requests where attempt_id=${q(concurrent.attemptId)}`,
          ),
          "1",
        );
      },
    );
    const queueSource = readFileSync(
      new URL("../../supabase/reference/learn-email-job-test-2026-10-10.json", import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(queueSource).digest("hex"),
      "3891b55bf623886527a14ea8e7c402431567eeffd00975882ed93481e73f8716",
    );
    const qt = JSON.parse(queueSource).table;
    sql(
      "create table platform_jobs(" +
        qt.columns
          .map(
            (c) =>
              i(c.name) +
              " " +
              c.type +
              (c.default ? " default " + c.default : "") +
              (c.notNull ? " not null" : ""),
          )
          .join(",") +
        ");" +
        qt.constraints
          .map(
            (c) =>
              "alter table platform_jobs add constraint " + i(c.name) + " " + c.definition + ";",
          )
          .join("") +
        qt.indexes
          .filter((x) => !qt.constraints.some((c) => c.name === x.name))
          .map((x) => x.definition + ";")
          .join("") +
        "alter table platform_jobs enable row level security;grant select,insert,update on platform_jobs to service_role;",
    );
    const jobMigration = readFileSync(
      new URL(
        "../../supabase/migrations/20261031234500_learn_email_job_attempts.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await t.test(
      "job-binding migration rolls back API changes and installs lease-aware signatures",
      async () => {
        const before = count();
        sql(jobMigration.replace("\ncommit;", "\nrollback;"));
        assert.equal(
          sql("select to_regprocedure('learn_email_transition_prepare(jsonb)') is not null"),
          "t",
        );
        assert.equal(sql("select to_regclass('learn_email_job_attempts') is null"), "t");
        assert.equal(count(), before);
        sql(jobMigration);
        assert.equal(
          sql("select to_regprocedure('learn_email_transition_prepare(jsonb)') is null"),
          "t",
        );
        assert.equal(
          sql(
            "select has_function_privilege('authenticated','learn_email_job_attempt(uuid,uuid,text,integer)','EXECUTE')",
          ),
          "f",
        );
        const standalone = attempt();
        const prior = await readEmailTransition(db, standalone, randomUUID());
        const result = await applyDurableEmailTransition(
          db,
          prepareEmailTransition(standalone, prior.checkpoint, randomUUID(), "claim", {
            recovery: null,
          }),
        );
        assert.equal(result.code, "already_claimed");
      },
    );
    function queueJob() {
      const accountId = randomUUID(),
        jobId = randomUUID();
      sql(
        `insert into email_accounts(id,tenant_id,provider,status) values(${q(accountId)},${q(tenant)},'gmail','active_dwd');insert into platform_jobs(id,tenant_id,job_type,job_key,connector_id,module_id,payload,status,claimed_by,attempt_count,lease_expires_at) values(${q(jobId)},${q(tenant)},'email.workspace_sync',${q("email.workspace_sync:" + accountId)},'google-workspace','communications.email',${q(JSON.stringify({ email_account_id: accountId, max_results: 25 }))}::jsonb,'running','worker-old',1,clock_timestamp()+interval '1 hour');`,
      );
      return { accountId, tenantId: tenant, jobId, claimedBy: "worker-old", attemptCount: 1 };
    }
    const job = queueJob();
    let bound, jobRequest, jobResult;
    const replacement = { ...job, claimedBy: "worker-new", attemptCount: 2 };
    await t.test(
      "lost binding response recovers one run and one immutable job association",
      async () => {
        const before = Number(sql("select count(*) from email_sync_runs"));
        await assert.rejects(
          bindEmailJobAttempt(
            {
              rpc: async (...args) => {
                await db.rpc(...args);
                throw Error("PRIVATE_LOST_BIND");
              },
            },
            job,
          ),
          /could not be confirmed/,
        );
        bound = await bindEmailJobAttempt(db, job);
        assert.equal(bound.recovered, true);
        assert.equal(bound.accountId, job.accountId);
        assert.equal(bound.status, "running");
        assert.equal(Number(sql("select count(*) from email_sync_runs")), before + 1);
        assert.equal(sql("select count(*) from learn_email_job_attempts"), "1");
        jobRequest = prepareEmailTransition(bound, null, randomUUID(), "claim", { recovery: null });
        await db.rpc("learn_email_transition_prepare", {
          p_document: jobRequest,
          p_claimed_by: job.claimedBy,
          p_claim: job.attemptCount,
        });
      },
    );
    await t.test(
      "replacement workers recover the original pending request; stale leases cannot apply it",
      async () => {
        sql(
          `update platform_jobs set claimed_by='worker-new',attempt_count=2 where id=${q(job.jobId)}`,
        );
        const recovered = await bindEmailJobAttempt(db, replacement);
        assert.equal(recovered.attemptId, bound.attemptId);
        const pending = await pendingEmailTransition(db, recovered);
        assert.deepEqual(pending, jobRequest);
        const before = count();
        await assert.rejects(
          applyDurableEmailTransition(db, pending, job),
          EmailTransitionUnconfirmed,
        );
        await assert.rejects(applyDurableEmailTransition(db, pending), EmailTransitionUnconfirmed);
        assert.equal(count(), before);
        jobResult = await applyDurableEmailTransition(db, pending, replacement);
        assert.equal(jobResult.disposition, "applied");
        await assert.rejects(bindEmailJobAttempt(db, job), /could not be confirmed/);
      },
    );
    await t.test(
      "changed job definitions and foreign companies cannot reuse the binding",
      async () => {
        sql(
          `update platform_jobs set payload=jsonb_set(payload,'{max_results}','50') where id=${q(job.jobId)}`,
        );
        await assert.rejects(bindEmailJobAttempt(db, replacement), /could not be confirmed/);
        await assert.rejects(
          applyDurableEmailTransition(db, jobRequest, replacement),
          EmailTransitionUnconfirmed,
        );
        sql(
          `update platform_jobs set payload=jsonb_set(payload,'{max_results}','25') where id=${q(job.jobId)}`,
        );
        await assert.rejects(
          bindEmailJobAttempt(db, { ...replacement, tenantId: randomUUID() }),
          /could not be confirmed/,
        );
        assert.throws(() => sql("set role authenticated;select * from learn_email_job_attempts"));
        assert.throws(() => sql("delete from learn_email_job_attempts"));
      },
    );
    await t.test("binding failure rolls back its new sync attempt", async () => {
      const bad = queueJob(),
        before = sql("select count(*) from email_sync_runs");
      sql(
        `alter table learn_email_job_attempts add constraint reject_binding check(job_id<>${q(bad.jobId)}::uuid)`,
      );
      await assert.rejects(bindEmailJobAttempt(db, bad), /could not be confirmed/);
      assert.equal(sql("select count(*) from email_sync_runs"), before);
      sql("alter table learn_email_job_attempts drop constraint reject_binding");
    });
    await t.test(
      "a lease expiring during settlement rolls back progress and recovers under the next lease",
      async () => {
        const release = prepareEmailTransition(
          bound,
          jobResult.checkpoint,
          randomUUID(),
          "release",
          {
            reason_code: "requested_yield",
            attempt_evidence: { ...evidence, coverage_complete: false },
          },
        );
        await db.rpc("learn_email_transition_prepare", {
          p_document: release,
          p_claimed_by: replacement.claimedBy,
          p_claim: replacement.attemptCount,
        });
        sql(
          `create sequence lease_delay_observed;grant usage on sequence lease_delay_observed to service_role;create function test_lease_delay() returns trigger language plpgsql as $$begin if new.request_id=${q(release.transitionId)}::uuid then perform nextval('public.lease_delay_observed');perform pg_sleep(1.2);end if;return new;end$$;create trigger test_lease_delay before insert on learn_email_transition_settlements for each row execute function test_lease_delay();update platform_jobs set lease_expires_at=clock_timestamp()+interval '1 second' where id=${q(job.jobId)};`,
        );
        const before = count();
        await assert.rejects(
          applyDurableEmailTransition(db, release, replacement),
          EmailTransitionUnconfirmed,
        );
        assert.equal(sql("select is_called from lease_delay_observed"), "t");
        assert.equal(count(), before);
        assert.equal(
          sql(`select status from email_sync_runs where id=${q(bound.attemptId)}`),
          "running",
        );
        assert.deepEqual(await pendingEmailTransition(db, bound), release);
        sql(
          `drop trigger test_lease_delay on learn_email_transition_settlements;update platform_jobs set claimed_by='worker-final',attempt_count=3,lease_expires_at=clock_timestamp()+interval '1 hour' where id=${q(job.jobId)}`,
        );
        const finalLease = { ...job, claimedBy: "worker-final", attemptCount: 3 };
        const result = await applyDurableEmailTransition(db, release, finalLease);
        assert.equal(result.accepted.attempt_status, "success");
        const recovered = await bindEmailJobAttempt(db, finalLease);
        assert.equal(recovered.status, "success");
        assert.equal(recovered.attemptId, bound.attemptId);
        assert.equal(
          sql(
            `select count(*) from email_sync_runs where metadata->>'learn_email_job_id'=${q(job.jobId)}`,
          ),
          "1",
        );
      },
    );
    await verifyEmailPageStore({ t, sql, db, queueJob, q, i });
    await verifyEmailCaptureEngine({ t, sql, db, queueJob, q, reference });
    await verifyEmailPausedRecovery({ t, sql, db, queueJob, q, reference });
    await verifyEmailEnqueue({ t, sql, sqlAsync, db, queueJob, q });
    await verifyEmailMailboxCoverage({ t, sql, db, queueJob, q });
    await verifyEmailMailboxChanges({ t, sql, db, queueJob, q });
    await t.test("full-import horizon is pinned to a new continuation and guarded by the account", async () => {
      const candidate = readFileSync(
        "supabase/migrations/20261104090000_learn_email_full_import_horizon.sql",
        "utf8",
      );
      sql(candidate.replace(/\ncommit;\s*$/, "\nrollback;"));
      assert.equal(sql("select count(*) from information_schema.columns where table_name='email_accounts' and column_name='full_import_after_at'"), "0");
      sql(candidate);
      const j = queueJob();
      sql(`update email_accounts set full_import_after_at='2023-10-16T00:00:00Z' where id=${q(j.accountId)}`);
      const bound = await bindEmailJobAttempt(db, j);
      const claim = await applyEmailTransition(db,
        prepareEmailTransition(bound, null, randomUUID(), "claim", { recovery: null }),
        async (r) => r);
      assert.equal(claim.accepted.checkpoint_state, "claimed");
      const boundary = { captured_history_id: "100", captured_at: "2026-10-16T06:00:00.000Z", page_size: 25 };
      const wrong = await applyEmailTransition(db,
        prepareEmailTransition(bound, claim.checkpoint, randomUUID(), "initialize_traversal", {
          ...boundary, query: "after:1729036800",
        }), async (r) => r);
      assert.equal(wrong.code, "checkpoint_conflict");
      const accepted = await applyEmailTransition(db,
        prepareEmailTransition(bound, claim.checkpoint, randomUUID(), "initialize_traversal", {
          ...boundary, query: "after:1697414400",
        }), async (r) => r);
      assert.equal(accepted.accepted.checkpoint_state, "claimed");
      assert.equal(accepted.checkpoint.continuation.query, "after:1697414400");
    });
  } finally {
    if (created) execFileSync(docker, ["rm", "-f", name], { stdio: "pipe", timeout: 30000 });
    rmSync(dir, { recursive: true, force: true });
  }
});
