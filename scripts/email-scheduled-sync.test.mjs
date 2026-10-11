import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";

// Execute the real Edge handler with synthetic database/queue ports. No provider
// tokens, live scheduling, network requests or source messages are involved.
function harness(accounts, { readError = false, writeError = false } = {}) {
  let handler;
  const jobs = [],
    heartbeats = [],
    selections = [];
  const db = {
    from(table) {
      if (table === "email_sync_runs")
        return {
          async insert(value) {
            heartbeats.push(value);
            return { error: writeError ? { message: "PRIVATE database detail" } : null };
          },
        };
      assert.equal(table, "email_accounts");
      const filters = [];
      const query = {
        select(value) {
          selections.push(value);
          return query;
        },
        eq(k, v) {
          filters.push([k, v]);
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: readError ? null : accounts.filter((a) => filters.every(([k, v]) => a[k] === v)),
            error: readError ? { message: "PRIVATE database detail" } : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const source = readFileSync(
    new URL("../supabase/functions/email-scheduled-sync/index.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, {
    exports: {},
    Request,
    Response,
    Map,
    Date,
    require(name) {
      if (name.includes("@supabase/")) return { createClient: () => db };
      if (name.endsWith("platform_queue.ts"))
        return {
          enqueueJob: async (_db, input) => {
            jobs.push(input);
            return { id: "synthetic-job", duplicate: false };
          },
        };
      throw Error("Unexpected dependency");
    },
    Deno: {
      serve(fn) {
        handler = fn;
      },
      env: {
        get(name) {
          return {
            EMAIL_SCHEDULE_SECRET: "synthetic-secret",
            SUPABASE_URL: "https://test.invalid",
            SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
          }[name];
        },
      },
    },
  });
  return {
    jobs,
    heartbeats,
    selections,
    async run(secret = "synthetic-secret") {
      const r = await handler(
        new Request("https://test.invalid/schedule", {
          method: "POST",
          headers: { "x-schedule-secret": secret },
        }),
      );
      return { status: r.status, body: await r.json() };
    },
  };
}
const account = (id, auth_state, tenant_id = "tenant-a", status = "active") => ({
  id,
  auth_state,
  tenant_id,
  status,
  provider: "gmail",
});
test("revoked, expired and missing auth state never enqueue; eligible OAuth continues across tenants", async () => {
  const h = harness([
    account("revoked", "revoked"),
    account("expired", "expired"),
    account("missing", null),
    account("ok", "ok"),
    account("unknown", "unknown", "tenant-b"),
    account("dwd", "unknown", "tenant-b", "active_dwd"),
  ]);
  const result = await h.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.queued, 2);
  assert.equal(result.body.skipped_auth_required, 3);
  assert.deepEqual(
    h.jobs.map((j) => j.payload.email_account_id),
    ["ok", "unknown"],
  );
  assert.equal(h.heartbeats.length, 2);
  assert.equal(h.heartbeats[0].metadata.skipped_auth_required, 3);
  assert.equal(h.heartbeats[1].tenant_id, "tenant-b");
  assert.match(h.selections[0], /auth_state/);
});
test("all-revoked tenant gets a zero-queue scheduler heartbeat, without capture claims", async () => {
  const h = harness([account("revoked", "revoked")]);
  assert.equal((await h.run()).body.queued, 0);
  assert.equal(h.jobs.length, 0);
  assert.equal(h.heartbeats[0].sync_type, "scheduled_sync");
  assert.equal(h.heartbeats[0].records_processed, 0);
  assert.equal(h.heartbeats[0].metadata.skipped_auth_required, 1);
});
test("missing authority, account-read failures and heartbeat failures cannot report clean success", async () => {
  const unauthorized = harness([account("ok", "ok")]);
  assert.equal((await unauthorized.run("wrong")).status, 403);
  assert.equal(unauthorized.selections.length, 0);
  const unreadable = harness([account("ok", "ok")], { readError: true });
  assert.equal((await unreadable.run()).status, 500);
  assert.equal(unreadable.jobs.length, 0);
  const uncertain = harness([account("ok", "ok")], { writeError: true });
  const result = await uncertain.run();
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, "heartbeat_unconfirmed");
  assert.equal(uncertain.jobs.length, 1);
  assert.ok(!JSON.stringify(result).includes("PRIVATE"));
});
