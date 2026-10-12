import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommusoftPermitPorts } from "./permit_server.ts";
import type { StoredCommusoftScope } from "./stored_scope.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-10T12:00:00Z");
function fixture() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const state: { data: unknown; error: unknown; throws: boolean } = {
    data: { state: "ready", apiKey: "synthetic-key", permitId: id(8), sendBefore: now + 5000 },
    error: null,
    throws: false,
  };
  const controller = new AbortController();
  const ctx = {
    tenantId: id(1),
    jobId: id(2),
    jobType: "commusoft.source_sync",
    signal: controller.signal,
    claim: { claimedBy: "test-worker", attemptCount: 1 },
    supabaseAdmin: {
      from() {
        throw Error("Unexpected metadata read");
      },
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        if (state.throws) throw Error("synthetic secret error");
        return { data: state.data, error: state.error };
      },
    },
  };
  const scope: StoredCommusoftScope = {
    tenantId: id(1),
    jobId: id(2),
    accountId: id(3),
    connectorId: id(4),
    connectionId: id(5),
    connectionRevision: "2026-10-10T11:00:00Z",
    secretId: id(7),
    approval: { approved: true },
    checkpoint: {},
    request: { region: "uk", resource: "properties", after: null, limit: 100 },
    pages: 0,
    complete: false,
    scopeKey: "fixture",
  };
  const ports = createCommusoftPermitPorts(
    ctx,
    async () => {
      throw Error("Unexpected network");
    },
    () => now,
  );
  return { ctx, ports, state, scope, calls, controller };
}
test("bridge calls only atomic acquisition with exact bound scope and immutable worker identity", async () => {
  const f = fixture(),
    originalClaim = { ...f.ctx.claim };
  f.ctx.claim.claimedBy = "changed-by-caller";
  const result = await f.ports.acquire(f.scope, originalClaim);
  assert.equal(result?.state, "ready");
  assert.equal(f.calls[0].name, "learn_commusoft_acquire_page");
  assert.deepEqual(f.calls[0].args, {
    p_tenant_id: id(1),
    p_job_id: id(2),
    p_claimed_by: "test-worker",
    p_attempt_count: 1,
    p_expected: f.scope,
  });
  assert.equal(JSON.stringify(f.calls).includes("synthetic-key"), false);
});
test("foreign scope, changed attempt or cancellation never reaches credential RPC", async () => {
  const f = fixture();
  assert.equal(await f.ports.acquire({ ...f.scope, tenantId: id(99) }, f.ctx.claim), null);
  assert.equal(await f.ports.acquire({ ...f.scope, jobId: id(99) }, f.ctx.claim), null);
  assert.equal(await f.ports.acquire(f.scope, { ...f.ctx.claim, attemptCount: 2 }), null);
  f.controller.abort();
  assert.equal(await f.ports.acquire(f.scope, f.ctx.claim), null);
  assert.equal(f.calls.length, 0);
});
test("missing RPC, malformed results and private errors fail closed without fallback", async () => {
  const f = fixture();
  for (const data of [
    null,
    {},
    { state: "ready", apiKey: "secret", permitId: "bad" },
    { state: "wait", retryAt: now },
    { state: "wait", retryAt: now + 60000, apiKey: "unexpected" },
    { state: "ready", apiKey: "bad\nheader", permitId: id(8) },
    { state: "ready", apiKey: "synthetic-key", permitId: id(8), sendBefore: NaN },
  ]) {
    f.state.data = data;
    assert.equal(await f.ports.acquire(f.scope, f.ctx.claim), null);
  }
  f.state.error = { message: "private provider details" };
  assert.equal(await f.ports.acquire(f.scope, f.ctx.claim), null);
  f.state.throws = true;
  assert.equal(await f.ports.acquire(f.scope, f.ctx.claim), null);
  assert.ok(f.calls.every((c) => c.name === "learn_commusoft_acquire_page"));
});
test("expired well-formed permits reach the bound handler for retry classification, never a fallback secret read", async () => {
  const f = fixture();
  f.state.data = { state: "ready", apiKey: "synthetic-key", permitId: id(8), sendBefore: now };
  const result = await f.ports.acquire(f.scope, f.ctx.claim);
  assert.equal(result?.state, "ready");
  assert.equal(result && "sendBefore" in result && result.sendBefore, now);
  assert.equal(f.calls.length, 1);
});
test("defer is exact-permit scoped and can extend a gate after caller cancellation", async () => {
  const f = fixture();
  f.controller.abort();
  f.state.data = true;
  assert.equal(await f.ports.defer(id(8), now + 60000), true);
  assert.deepEqual(f.calls[0], {
    name: "learn_commusoft_defer_page",
    args: {
      p_tenant_id: id(1),
      p_job_id: id(2),
      p_claimed_by: "test-worker",
      p_attempt_count: 1,
      p_permit_id: id(8),
      p_retry_at: "2026-10-10T12:01:00.000Z",
    },
  });
  assert.equal(await f.ports.defer(id(8), NaN), false);
  assert.equal(await f.ports.defer(id(8), Infinity), false);
  assert.equal(await f.ports.defer("bad", now), false);
  assert.equal(f.calls.length, 1);
  f.state.error = {};
  assert.equal(await f.ports.defer(id(8), now), false);
});
