/** Actual hosted v2 function definitions in disposable Postgres; no provider or
 * hosted database access. Unrelated launch-reader policy dependencies are omitted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
const db = {
  async rpc(fn, args) {
    assert.ok(
      ["email_ingestion_transition_v2", "email_ingestion_transition_result_v2"].includes(fn),
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
                  k + "=>" + (k === "p_payload" ? q(JSON.stringify(v)) + "::jsonb" : q(v)),
              )
              .join(",") +
            ");",
        ),
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
  } finally {
    if (created) execFileSync(docker, ["rm", "-f", name], { stdio: "pipe", timeout: 30000 });
    rmSync(dir, { recursive: true, force: true });
  }
});
