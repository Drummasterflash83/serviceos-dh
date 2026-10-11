import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture({
  result = { success: true, recordsProcessed: 2, result: { interactions_upserted: 2 } },
  job = { id: id(102), duplicate: false },
  mismatch = null,
} = {}) {
  let handler;
  const calls = [];
  const code = readFileSync(
    new URL("../supabase/functions/interactions-sync/index.ts", import.meta.url),
    "utf8",
  );
  runInNewContext(
    ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: {},
      Deno: { serve: (fn) => (handler = fn), env: { get: () => "synthetic" } },
      Request,
      Response,
      require: (name) => {
        if (name.startsWith("https://esm.sh/")) return { createClient: () => ({}) };
        if (name.endsWith("/authz.ts"))
          return {
            requireTenantUser: async () => ({
              ok: true,
              ctx: { tenantId: id(100), userId: id(101) },
            }),
            assertSameTenant: () => mismatch,
          };
        if (name.endsWith("/interactions_sync.ts"))
          return {
            handleInteractionsSync: async () => {
              calls.push(["handler"]);
              return result;
            },
          };
        if (name.endsWith("/platform_jobs.ts"))
          return {
            createPlatformJob: async () => {
              calls.push(["create"]);
              return job;
            },
            startPlatformJob: async () => calls.push(["start"]),
            completePlatformJob: async (...args) => calls.push(["complete", ...args]),
            failPlatformJob: async (...args) => calls.push(["failed", ...args]),
          };
        throw Error("Unexpected wrapper import");
      },
    },
  );
  return {
    calls,
    run: (body = "{}") => handler(new Request("https://test.invalid", { method: "POST", body })),
  };
}
test("partial failure is HTTP 500 and failed job with confirmed counts retained", async () => {
  const f = fixture({
    result: {
      success: false,
      recordsProcessed: 1,
      result: { failed: 1, interactions_upserted: 1 },
      error: { code: "projection_unconfirmed", message: "Retained inputs need retry" },
    },
  });
  const response = await f.run();
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.interactions_upserted, 1);
  assert.equal(f.calls.filter((c) => c[0] === "complete").length, 0);
  assert.equal(f.calls.find((c) => c[0] === "failed")[4].failed, 1);
});
test("successful handler records completion; duplicate and failed admission never execute it", async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 200);
  assert.equal(f.calls.at(-1)[0], "complete");
  for (const [job, status] of [
    [{ id: id(102), duplicate: true }, 202],
    [{ id: null, duplicate: false }, 503],
  ]) {
    const f = fixture({ job });
    assert.equal((await f.run()).status, status);
    assert.deepEqual(f.calls, [["create"]]);
  }
});
test("foreign tenant, invalid source and malformed body fail before job creation", async () => {
  const foreign = fixture({
    mismatch: { code: "tenant_mismatch", message: "Wrong company", httpStatus: 403 },
  });
  assert.equal((await foreign.run()).status, 403);
  assert.equal(foreign.calls.length, 0);
  for (const body of ["null", "[]", "false", "broken", '{"source":"slack"}']) {
    const f = fixture();
    assert.equal((await f.run(body)).status, 400);
    assert.equal(f.calls.length, 0);
  }
});
