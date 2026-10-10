import test from "node:test";
import assert from "node:assert/strict";
import {
  captureFlags,
  readCaptureControls,
  resolveCaptureControl,
  resolveSavedCapture,
  readSavedCapture,
  type CaptureControls,
  type SavedCapture,
} from "./learn-operator-capture-controls.ts";
import {
  captureOutboxKey,
  inputOutboxKey,
  connectionOutboxKey,
  type InputLock,
} from "./learn-operator-request-scope.ts";
import { resolveSavedInput, type SavedInputRequest } from "./learn-operator-input-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { backend: "https://synthetic.invalid", tenantId: id(1), actorId: id(2) };
const values = {
  "learn.enabled": true,
  "learn.inputs.email.enabled": false,
  "learn.inputs.phone.enabled": true,
  "learn.inputs.slack.enabled": false,
};
const controls: CaptureControls = {
  version: "learn-capture-controls/1",
  tenant_id: id(1),
  revision: "a".repeat(32),
  flags: values,
  sources: {
    email: { allowed: false, inherited: false, invalid: false },
    phone: { allowed: true, inherited: false, invalid: false },
    slack: { allowed: false, inherited: false, invalid: false },
  },
};
const input: SavedCapture = {
  version: 1,
  backend: scope.backend,
  request: {
    tenantId: id(1),
    actorId: id(2),
    requestId: id(3),
    definition: { reason: "Reviewed synthetic pause", revision: "a".repeat(32), values },
  },
};
const immediate: InputLock = async (key, fn) => {
  assert.equal(key, inputOutboxKey(scope));
  return fn();
};
function store() {
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
const receipt = (state = "recorded") => ({
  tenant_id: id(1),
  request_id: id(3),
  state,
  ...(state === "recorded" ? { controls } : {}),
});
test("control reads reject foreign tenants, contradictory permission and malformed snapshots", async () => {
  const db = (data: unknown) => ({ rpc: async () => ({ data, error: null }) });
  assert.deepEqual(await readCaptureControls(db(controls), id(1)), controls);
  for (const data of [
    { ...controls, tenant_id: id(8) },
    { ...controls, revision: "unknown" },
    { ...controls, flags: { ...values, "learn.enabled": false } },
    {
      ...controls,
      sources: { ...controls.sources, phone: { allowed: true, invalid: true, inherited: false } },
    },
  ])
    await assert.rejects(readCaptureControls(db(data), id(1)));
});
test("recorded receipts must match the saved tenant, request and all requested switches", async () => {
  for (const data of [
    receipt(),
    { ...receipt(), tenant_id: id(8) },
    { ...receipt(), request_id: id(9) },
    {
      ...receipt(),
      controls: { ...controls, flags: { ...values, "learn.inputs.email.enabled": true } },
    },
  ]) {
    const db = { rpc: async () => ({ data, error: null }) };
    if (data.tenant_id === id(1) && data.request_id === id(3) && data.controls === controls)
      assert.equal((await resolveCaptureControl(db, input.request, "check")).state, "recorded");
    else await assert.rejects(resolveCaptureControl(db, input.request, "check"));
  }
});
test("lost write reply stays saved; reload checks its receipt without a second apply", async () => {
  const storage = store();
  let applied = false;
  const modes: string[] = [];
  const db = {
    rpc: async (_: string, args: Record<string, unknown>) => {
      assert.ok(storage.getItem(captureOutboxKey(scope)));
      modes.push(String(args.p_mode));
      if (args.p_mode === "apply") {
        applied = true;
        throw Error("PRIVATE TRANSPORT DETAIL");
      }
      return { data: receipt(applied ? "recorded" : "pending"), error: null };
    },
  };
  await assert.rejects(
    resolveSavedCapture(db, storage, immediate, scope, input, "apply", () => true),
    (e) => !String(e).includes("PRIVATE"),
  );
  assert.deepEqual(readSavedCapture(storage, scope), input);
  await resolveSavedCapture(db, storage, immediate, scope, input, "check", () => true);
  assert.deepEqual(modes, ["check", "apply", "check"]);
  assert.equal(readSavedCapture(storage, scope), null);
});
test("stale revision remains saved until an explicit cancel records a terminal receipt", async () => {
  const storage = store(),
    modes: unknown[] = [];
  const db = {
    rpc: async (_: string, a: Record<string, unknown>) => {
      modes.push(a.p_mode);
      return a.p_mode === "apply"
        ? { data: null, error: { message: "learn_capture_flags_changed" } }
        : { data: receipt(a.p_mode === "cancel" ? "cancelled" : "pending"), error: null };
    },
  };
  await assert.rejects(
    resolveSavedCapture(db, storage, immediate, scope, input, "apply", () => true),
    /Settings changed/,
  );
  assert.ok(readSavedCapture(storage, scope));
  await resolveSavedCapture(db, storage, immediate, scope, input, "cancel", () => true);
  assert.deepEqual(modes, ["check", "apply", "check", "cancel"]);
  assert.equal(readSavedCapture(storage, scope), null);
});
test("storage failures, changed actors and other saved work prevent an apply", async () => {
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: receipt("pending"), error: null };
    },
  };
  const storage = store();
  await assert.rejects(
    resolveSavedCapture(
      db,
      {
        ...storage,
        setItem() {
          throw Error("full");
        },
      },
      immediate,
      scope,
      input,
      "apply",
      () => true,
    ),
  );
  await assert.rejects(
    resolveSavedCapture(
      db,
      storage,
      immediate,
      { ...scope, actorId: id(8) },
      input,
      "apply",
      () => true,
    ),
  );
  await assert.rejects(
    resolveSavedCapture(db, storage, immediate, scope, input, "apply", () => false),
  );
  for (const key of [inputOutboxKey(scope), connectionOutboxKey(scope)]) {
    storage.setItem(key, "retained request");
    await assert.rejects(
      resolveSavedCapture(db, storage, immediate, scope, input, "apply", () => true),
    );
    storage.removeItem(key);
  }
  assert.equal(calls, 0);
});
test("saved capture work blocks legacy module writes but does not prevent checking a saved receipt", async () => {
  const storage = store();
  storage.setItem(captureOutboxKey(scope), JSON.stringify(input));
  const legacy: SavedInputRequest = {
    version: 1,
    backend: scope.backend,
    request: {
      tenantId: id(1),
      actorId: id(2),
      requestId: id(4),
      definition: {
        kind: "set_modules",
        reason: "synthetic",
        expected: { "learn.enabled": true, "learn.inputs.commusoft.enabled": true },
        values: { "learn.enabled": true, "learn.inputs.commusoft.enabled": false },
      },
    },
  };
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: { tenant_id: id(1), request_id: id(4), state: "pending" }, error: null };
    },
  };
  await assert.rejects(
    resolveSavedInput(db, storage, immediate, scope, legacy, "apply", () => true),
  );
  assert.equal(calls, 0);
  storage.setItem(inputOutboxKey(scope), JSON.stringify(legacy));
  await resolveSavedInput(db, storage, immediate, scope, legacy, "check", () => true);
  assert.equal(calls, 1);
});
test("missing explicit switch choices and malformed saved metadata never reach the server", async () => {
  for (const flag of captureFlags) {
    let calls = 0;
    const db = {
      rpc: async () => {
        calls++;
        return { data: null, error: null };
      },
    };
    await assert.rejects(
      resolveCaptureControl(
        db,
        {
          ...input.request,
          definition: { ...input.request.definition, values: { ...values, [flag]: null } as any },
        },
        "apply",
      ),
    );
    assert.equal(calls, 0);
  }
  const storage = store();
  storage.setItem(captureOutboxKey(scope), "broken-json");
  assert.throws(() => readSavedCapture(storage, scope));
  assert.equal(storage.getItem(captureOutboxKey(scope)), "broken-json");
});
