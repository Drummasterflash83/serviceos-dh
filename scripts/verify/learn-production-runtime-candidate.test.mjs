import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inspectRuntimeSource, productionRuntimeCandidate, validateInventory } from "./learn-production-runtime-candidate.mjs";

test("static review records unresolved dispatch without mistaking comments for calls", () => {
  const result = inspectRuntimeSource("fixture.ts", `
    // Deno.env.get("NOT_A_SECRET_DEPENDENCY")
    Deno.env.get("WORKER_SECRET");
    Deno.env.get(variableName);
    await db.rpc("queue_claim", {});
    await db.rpc(selectProcedure(), {});
    await invokeFunction("child-worker", {}, key);
    await invokeFunction(selectedWorker, {}, key);
  `);
  assert.deepEqual(result.environment, ["WORKER_SECRET"]);
  assert.deepEqual(result.rpc, ["queue_claim"]);
  assert.deepEqual(result.literalCalls, ["child-worker"]);
  assert.deepEqual(result.unresolved.map(r => r.kind), ["environment", "rpc", "function"]);
});

test("inventory rejects ambiguous or inactive endpoints and excludes unknown fields", () => {
  const row = { name: "worker-one", id: "synthetic", version: 1, hash: "a".repeat(64), jwt: false, status: "ACTIVE" };
  assert.deepEqual(validateInventory([{ ...row, unexpectedPrivateField: "omit" }]), [row]);
  for (const rows of [[row, row], [{ ...row, status: "REMOVED" }], [{ ...row, jwt: null }], [{ ...row, hash: null }]])
    assert.throws(() => validateInventory(rows), /metadata required/);
});

test("candidate refuses SQL target and source drift before producing a release inventory", () => {
  const read = p => readFileSync(p, "utf8");
  const target = "supabase/release/learn-production/001_launch_metadata_views.manifest.json";
  assert.throws(() => productionRuntimeCandidate({ production: [], test: [], read: p => {
    if (p !== target) return read(p);
    return JSON.stringify({ ...JSON.parse(read(p)), projectRef: "not-production" });
  } }), /package pin differs/);
  assert.throws(() => productionRuntimeCandidate({ production: [], test: [], read: p =>
    p.endsWith("001_launch_metadata_views.sql") ? read(p) + "\n-- changed\n" : read(p)
  }), /package pin differs/);
});
