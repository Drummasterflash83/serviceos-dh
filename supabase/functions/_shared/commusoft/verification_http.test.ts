import { test } from "node:test";
import assert from "node:assert/strict";
import { commusoftVerificationEndpoint } from "./verification_http.ts";
import { parseVerificationReceipt } from "./verification_contract.ts";
import { resolveCommusoftVerification } from "../../../../src/lib/learn-commusoft-verification.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = {
  tenantId: id(1),
  actorId: id(2),
  requestId: id(3),
  definition: {
    kind: "verify_commusoft" as const,
    reason: "Synthetic check",
    connection_id: id(4),
    revision: "2026-10-10T12:00:00Z",
    one_read_confirmed: true as const,
  },
};
const base = { tenant_id: id(1), request_id: id(3) };
const approved = { ...base, state: "approved", expires_at: "2026-10-10T12:02:00Z" };
const recorded = {
  ...base,
  state: "recorded",
  connection_id: id(4),
  code: "access_verified",
  verified_at: "2026-10-10T12:00:10Z",
  revision: "2026-10-10T12:00:10Z",
};
function fixture() {
  const state = {
    actor: id(2) as string | null,
    reads: [] as string[],
    executed: 0,
    receipt: approved as unknown,
    denied: false,
    lostExecution: false,
  };
  const handler = commusoftVerificationEndpoint({
    authenticate: async () =>
      state.actor
        ? {
            actorId: state.actor,
            rpc: async (_name, args) => {
              state.reads.push(String(args.p_mode));
              return {
                data: state.receipt,
                error: state.denied ? { message: "private-error" } : null,
              };
            },
          }
        : null,
    execute: async (tenant, req) => {
      assert.equal(tenant, id(1));
      assert.equal(req, id(3));
      state.executed++;
      state.receipt = { ...recorded, private_field: "not-for-browser" };
      if (state.lostExecution) throw Error("private-error");
      return { state: "finished" };
    },
  });
  const send = (body: unknown = { request, mode: "apply" }) =>
    handler(
      new Request("https://test.invalid/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  return { state, handler, send };
}
test("authenticated apply executes once then returns a sanitized retained receipt", async () => {
  const f = fixture();
  const response = await f.send();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { receipt: recorded });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.state.reads, ["apply", "check"]);
  assert.equal(f.state.executed, 1);
});
test("authentication, actor mismatch, malformed/oversized body and denied SQL prevent execution", async () => {
  const unauth = fixture();
  unauth.state.actor = null;
  assert.equal((await unauth.send()).status, 401);
  const actor = fixture();
  actor.state.actor = id(9);
  assert.equal((await actor.send()).status, 403);
  const denied = fixture();
  denied.state.denied = true;
  const deniedResponse = await denied.send();
  assert.equal(deniedResponse.status, 503);
  assert.ok(!(await deniedResponse.text()).includes("private-error"));
  for (const body of [
    { request, mode: "apply", api_key: "never" },
    { request: { ...request, actorId: "invalid" }, mode: "apply" },
    {
      request: { ...request, definition: { ...request.definition, api_key: "never" } },
      mode: "cancel",
    },
    { request, mode: "apply", padding: "x".repeat(11000) },
  ]) {
    const f = fixture();
    assert.equal((await f.send(body)).status, 400);
    assert.equal(f.state.executed, 0);
  }
  for (const f of [unauth, actor, denied]) assert.equal(f.state.executed, 0);
});
test("receipt check, cancellation and replay of running/expired/settled work never execute", async () => {
  for (const mode of ["check", "cancel"]) {
    const f = fixture();
    f.state.receipt = { ...base, state: "cancelled" };
    assert.equal((await f.send({ request, mode })).status, 200);
    assert.equal(f.state.executed, 0);
  }
  for (const receipt of [
    { ...approved, state: "running" },
    { ...approved, state: "expired" },
    recorded,
    { ...base, state: "cancelled" },
  ]) {
    const f = fixture();
    f.state.receipt = receipt;
    assert.equal((await f.send()).status, 200);
    assert.equal(f.state.executed, 0);
  }
});
test("a lost execution reply is recovered from authenticated SQL, with no rerun", async () => {
  const f = fixture();
  f.state.lostExecution = true;
  assert.deepEqual(await (await f.send()).json(), { receipt: recorded });
  assert.equal(f.state.executed, 1);
});
test("receipt parser rejects invented success, wrong connection and missing failure revision", () => {
  for (const raw of [
    { ...recorded, verified_at: null },
    { ...recorded, revision: null },
    { ...recorded, connection_id: id(9) },
    { ...recorded, code: "access_denied" },
    { ...recorded, code: "access_denied", verified_at: null, revision: null },
    { ...recorded, code: "authority_changed", verified_at: null },
  ])
    assert.throws(() => parseVerificationReceipt(raw, request));
});
test("application applies through execution endpoint; check/cancel use RPC without invoking it", async () => {
  const calls: string[] = [];
  const db = {
    rpc: async (name: string) => {
      calls.push(name);
      return { data: recorded, error: null };
    },
    functions: {
      invoke: async (name: string) => {
        calls.push(name);
        return { data: { receipt: recorded, private_error: "never" }, error: null };
      },
    },
  };
  for (const mode of ["apply", "check", "cancel"] as const)
    assert.deepEqual(await resolveCommusoftVerification(db, request, mode), {
      receipt: recorded,
      retryAt: null,
    });
  assert.deepEqual(calls, [
    "learn-commusoft-verify",
    "learn_commusoft_verify_request",
    "learn_commusoft_verify_request",
  ]);
  db.functions.invoke = async () => {
    throw Error("private-error");
  };
  await assert.rejects(
    resolveCommusoftVerification(db, request, "apply"),
    (error) => error instanceof Error && !error.message.includes("private-error"),
  );
});
test("HTTP method/preflight handling invokes neither authorization nor provider", async () => {
  const f = fixture();
  assert.equal(
    (await f.handler(new Request("https://test.invalid", { method: "OPTIONS" }))).status,
    204,
  );
  assert.equal((await f.handler(new Request("https://test.invalid"))).status, 405);
  assert.equal(f.state.reads.length, 0);
  assert.equal(f.state.executed, 0);
});
