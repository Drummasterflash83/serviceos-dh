import test from "node:test";
import assert from "node:assert/strict";
import {
  readCommusoftRecurring,
  resolveCommusoftRecurring,
  resolveSavedCommusoftRecurring,
  readSavedCommusoftRecurring,
  commusoftRecurringOutboxKey,
  type SavedCommusoftRecurring,
} from "./learn-commusoft-recurring.ts";
import { inputOutboxKey } from "./learn-operator-request-scope.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { backend: "https://test.example.invalid", tenantId: id(1), actorId: id(2) };
const draft: SavedCommusoftRecurring = {
  version: 1,
  backend: scope.backend,
  request: {
    tenantId: id(1),
    actorId: id(2),
    requestId: id(3),
    definition: {
      account_id: id(4),
      expected_revision: 0,
      enabled: true,
      max_pages: 2000,
      page_size: 50,
      reason: "Reviewed full recurring capture",
    },
  },
};
const lock = async <T>(_key: string, task: () => Promise<T>) => task();
function store() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
  };
}
const pending = { state: "pending", request_id: id(3) },
  recorded = {
    state: "recorded",
    request_id: id(3),
    account_id: id(4),
    enabled: true,
    revision: 1,
  };
const row = {
  account_id: id(4),
  tenant_id: id(1),
  connection_id: id(5),
  approved_by: id(2),
  enabled: true,
  revision: 1,
  max_pages: 2000,
  page_size: 50,
  watermark: null,
  cycle_start: null,
  cycle_end: null,
  phase: 0,
  current_request: null,
  last_state: "approved",
  next_check_at: "2026-10-12T20:00:00Z",
  updated_at: "2026-10-12T20:00:00Z",
};
test("reader rejects wrong tenants, duplicate rows, unknown states and incomplete metadata", async () => {
  for (const accounts of [
    [{ ...row, tenant_id: id(9) }],
    [row, row],
    [{ ...row, last_state: "done" }],
    [{ ...row, watermark: "yesterday" }],
    [{ ...row, revision: 0 }],
  ]) {
    await assert.rejects(
      readCommusoftRecurring(
        {
          rpc: async () => ({
            data: { tenant_id: id(1), checked_at: row.updated_at, accounts },
            error: null,
          }),
        },
        id(1),
      ),
    );
  }
  const d = await readCommusoftRecurring(
    {
      rpc: async () => ({
        data: {
          tenant_id: id(1),
          checked_at: row.updated_at,
          accounts: [{ ...row, current_definition: { secret: "must not pass through" } }],
        },
        error: null,
      }),
    },
    id(1),
  );
  assert.deepEqual(d.accounts, [row]);
});
test("lost apply response retains exact request, then check reconciles without replay", async () => {
  const s = store();
  let committed = false;
  const calls: string[] = [];
  const db = {
    rpc: async (name: string, a: Record<string, unknown>) => {
      if (name === "current_user_is_openfolk_operator") return { data: true, error: null };
      assert.ok(readSavedCommusoftRecurring(s, scope));
      calls.push(String(a.p_mode));
      if (a.p_mode === "apply") {
        committed = true;
        throw Error("lost response");
      }
      return { data: committed ? recorded : pending, error: null };
    },
  };
  await assert.rejects(
    resolveSavedCommusoftRecurring(db, s, lock, scope, draft, "apply", () => true),
  );
  assert.deepEqual(readSavedCommusoftRecurring(s, scope), draft);
  assert.equal(
    (await resolveSavedCommusoftRecurring(db, s, lock, scope, draft, "check", () => true)).state,
    "recorded",
  );
  assert.deepEqual(calls, ["check", "apply", "check"]);
  assert.equal(readSavedCommusoftRecurring(s, scope), null);
});
test("storage failure, competing import and lost authority send no control writes", async () => {
  for (const condition of ["storage", "import", "authority"]) {
    const s = store();
    let writes = 0;
    if (condition === "storage") s.setItem = () => {};
    if (condition === "import") s.setItem(inputOutboxKey(scope), "retained");
    const db = {
      rpc: async () => {
        writes++;
        return { data: false, error: null };
      },
    };
    await assert.rejects(
      resolveSavedCommusoftRecurring(db, s, lock, scope, draft, "apply", () => true),
    );
    assert.equal(writes, condition === "authority" ? 1 : 0);
  }
});
test("tenant/backend mismatch and malformed limits fail before calling the backend", async () => {
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return { data: null, error: null };
    },
  };
  await assert.rejects(
    resolveSavedCommusoftRecurring(
      db,
      store(),
      lock,
      { ...scope, tenantId: id(9) },
      draft,
      "apply",
      () => true,
    ),
  );
  for (const d of [
    { max_pages: 0 },
    { page_size: 101 },
    { expected_revision: 1.5 },
    { reason: "" },
  ])
    await assert.rejects(
      resolveCommusoftRecurring(
        db,
        { ...draft.request, definition: { ...draft.request.definition, ...d } },
        "apply",
      ),
    );
  assert.equal(calls, 0);
});
test("changed context after precheck prevents apply; mismatched receipt remains saved", async () => {
  const s = store();
  let allowed = true;
  const calls: string[] = [];
  const db = {
    rpc: async (name: string, a: Record<string, unknown>) => {
      if (name === "current_user_is_openfolk_operator") return { data: true, error: null };
      calls.push(String(a.p_mode));
      allowed = false;
      return { data: pending, error: null };
    },
  };
  await assert.rejects(
    resolveSavedCommusoftRecurring(db, s, lock, scope, draft, "apply", () => allowed),
  );
  assert.deepEqual(calls, ["check"]);
  assert.ok(s.getItem(commusoftRecurringOutboxKey(scope)));
  const bad = {
    rpc: async (name: string) => ({
      data:
        name === "current_user_is_openfolk_operator" ? true : { ...recorded, account_id: id(9) },
      error: null,
    }),
  };
  await assert.rejects(
    resolveSavedCommusoftRecurring(bad, s, lock, scope, draft, "check", () => true),
  );
  assert.ok(readSavedCommusoftRecurring(s, scope));
});
test("cancel checks first and never undoes an already recorded approval", async () => {
  const s = store();
  s.setItem(commusoftRecurringOutboxKey(scope), JSON.stringify(draft));
  const modes: string[] = [];
  const db = {
    rpc: async (name: string, a: Record<string, unknown>) => {
      if (name === "current_user_is_openfolk_operator") return { data: true, error: null };
      modes.push(String(a.p_mode));
      return { data: recorded, error: null };
    },
  };
  assert.equal(
    (await resolveSavedCommusoftRecurring(db, s, lock, scope, draft, "cancel", () => true)).state,
    "recorded",
  );
  assert.deepEqual(modes, ["check"]);
});
