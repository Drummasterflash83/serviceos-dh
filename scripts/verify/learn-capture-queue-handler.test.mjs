/** Actual generic worker control flow with synthetic queue/handler/health ports. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { webcrypto, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import vm from "node:vm";
import ts from "typescript";
const tenant = "00000000-0000-4000-8000-000000000001";
async function run({
  jobId = "job",
  processingLost = false,
  processingUnconfirmed = false,
  allowed = true,
  childPaused = false,
  deferError = false,
  jobType = "email.mailbox_discovery",
  queueOutcome,
  phoneResult,
  phoneSettlementMissing = false,
  scheduleSecret = "synthetic-schedule",
  internalSecret,
  headers = { "x-schedule-secret": "synthetic-schedule", "content-type": "application/json" },
} = {}) {
  const calls = [],
    writes = [],
    health = [];
  let handler,
    workContext,
    work = 0;
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "voicemail_schedule_tick")
        return {
          data: {
            state: "idle",
            coverage_complete: false,
            historical_receipt: false,
            routes_attempted: 0,
            routes_failed: 0,
            pages: 0,
            rows_examined: 0,
            jobs_enqueued: 0,
            observed_at: new Date().toISOString(),
          },
          error: null,
        };
      if (name === "platform_jobs_claim")
        return {
          data: [
            {
              id: jobId,
              tenant_id: tenant,
              job_type: jobType,
              attempt_count: 1,
              max_attempts: 5,
              claimed_by: args.p_worker,
              payload: {},
            },
          ],
          error: null,
        };
      if (name === "learn_capture_admission")
        return {
          data: {
            version: "learn-capture-admission/1",
            tenant_id: tenant,
            source: "email",
            allowed,
            checked_at: new Date().toISOString(),
          },
          error: null,
        };
      if (name === "learn_capture_defer_job")
        return deferError
          ? { data: null, error: { message: "PRIVATE" } }
          : {
              data: { job_id: "job", state: "waiting", reason: args.p_reason, attempt_count: 0 },
              error: null,
            };
      if (name === "learn_processing_settle") {
        if (processingUnconfirmed) return { data: null, error: { message: "PRIVATE" } };
        if (processingLost && args.p_phase === "settle")
          throw Error("Synthetic lost settlement reply");
        return {
          data: {
            version: "learn-processing-settlement/1",
            tenant_id: tenant,
            job_id: jobId,
            job_type: jobType,
            attempt: 1,
            worker: args.p_worker,
            request_id: args.p_request,
            state: args.p_definition.success
              ? "succeeded"
              : args.p_definition.retryable
                ? "retrying"
                : "dead_letter",
            continuation_job_id: args.p_definition.continue
              ? "00000000-0000-4000-8000-000000000009"
              : null,
            records_processed: args.p_definition.records_processed,
            publications_committed: args.p_definition.records_processed,
            settled_at: new Date().toISOString(),
          },
          error: null,
        };
      }
      throw Error("Unexpected RPC " + name);
    },
    from: () => {
      let currentWrite;
      const q = {
        update: (v) => {
          currentWrite = { ...v, filters: [] };
          writes.push(currentWrite);
          return q;
        },
        eq: (key, value) => {
          currentWrite?.filters.push(["eq", key, value]);
          return q;
        },
        neq: (key, value) => {
          currentWrite?.filters.push(["neq", key, value]);
          return q;
        },
        lt: (key, value) => {
          currentWrite?.filters.push(["lt", key, value]);
          return q;
        },
        gt: () => q,
        maybeSingle: async () => ({
          data: phoneSettlementMissing ? null : { id: "job" },
          error: null,
        }),
        select: () => q,
        then: (yes, no) => Promise.resolve({ data: [], error: null }).then(yes, no),
      };
      return q;
    },
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    Headers,
    Request,
    Response,
    AbortSignal,
    Date,
    console,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    Deno: {
      env: {
        get: (k) =>
          ({
            SUPABASE_URL: "https://synthetic.invalid",
            SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
            WORKER_SECRET: scheduleSecret,
            SERVICEOS_INTERNAL_KEY: internalSecret,
          })[k],
      },
      serve: (f) => {
        handler = f;
      },
    },
  });
  const entry = process.env.WORKER_HANDLER_READBACK_ROOT
    ? resolve(process.env.WORKER_HANDLER_READBACK_ROOT, "platform-worker/index.ts")
    : resolve("supabase/functions/platform-worker/index.ts");
  const cache = new Map();
  const synthetic = (key, exports) => {
    if (!cache.has(key))
      cache.set(
        key,
        new vm.SyntheticModule(
          Object.keys(exports),
          function () {
            for (const [n, v] of Object.entries(exports)) this.setExport(n, v);
          },
          { context },
        ),
      );
    return cache.get(key);
  };
  async function load(file) {
    if (cache.has(file)) return cache.get(file);
    if (file.endsWith("/_shared/worker_handlers/index.ts"))
      return synthetic(file, {
        getWorkerHandler: () => async (context) => {
          workContext = context;
          work++;
          if (phoneResult) return phoneResult;
          return childPaused
            ? {
                success: false,
                error: { code: "learn_capture_paused", message: "Paused", retryable: false },
              }
            : {
                success: queueOutcome ? queueOutcome.state === "completed" : true,
                recordsProcessed: 2,
                ...(queueOutcome ? { queueOutcome } : {}),
              };
        },
      });
    if (file.endsWith("/_shared/system_health.ts"))
      return synthetic(file, {
        healthComponentForJob: () => "email_capture",
        recordHealthCheck: async (_db, v) => {
          health.push(v);
        },
      });
    const m = new vm.SourceTextModule(
      ts.transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
      { context, identifier: file },
    );
    cache.set(file, m);
    await m.link((spec, parent) =>
      spec === "node:buffer"
        ? synthetic("node:buffer", { Buffer })
        : spec === "node:crypto"
          ? synthetic("node:crypto", { createHash })
          : spec === "node:dns/promises"
            ? synthetic("node:dns/promises", {
                Resolver: class {
                  constructor() {
                    throw Error("Unexpected DNS in worker control test");
                  }
                },
              })
            : spec === "https://esm.sh/@supabase/supabase-js@2.45.4"
              ? synthetic("supabase", { createClient: () => db })
              : spec.startsWith(".")
                ? load(
                    process.env.WORKER_HANDLER_READBACK_ROOT &&
                      parent.identifier === entry &&
                      spec.startsWith("../_shared/")
                      ? resolve(dirname(parent.identifier), "functions", spec.slice(3))
                      : resolve(dirname(parent.identifier), spec),
                  )
                : Promise.reject(Error("Unexpected dependency: " + spec)),
    );
    return m;
  }
  await (await load(entry)).evaluate();
  const response = await handler(
    new Request("https://synthetic.invalid/worker", {
      method: "POST",
      headers,
      body: "{}",
    }),
  );
  return {
    status: response.status,
    result: await response.json(),
    calls,
    writes,
    health,
    work,
    workContext,
  };
}
test("exact service bearer can trigger the worker without a configured schedule secret", async () => {
  const r = await run({
    scheduleSecret: null,
    headers: { Authorization: "Bearer synthetic-service" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.work, 1);
});
test("dedicated exact service key survives gateway bearer translation", async () => {
  const r = await run({
    scheduleSecret: null,
    headers: {
      Authorization: "Bearer translated-service",
      "x-serviceos-internal-key": "synthetic-service",
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.work, 1);
  const refused = await run({
    scheduleSecret: null,
    headers: { Authorization: "Bearer translated-service", "x-serviceos-internal-key": "wrong" },
  });
  assert.equal(refused.status, 403);
  assert.equal(refused.calls.length, 0);
});
test("explicit internal binding can differ from the runtime service credential", async () => {
  const r = await run({
    scheduleSecret: null,
    internalSecret: "synthetic-stable-key",
    headers: {
      Authorization: "Bearer translated",
      "x-serviceos-internal-key": "synthetic-stable-key",
    },
  });
  assert.equal(r.status, 200);
  assert.equal(r.work, 1);
});
test("absent, unrelated and forged service claims cannot claim jobs or write health", async () => {
  for (const headers of [
    {},
    { Authorization: "Bearer synthetic-anon" },
    { Authorization: "Bearer e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake" },
    { "x-schedule-secret": "wrong" },
  ]) {
    const r = await run({ scheduleSecret: null, headers });
    assert.equal(r.status, 403);
    assert.equal(r.work, 0);
    assert.equal(r.calls.length, 0);
    assert.equal(r.writes.length, 0);
    assert.equal(r.health.length, 0);
  }
});
test("pause after claim returns the lease without dispatch, failed capture or healthy capture telemetry", async () => {
  const r = await run({ allowed: false });
  assert.equal(r.work, 0);
  assert.equal(r.result.waiting, 1);
  assert.equal(r.result.failed, 0);
  assert.equal(r.health.length, 0);
  assert.equal(r.calls.filter((c) => c.name === "learn_capture_defer_job").length, 1);
  assert.equal(
    r.writes.some((w) => w.status === "succeeded" || w.status === "dead_letter"),
    false,
  );
});
test("pause at a child endpoint is deferred without retry/failure accounting", async () => {
  const r = await run({ childPaused: true });
  assert.equal(r.work, 1);
  assert.equal(r.result.waiting, 1);
  assert.equal(r.result.retrying, 0);
  assert.equal(r.health.length, 0);
});
test("an unconfirmed deferral remains unresolved, never reported as completed or waiting", async () => {
  const r = await run({ allowed: false, deferError: true });
  assert.equal(r.result.failed, 1);
  assert.equal(r.result.waiting, 0);
  assert.equal(r.result.succeeded, 0);
  assert.equal(r.health.length, 0);
});
test("enabled capture retains normal dispatch, completion and actual work telemetry", async () => {
  const r = await run();
  assert.equal(r.work, 1);
  assert.equal(r.result.succeeded, 1);
  assert.equal(r.result.waiting, 0);
  assert.equal(r.health.length, 1);
  assert.equal(r.health[0].metadata.records, 2);
  assert.equal(r.workContext.jobType, "email.mailbox_discovery");
  assert.equal(r.workContext.claim.attemptCount, 1);
  assert.equal(
    r.workContext.claim.claimedBy,
    r.calls.find((c) => c.name === "platform_jobs_claim").args.p_worker,
  );
});

for (const historicalReceipt of [false, true])
  test(`durable email completion bypasses generic writes and only fresh evidence updates health (${historicalReceipt})`, async () => {
    const r = await run({
      allowed: false,
      jobType: "email.workspace_sync",
      queueOutcome: { state: "completed", jobId: "job", historicalReceipt },
    });
    assert.equal(r.work, 1);
    assert.equal(r.result.succeeded, 1);
    assert.equal(r.result.unconfirmed, 0);
    assert.equal(
      r.calls.some((c) => c.name === "learn_capture_admission"),
      false,
    );
    assert.equal(
      r.writes.some((w) => w.status === "succeeded" || w.status === "dead_letter"),
      false,
    );
    assert.equal(r.health.length, historicalReceipt ? 0 : 1);
  });
test("unknown durable email outcomes retain the lease without completion, failure or health claims", async () => {
  for (const queueOutcome of [
    { state: "unconfirmed", jobId: "job" },
    { state: "completed", jobId: "foreign", historicalReceipt: false },
    undefined,
  ]) {
    const r = await run({ jobType: "email.workspace_sync", queueOutcome });
    assert.equal(r.result.unconfirmed, 1);
    assert.equal(r.result.succeeded, 0);
    assert.equal(r.result.failed, 0);
    assert.equal(r.result.success, false);
    assert.equal(r.health.length, 0);
    assert.equal(
      r.writes.some((w) => w.status === "succeeded" || w.status === "dead_letter"),
      false,
    );
  }
});
test("settled email failure is counted without a second generic failure update", async () => {
  const r = await run({
    jobType: "email.workspace_sync",
    queueOutcome: { state: "failed", jobId: "job" },
  });
  assert.equal(r.result.dead_lettered, 1);
  assert.equal(r.result.unconfirmed, 0);
  assert.equal(r.health[0].status, "failed");
  assert.equal(
    r.writes.some((w) => w.status === "dead_letter"),
    false,
  );
});
test("Microsoft owned completion, waiting, retry and unknown outcomes never invoke generic queue writes", async () => {
  for (const jobType of ["email.microsoft_discovery", "email.microsoft_sync"]) {
    for (const [state, counter] of [
      ["completed", "succeeded"],
      ["waiting", "waiting"],
      ["retrying", "retrying"],
      ["failed", "dead_lettered"],
      ["unconfirmed", "unconfirmed"],
    ]) {
      const r = await run({ allowed: false, jobType, queueOutcome: { state, jobId: "job" } });
      assert.equal(r.result[counter], 1);
      assert.equal(r.work, 1);
      assert.equal(
        r.calls.some(
          (c) => c.name === "learn_capture_admission" || c.name === "learn_capture_defer_job",
        ),
        false,
      );
      assert.equal(
        r.writes.some((w) =>
          w.filters.some(([op, key, value]) => op === "eq" && key === "id" && value === "job"),
        ),
        false,
      );
      assert.equal(r.health.length, ["retrying", "failed"].includes(state) ? 1 : 0);
    }
  }
});
test("historical Microsoft retry or failure receipts do not claim new health evidence", async () => {
  for (const state of ["retrying", "failed"]) {
    const r = await run({
      jobType: "email.microsoft_sync",
      queueOutcome: { state, jobId: "job", historicalReceipt: true },
    });
    assert.equal(r.health.length, 0);
    assert.equal(r.result.unconfirmed, 0);
  }
});
test("an email engine pause still defers its owned lease without failure accounting", async () => {
  const r = await run({ jobType: "email.workspace_sync", childPaused: true });
  assert.equal(r.work, 1);
  assert.equal(r.result.waiting, 1);
  assert.equal(r.result.unconfirmed, 0);
  assert.equal(r.health.length, 0);
});

test("Phone worker uses confirmed ownership-scoped settlement for success, retry and unknown results", async () => {
  for (const [phoneResult, phoneSettlementMissing, expected] of [
    [{ success: true, recordsProcessed: 1 }, false, "succeeded"],
    [
      {
        success: false,
        result: { failed: 1 },
        error: { code: "provider_timeout", message: "Unavailable", retryable: true },
      },
      false,
      "retrying",
    ],
    [{ success: true }, true, "unconfirmed"],
    [
      {
        success: false,
        error: { code: "phone_job_unconfirmed", message: "Unconfirmed", retryable: false },
      },
      false,
      "unconfirmed",
    ],
  ]) {
    const r = await run({ jobType: "phone.process_pending", phoneResult, phoneSettlementMissing });
    assert.equal(r.result[expected], 1);
    if (expected === "retrying")
      assert.ok(r.writes.some((w) => w.status === "retrying" && w.result?.failed === 1));
    if (expected === "unconfirmed") assert.equal(r.health.length, 0);
  }
});

test("a completed Phone recovery check with paused capture does not report healthy processing", async () => {
  const r = await run({
    jobType: "phone.process_pending",
    phoneResult: { success: true, result: { capture_waiting: 1, reason: "capture_waiting" } },
  });
  assert.equal(r.result.succeeded, 1);
  assert.equal(r.health.length, 1);
  assert.equal(r.health[0].status, "degraded");
});

test("retained-input processors use atomic settlement, not generic completion or enqueue", async () => {
  const r = await run({
    jobId: "00000000-0000-4000-8000-000000000002",
    jobType: "identity.resolve",
  });
  assert.equal(r.result.succeeded, 1);
  assert.equal(r.health.length, 1);
  assert.equal(r.calls.filter((c) => c.name === "learn_processing_settle").length, 1);
  assert.ok(r.writes.every((w) => w.status !== "succeeded" && w.completed_at === undefined));
});
test("lost processing settlement is recovered without fresh health or a second mutation", async () => {
  const r = await run({
    jobId: "00000000-0000-4000-8000-000000000002",
    jobType: "interactions.sync",
    processingLost: true,
  });
  assert.equal(r.result.succeeded, 1);
  assert.equal(r.health.length, 0);
  assert.deepEqual(
    r.calls.filter((c) => c.name === "learn_processing_settle").map((c) => c.args.p_phase),
    ["settle", "inspect"],
  );
});
test("unknown processing settlement stays unconfirmed without generic completion or failure", async () => {
  const r = await run({
    jobId: "00000000-0000-4000-8000-000000000002",
    jobType: "identity.resolve",
    processingUnconfirmed: true,
  });
  assert.equal(r.result.succeeded, 0);
  assert.equal(r.result.unconfirmed, 1);
  assert.equal(r.health.length, 0);
  assert.ok(r.writes.every((w) => w.status !== "succeeded" && w.status !== "dead_letter"));
});
