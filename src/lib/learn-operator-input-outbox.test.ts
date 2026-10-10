import test from "node:test";
import assert from "node:assert/strict";
import {
  inputOutboxKey,
  readSavedInput,
  resolveSavedInput,
  type InputLock,
  type SavedInputRequest,
} from "./learn-operator-input-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { backend: "https://synthetic.example.invalid", tenantId: id(1), actorId: id(2) };
const saved: SavedInputRequest = {
  version: 1,
  backend: scope.backend,
  request: {
    tenantId: id(1),
    actorId: id(2),
    requestId: id(3),
    definition: {
      kind: "set_modules",
      reason: "Reviewed change",
      expected: { "learn.enabled": null, "learn.inputs.commusoft.enabled": null },
      values: { "learn.enabled": true, "learn.inputs.commusoft.enabled": true },
    },
  },
};
const immediate: InputLock = async (_, fn) => fn();
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}
test("a lost apply reply survives reload and is resolved by reading the retained receipt", async () => {
  const store = storage();
  let receipt: any = null,
    writes = 0;
  const modes: string[] = [];
  const db = {
    rpc: async (_: string, args: Record<string, unknown>) => {
      modes.push(String(args.p_mode));
      assert.ok(store.getItem(inputOutboxKey(scope)));
      if (args.p_mode === "apply") {
        writes++;
        receipt = {
          tenant_id: id(1),
          request_id: id(3),
          state: "recorded",
          kind: "set_modules",
          flags:
            saved.request.definition.kind === "set_modules"
              ? saved.request.definition.values
              : null,
        };
        throw Error("Lost response");
      }
      return {
        data: receipt ?? { tenant_id: id(1), request_id: id(3), state: "pending" },
        error: null,
      };
    },
  };
  await assert.rejects(resolveSavedInput(db, store, immediate, scope, saved, "apply", () => true));
  const reloaded = readSavedInput(store, scope);
  assert.deepEqual(reloaded, saved);
  assert.equal(
    (await resolveSavedInput(db, store, immediate, scope, reloaded!, "check", () => true)).state,
    "recorded",
  );
  assert.equal(writes, 1);
  assert.deepEqual(modes, ["check", "apply", "check"]);
  assert.equal(readSavedInput(store, scope), null);
});
test("failed storage, changed contexts and conflicting pending work prevent new requests", async () => {
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: null, error: null };
    },
  };
  const broken = {
    ...storage(),
    setItem() {
      throw Error("Storage denied");
    },
  };
  await assert.rejects(resolveSavedInput(db, broken, immediate, scope, saved, "apply", () => true));
  const store = storage();
  await assert.rejects(resolveSavedInput(db, store, immediate, scope, saved, "apply", () => false));
  store.setItem(inputOutboxKey(scope), JSON.stringify(saved));
  await assert.rejects(
    resolveSavedInput(
      db,
      store,
      immediate,
      scope,
      { ...saved, request: { ...saved.request, requestId: id(4) } },
      "apply",
      () => true,
    ),
  );
  assert.equal(calls, 0);
  assert.deepEqual(readSavedInput(store, scope), saved);
});
test("receipt failures and absent receipts never delete saved work", async () => {
  const store = storage();
  store.setItem(inputOutboxKey(scope), JSON.stringify(saved));
  const pending = {
    rpc: async () => ({
      data: { tenant_id: id(1), request_id: id(3), state: "pending" },
      error: null,
    }),
  };
  assert.equal(
    (await resolveSavedInput(pending, store, immediate, scope, saved, "check", () => true)).state,
    "pending",
  );
  await assert.rejects(
    resolveSavedInput(
      { rpc: async () => ({ data: null, error: { code: "42501" } }) },
      store,
      immediate,
      scope,
      saved,
      "check",
      () => true,
    ),
  );
  assert.deepEqual(readSavedInput(store, scope), saved);
});
test("cancellation records a server outcome and clears only its matching local request", async () => {
  const store = storage();
  store.setItem(inputOutboxKey(scope), JSON.stringify(saved));
  const modes: string[] = [];
  const db = {
    rpc: async (_: string, a: Record<string, unknown>) => {
      modes.push(String(a.p_mode));
      return {
        error: null,
        data: {
          tenant_id: id(1),
          request_id: id(3),
          state: a.p_mode === "check" ? "pending" : "cancelled",
        },
      };
    },
  };
  assert.equal(
    (await resolveSavedInput(db, store, immediate, scope, saved, "cancel", () => true)).state,
    "cancelled",
  );
  assert.deepEqual(modes, ["check", "cancel"]);
  assert.equal(readSavedInput(store, scope), null);
});
test("corrupted or foreign saved requests are retained and cannot be sent", () => {
  const store = storage(),
    key = inputOutboxKey(scope);
  for (const value of [
    "broken",
    JSON.stringify({ ...saved, backend: "https://other.invalid" }),
    JSON.stringify({ ...saved, request: { ...saved.request, actorId: id(9) } }),
  ]) {
    store.setItem(key, value);
    assert.throws(() => readSavedInput(store, scope));
    assert.equal(store.getItem(key), value);
  }
});
test("a competing storage change during a reply is not cleared", async () => {
  const store = storage();
  store.setItem(inputOutboxKey(scope), JSON.stringify(saved));
  const other = { ...saved, request: { ...saved.request, requestId: id(4) } };
  const db = {
    rpc: async () => {
      store.setItem(inputOutboxKey(scope), JSON.stringify(other));
      return { error: null, data: { tenant_id: id(1), request_id: id(3), state: "cancelled" } };
    },
  };
  await assert.rejects(resolveSavedInput(db, store, immediate, scope, saved, "check", () => true));
  assert.deepEqual(readSavedInput(store, scope), other);
});
