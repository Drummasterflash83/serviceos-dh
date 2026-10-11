import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { schedulerOutcome } from "../src/lib/scheduler-outcome.ts";

const compile = (path) =>
  ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const health = {};
runInNewContext(compile("../supabase/functions/_shared/email_scheduler_health.ts"), {
  exports: health,
  Date,
});
const account = (id, tenant_id) => ({
  id,
  tenant_id,
  provider: "gmail",
  status: "active_dwd",
  backfill_status: "running",
  updated_at: id,
});

function harness(kind, options = {}) {
  const accounts = options.accounts ?? [account("a1", "a"), account("b1", "b")];
  const connections = options.connections ?? [
    { tenant_id: "a", status: "active" },
    { tenant_id: "b", status: "active" },
  ];
  const jobs = [],
    heartbeats = [],
    reads = [];
  let handler;
  const db = {
    from(table) {
      const filters = [];
      let cap = Infinity;
      const query = {
        select() {
          reads.push(table);
          return query;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return query;
        },
        neq(k, v) {
          filters.push((r) => r[k] !== v);
          return query;
        },
        in(k, v) {
          filters.push((r) => v.includes(r[k]));
          return query;
        },
        order() {
          return query;
        },
        limit(n) {
          cap = n;
          return query;
        },
        async maybeSingle() {
          return options.discoveryError
            ? { data: null, error: { message: "PRIVATE discovery" } }
            : {
                data: options.discoveryDue ? null : { completed_at: new Date().toISOString() },
                error: null,
              };
        },
        async insert(value) {
          heartbeats.push(value);
          if (options.heartbeatThrow === value.tenant_id) throw Error("PRIVATE heartbeat");
          return {
            error:
              options.heartbeatError === value.tenant_id ? { message: "PRIVATE heartbeat" } : null,
          };
        },
        then(resolve, reject) {
          assert.ok(["email_accounts", "google_workspace_connections"].includes(table));
          const rows = table === "email_accounts" ? accounts : connections;
          return Promise.resolve(
            options.readError === table
              ? { data: null, error: { message: "PRIVATE read" } }
              : { data: rows.filter((r) => filters.every((f) => f(r))).slice(0, cap), error: null },
          ).then(resolve, reject);
        },
      };
      return query;
    },
  };
  runInNewContext(
    compile(
      `../supabase/functions/email-workspace-${kind === "backfill" ? "backfill-" : ""}scheduled-sync/index.ts`,
    ),
    {
      exports: {},
      Request,
      Response,
      Date,
      Map,
      Set,
      require(name) {
        if (name.includes("@supabase/")) return { createClient: () => db };
        if (name.endsWith("email_scheduler_health.ts")) return health;
        if (name.endsWith("platform_queue.ts"))
          return {
            enqueueJob: async (_db, input) => {
              jobs.push(input);
              if (options.enqueueThrow === input.tenantId) throw Error("PRIVATE enqueue");
              return (
                options.outcomes?.[input.payload?.email_account_id ?? input.jobType] ?? {
                  id: "job",
                  duplicate: false,
                }
              );
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
            return name === "SUPABASE_URL" ? "https://test.invalid" : "synthetic";
          },
        },
      },
    },
  );
  return {
    jobs,
    heartbeats,
    reads,
    async run(secret = "synthetic", method = "POST") {
      const response = await handler(
        new Request("https://test.invalid", {
          method,
          headers: { "x-schedule-secret": secret },
        }),
      );
      const body = await response.json();
      assert.ok(!JSON.stringify(body).includes("PRIVATE"));
      assert.ok(!JSON.stringify(heartbeats).includes("PRIVATE"));
      // Actual handler receipts feed the same projection used by the client.
      for (const receipt of heartbeats) {
        const outcome = schedulerOutcome({ ...receipt, ...receipt.metadata }, "started_at", 300);
        assert.equal(
          outcome.status,
          receipt.status === "failed"
            ? "failed"
            : receipt.metadata.capture_paused > 0
              ? "paused"
              : "healthy",
        );
      }
      return { status: response.status, body };
    },
  };
}

for (const kind of ["live", "backfill"]) {
  test(`${kind}: each company's heartbeat counts only its own confirmed new work`, async () => {
    const h = harness(kind, { outcomes: { b1: { id: "existing", duplicate: true } } });
    const r = await h.run();
    assert.equal(r.status, 200);
    assert.equal(r.body.queued, 1);
    assert.equal(r.body.duplicates, 1);
    assert.equal(h.heartbeats.find((r) => r.tenant_id === "a").records_processed, 1);
    const b = h.heartbeats.find((r) => r.tenant_id === "b");
    assert.equal(b.records_processed, 0);
    assert.equal(b.metadata.duplicates, 1);
    assert.equal(b.status, "success");
  });
  test(`${kind}: queue refusal or missing duplicate identity is never a success heartbeat`, async () => {
    for (const result of [
      { id: null, duplicate: false },
      { id: null, duplicate: true },
      { id: null, duplicate: false, captureWaiting: "unavailable" },
    ]) {
      const h = harness(kind, { outcomes: { a1: result } });
      assert.equal((await h.run()).status, 503);
      assert.equal(h.heartbeats.find((r) => r.tenant_id === "a").status, "failed");
      assert.equal(h.heartbeats.find((r) => r.tenant_id === "b").status, "success");
    }
  });
  test(`${kind}: paused capture remains distinct from failed scheduling`, async () => {
    const h = harness(kind, {
      outcomes: { a1: { id: null, duplicate: false, captureWaiting: "paused" } },
    });
    assert.equal((await h.run()).body.capture_paused, 1);
    const a = h.heartbeats.find((r) => r.tenant_id === "a");
    assert.equal(a.records_processed, 0);
    assert.equal(a.metadata.capture_paused, 1);
    assert.equal(a.status, "success");
  });
  test(`${kind}: read failures do not enqueue and never expose raw errors`, async () => {
    for (const readError of ["email_accounts", "google_workspace_connections"]) {
      const h = harness(kind, { readError });
      assert.equal((await h.run()).status, 500);
      assert.equal(h.jobs.length, 0);
      if (readError === "email_accounts") {
        assert.equal(h.heartbeats.length, 2);
        assert.ok(
          h.heartbeats.every((h) => h.status === "failed" && h.metadata.inventory_unavailable),
        );
      }
    }
  });
  test(`${kind}: heartbeat failures do not prevent other companies' receipts`, async () => {
    for (const failure of ["heartbeatError", "heartbeatThrow"]) {
      const h = harness(kind, { [failure]: "a" });
      assert.equal((await h.run()).body.error.code, "heartbeat_unconfirmed");
      assert.equal(h.heartbeats.length, 2);
    }
  });
  test(`${kind}: thrown enqueue fails only that company's heartbeat`, async () => {
    const h = harness(kind, { enqueueThrow: "a" });
    assert.equal((await h.run()).status, 503);
    assert.equal(h.heartbeats.find((r) => r.tenant_id === "a").status, "failed");
    assert.equal(h.heartbeats.find((r) => r.tenant_id === "b").status, "success");
  });
  test(`${kind}: missing trigger secret and wrong method are rejected before database use`, async () => {
    const h = harness(kind);
    assert.equal((await h.run("wrong")).status, 403);
    assert.equal((await h.run("synthetic", "GET")).status, 405);
    assert.equal(h.reads.length, 0);
    assert.equal(h.jobs.length, 0);
  });
}
test("backfill: five-mailbox bound and explicit running imports are preserved", async () => {
  const h = harness("backfill", {
    accounts: [
      { ...account("idle", "a"), backfill_status: "idle" },
      { ...account("oauth", "a"), status: "active" },
      ...Array.from({ length: 7 }, (_, i) => account(`a${i}`, "a")),
    ],
  });
  assert.equal((await h.run()).body.mailboxes, 5);
  assert.equal(h.jobs.length, 5);
  assert.ok(h.jobs.every((j) => j.priority === 200 && j.jobType === "email.workspace_backfill"));
  assert.equal(h.heartbeats.find((r) => r.tenant_id === "b").records_processed, 0);
});
test("live: unavailable discovery history does not look like an empty history", async () => {
  const h = harness("live", { discoveryError: true });
  assert.equal((await h.run()).status, 503);
  assert.ok(h.jobs.every((j) => j.jobType === "email.workspace_sync"));
  assert.ok(h.heartbeats.every((h) => h.status === "failed"));
});
test("live: confirmed discovery is counted separately and a lost enqueue is visible", async () => {
  const h = harness("live", { discoveryDue: true });
  const result = await h.run();
  assert.equal(result.body.discovery_queued, 2);
  assert.equal(result.body.queued, 2);
  assert.ok(
    h.heartbeats.every(
      (h) =>
        h.metadata.discovery_enqueued === 1 &&
        h.metadata.mailboxes_enqueued === 1 &&
        h.records_processed === 2,
    ),
  );
  const failed = harness("live", {
    discoveryDue: true,
    outcomes: { "email.mailbox_discovery": { id: null, duplicate: false } },
  });
  assert.equal((await failed.run()).status, 503);
  assert.ok(
    failed.heartbeats.every((h) => h.status === "failed" && h.metadata.enqueue_unconfirmed === 1),
  );
});
