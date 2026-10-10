import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readSavedConnection,
  resolveSavedConnection,
  connectionOutboxKey,
  connectionResultMessage,
  type SavedConnectionRequest,
  type ConnectionControlClient,
} from "./learn-commusoft-connection-outbox.ts";
import { resolveSavedInput, type SavedInputRequest } from "./learn-operator-input-outbox.ts";
import { inputOutboxKey, type InputLock } from "./learn-operator-request-scope.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { tenantId: id(1), actorId: id(2), backend: "https://synthetic.invalid" };
const setup: SavedConnectionRequest = {
  version: 1,
  backend: scope.backend,
  request: {
    tenantId: id(1),
    actorId: id(2),
    requestId: id(3),
    definition: {
      kind: "configure_commusoft",
      reason: "Synthetic setup",
      region: "uk",
      account_key: "synthetic-account",
      expected_revision: null,
      credential_mode: "replace",
      same_account_confirmed: true,
    },
  },
};
const verification: SavedConnectionRequest = {
  ...setup,
  request: {
    ...setup.request,
    definition: {
      kind: "verify_commusoft",
      reason: "Synthetic check",
      connection_id: id(4),
      revision: "2026-10-10T12:00:00Z",
      one_read_confirmed: true,
    },
  },
};
const base = { tenant_id: id(1), request_id: id(3) };
const recorded = {
  ...base,
  state: "recorded",
  connection_id: id(4),
  revision: "2026-10-10T12:01:00Z",
  credential_bound: true,
  verification: "required",
};
function fixture() {
  const values = new Map<string, string>(),
    calls: { name: string; args: any }[] = [],
    locks: string[] = [];
  let next = { ...base, state: "pending" } as any;
  let fail = false;
  const store = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const lock: InputLock = async (key, task) => {
    locks.push(key);
    return task();
  };
  const db: ConnectionControlClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (args.p_mode === "apply") {
        next = recorded;
        if (fail) throw Error("SYNTHETIC_KEY_MUST_NOT_LEAK");
      } else if (args.p_mode === "cancel") next = { ...base, state: "cancelled" };
      return { data: next, error: null };
    },
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, args: options.body });
        return { data: { receipt: next }, error: null };
      },
    },
  };
  return {
    values,
    calls,
    locks,
    store,
    lock,
    db,
    setReceipt: (r: any) => {
      next = r;
    },
    loseReply: () => {
      fail = true;
    },
    run: (
      input = setup,
      mode: "apply" | "check" | "cancel" = "apply",
      key?: string,
      allowed = () => true,
    ) => resolveSavedConnection(db, store, lock, scope, input, mode, allowed, key),
  };
}
test("replacement key is transient; lost reply recovers without resubmitting or re-entering it", async () => {
  const f = fixture();
  f.loseReply();
  await assert.rejects(
    f.run(setup, "apply", "SYNTHETIC_KEY_MUST_NOT_LEAK"),
    (e) => e instanceof Error && !e.message.includes("SYNTHETIC_KEY"),
  );
  assert.ok(f.values.has(connectionOutboxKey(scope)));
  assert.ok(![...f.values.values()].join().includes("SYNTHETIC_KEY"));
  assert.deepEqual(readSavedConnection(f.store, scope), setup);
  assert.equal((await f.run(setup, "check")).receipt.state, "recorded");
  assert.equal(f.calls.filter((c) => c.args.p_mode === "apply").length, 1);
  assert.equal(f.values.size, 0);
  assert.deepEqual(f.locks, [inputOutboxKey(scope), inputOutboxKey(scope)]);
});
test("an unrecorded replacement needs a re-entered key; cancellation never sends it", async () => {
  const f = fixture();
  await assert.rejects(f.run(), /Enter the credential again/);
  assert.equal(f.calls.length, 1);
  assert.ok(readSavedConnection(f.store, scope));
  assert.equal((await f.run(setup, "cancel")).receipt.state, "cancelled");
  assert.equal(f.calls.at(-1)?.args.p_api_key, null);
  assert.equal(f.values.size, 0);
});
test("unknown fields cannot smuggle a key into persisted request metadata", async () => {
  for (const input of [
    { ...setup, api_key: "secret" },
    { ...setup, request: { ...setup.request, api_key: "secret" } },
    {
      ...setup,
      request: { ...setup.request, definition: { ...setup.request.definition, api_key: "secret" } },
    },
  ]) {
    const f = fixture();
    await assert.rejects(f.run(input as SavedConnectionRequest));
    assert.equal(f.values.size, 0);
    assert.equal(f.calls.length, 0);
  }
});
test("storage failure, changed actor/backend and conflicting requests never send a write", async () => {
  const f = fixture();
  f.store.setItem = () => {
    throw Error("storage unavailable");
  };
  await assert.rejects(f.run());
  assert.equal(f.calls.length, 0);
  const g = fixture();
  g.values.set(connectionOutboxKey(scope), JSON.stringify(setup));
  await assert.rejects(g.run({ ...setup, request: { ...setup.request, requestId: id(7) } }));
  g.values.set(
    connectionOutboxKey(scope),
    JSON.stringify({ ...setup, backend: "https://other.invalid" }),
  );
  assert.throws(() => readSavedConnection(g.store, scope));
  assert.equal(g.calls.length, 0);
});
test("module/import and connection recovery share a lock and block each other's unresolved requests", async () => {
  const f = fixture();
  const input: SavedInputRequest = {
    version: 1,
    backend: scope.backend,
    request: {
      tenantId: id(1),
      actorId: id(2),
      requestId: id(8),
      definition: {
        kind: "set_modules",
        reason: "Synthetic change",
        expected: { "learn.enabled": null, "learn.inputs.commusoft.enabled": null },
        values: { "learn.enabled": true, "learn.inputs.commusoft.enabled": true },
      },
    },
  };
  f.values.set(inputOutboxKey(scope), JSON.stringify(input));
  await assert.rejects(f.run(), /module or import request/);
  assert.equal(f.calls.length, 0);
  f.values.delete(inputOutboxKey(scope));
  f.values.set(connectionOutboxKey(scope), JSON.stringify(setup));
  await assert.rejects(
    resolveSavedInput(f.db, f.store, f.lock, scope, input, "apply", () => true),
    /saved connection request/,
  );
  assert.equal(f.calls.length, 0);
  assert.ok(f.locks.every((key) => key === inputOutboxKey(scope)));
});
test("running and expired checks are retained, never re-executed on retry", async () => {
  for (const state of ["running", "expired"]) {
    const f = fixture();
    f.setReceipt({ ...base, state, expires_at: "2026-10-10T12:02:00Z" });
    const result = await f.run(verification);
    assert.equal(result.receipt.state, state);
    assert.ok(readSavedConnection(f.store, scope));
    assert.equal(f.calls.length, 1);
    assert.ok(!f.calls.some((c) => c.name === "learn-commusoft-verify"));
    assert.equal((await f.run(verification, "cancel")).receipt.state, "cancelled");
  }
});
test("approved checks retry only on explicit apply; checks work without execution client", async () => {
  const f = fixture();
  f.setReceipt({ ...base, state: "approved", expires_at: "2026-10-10T12:02:00Z" });
  await f.run(verification);
  assert.equal(f.calls.filter((c) => c.name === "learn-commusoft-verify").length, 1);
  delete f.db.functions;
  await f.run(verification, "check");
  assert.equal(f.calls.filter((c) => c.name === "learn-commusoft-verify").length, 1);
  assert.ok(readSavedConnection(f.store, scope));
});
test("scope changes after a recorded result retain recovery metadata", async () => {
  const f = fixture();
  let checks = 0;
  f.setReceipt(recorded);
  await assert.rejects(
    f.run(setup, "apply", undefined, () => ++checks < 3),
    /saved context changed/,
  );
  assert.ok(readSavedConnection(f.store, scope));
});
test("failure messages distinguish saved configuration, access failure and unconfirmed work", () => {
  assert.match(
    connectionResultMessage({ kind: "configure_commusoft", receipt: recorded as any }),
    /Run the access check/,
  );
  assert.match(
    connectionResultMessage({
      kind: "verify_commusoft",
      retryAt: null,
      receipt: {
        ...base,
        state: "recorded",
        connection_id: id(4),
        code: "authentication_required",
        verified_at: null,
        revision: "2026-10-10T12:00:00Z",
      },
    }),
    /did not accept/,
  );
});
