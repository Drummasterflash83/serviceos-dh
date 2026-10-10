/** Actual generic worker control flow with synthetic queue/handler/health ports. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
const tenant = "00000000-0000-4000-8000-000000000001";
async function run({ allowed = true, childPaused = false, deferError = false } = {}) {
  const calls = [],
    writes = [],
    health = [];
  let handler,
    workContext,
    work = 0;
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "platform_jobs_claim")
        return {
          data: [
            {
              id: "job",
              tenant_id: tenant,
              job_type: "email.gmail_sync",
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
      throw Error("Unexpected RPC " + name);
    },
    from: () => {
      const q = {
        update: (v) => {
          writes.push(v);
          return q;
        },
        eq: () => q,
        lt: () => q,
        select: () => q,
        then: (yes, no) => Promise.resolve({ data: [], error: null }).then(yes, no),
      };
      return q;
    },
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
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
            WORKER_SECRET: "synthetic-schedule",
          })[k],
      },
      serve: (f) => {
        handler = f;
      },
    },
  });
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
          return childPaused
            ? {
                success: false,
                error: { code: "learn_capture_paused", message: "Paused", retryable: false },
              }
            : { success: true, recordsProcessed: 2 };
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
      spec === "https://esm.sh/@supabase/supabase-js@2.45.4"
        ? synthetic("supabase", { createClient: () => db })
        : spec.startsWith(".")
          ? load(resolve(dirname(parent.identifier), spec))
          : Promise.reject(Error("Unexpected dependency")),
    );
    return m;
  }
  await (await load(resolve("supabase/functions/platform-worker/index.ts"))).evaluate();
  const response = await handler(
    new Request("https://synthetic.invalid/worker", {
      method: "POST",
      headers: { "x-schedule-secret": "synthetic-schedule", "content-type": "application/json" },
      body: "{}",
    }),
  );
  return { result: await response.json(), calls, writes, health, work, workContext };
}
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
  assert.equal(r.workContext.jobType, "email.gmail_sync");
  assert.equal(r.workContext.claim.attemptCount, 1);
  assert.equal(
    r.workContext.claim.claimedBy,
    r.calls.find((c) => c.name === "platform_jobs_claim").args.p_worker,
  );
});
