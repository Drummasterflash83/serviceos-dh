import test from "node:test";
import assert from "node:assert/strict";
import {
  readSlackContext,
  readSavedSlackContext,
  resolveSavedSlackContext,
  slackContextKey,
  type SavedSlackContext,
} from "./learn-slack-work-context.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { backend: "https://test.example.invalid", tenantId: id(1), actorId: id(2) };
const draft: SavedSlackContext = {
  version: 1,
  backend: scope.backend,
  request: {
    tenantId: id(1),
    actorId: id(2),
    interactionId: id(3),
    requestId: id(4),
    definition: { revision: "a".repeat(64), job_id: null, reason: "Retain company conversation" },
  },
};
const lock = async <T>(_key: string, task: () => Promise<T>) => task();
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
const result = (state: string) => ({
  version: "learn-slack-context-review/1",
  state,
  tenant_id: id(1),
  actor_id: id(2),
  interaction_id: id(3),
  request_id: id(4),
  definition: draft.request.definition,
  ...(state === "committed"
    ? {
        context: {
          version: "learn-slack-work-context/1",
          state: "reviewed",
          request_id: id(4),
          reviewed_by: id(2),
          reviewed_at: new Date().toISOString(),
          source_version: "b".repeat(64),
          job_id: null,
          scope: "company",
        },
        events_consumed: 1,
      }
    : {}),
});
test("lost response retains exact saved review and check resolves without another write", async () => {
  const s = store(),
    calls: string[] = [];
  let recorded = false;
  const db = {
    rpc: async (name: string, a: Record<string, unknown>) => {
      if (name === "current_user_is_openfolk_operator") return { data: true, error: null };
      assert.deepEqual(readSavedSlackContext(s, scope, id(3)), draft);
      calls.push(String(a.p_mode));
      if (a.p_mode === "apply") {
        recorded = true;
        throw Error("lost");
      }
      return { data: result(recorded ? "committed" : "pending"), error: null };
    },
  };
  await assert.rejects(
    resolveSavedSlackContext(db, s, lock, scope, id(3), draft, "apply", () => true),
  );
  assert.deepEqual(readSavedSlackContext(s, scope, id(3)), draft);
  assert.equal(
    (await resolveSavedSlackContext(db, s, lock, scope, id(3), draft, "check", () => true)).state,
    "committed",
  );
  assert.deepEqual(calls, ["check", "apply", "check"]);
  assert.equal(readSavedSlackContext(s, scope, id(3)), null);
});
test("cancel checks first and never overwrites an already committed decision", async () => {
  for (const committed of [true, false]) {
    const s = store();
    s.setItem(slackContextKey(scope, id(3)), JSON.stringify(draft));
    const calls: string[] = [];
    const db = {
      rpc: async (name: string, a: Record<string, unknown>) => {
        if (name === "current_user_is_openfolk_operator") return { data: true, error: null };
        calls.push(String(a.p_mode));
        return {
          data: result(committed ? "committed" : a.p_mode === "cancel" ? "cancelled" : "pending"),
          error: null,
        };
      },
    };
    assert.equal(
      (await resolveSavedSlackContext(db, s, lock, scope, id(3), draft, "cancel", () => true))
        .state,
      committed ? "committed" : "cancelled",
    );
    assert.deepEqual(calls, committed ? ["check"] : ["check", "cancel"]);
  }
});
test("incorrect receipt binding is never presented as success and keeps outbox", async () => {
  for (const patch of [
    { tenant_id: id(9) },
    { actor_id: id(9) },
    { interaction_id: id(9) },
    { request_id: id(9) },
    { definition: { ...draft.request.definition, job_id: id(9) } },
    { context: { ...result("committed").context, scope: "job" } },
    { events_consumed: -1 },
  ]) {
    const s = store();
    const db = {
      rpc: async (name: string) => ({
        data:
          name === "current_user_is_openfolk_operator"
            ? true
            : { ...result("committed"), ...patch },
        error: null,
      }),
    };
    await assert.rejects(
      resolveSavedSlackContext(db, s, lock, scope, id(3), draft, "apply", () => true),
    );
    assert.deepEqual(readSavedSlackContext(s, scope, id(3)), draft);
  }
});
test("failed storage, foreign context and revoked authority prevent writes", async () => {
  for (const condition of ["storage", "tenant", "actor", "backend", "message", "authority"]) {
    const s = store();
    let calls = 0;
    if (condition === "storage") s.setItem = () => {};
    const db = {
      rpc: async () => {
        calls++;
        return { data: false, error: null };
      },
    };
    const selected = {
      ...scope,
      ...(condition === "tenant"
        ? { tenantId: id(9) }
        : condition === "actor"
          ? { actorId: id(9) }
          : condition === "backend"
            ? { backend: "https://other.example.invalid" }
            : {}),
    };
    await assert.rejects(
      resolveSavedSlackContext(
        db,
        s,
        lock,
        selected,
        condition === "message" ? id(9) : id(3),
        draft,
        "apply",
        () => true,
      ),
    );
    assert.equal(calls, condition === "authority" ? 1 : 0);
  }
});
test("operator context change after receipt check prevents apply", async () => {
  const s = store(),
    calls: string[] = [];
  let allowed = true;
  const db = {
    rpc: async (name: string, a: Record<string, unknown>) => {
      if (name === "current_user_is_openfolk_operator") return { data: true, error: null };
      calls.push(String(a.p_mode));
      allowed = false;
      return { data: result("pending"), error: null };
    },
  };
  await assert.rejects(
    resolveSavedSlackContext(db, s, lock, scope, id(3), draft, "apply", () => allowed),
  );
  assert.deepEqual(calls, ["check"]);
  assert.ok(readSavedSlackContext(s, scope, id(3)));
});
test("reader rejects foreign, stale, malformed and mismatched job evidence", async () => {
  const base = {
    version: "learn-slack-context-state/1",
    tenant_id: id(1),
    actor_id: id(2),
    interaction_id: id(3),
    revision: "a".repeat(64),
    source_version: "b".repeat(64),
    audit_id: id(5),
    current_job_id: null,
    context: null,
    job: null,
    checked_at: new Date().toISOString(),
  };
  for (const patch of [
    { tenant_id: id(9) },
    { actor_id: id(9) },
    { interaction_id: id(9) },
    { checked_at: "2000-01-01" },
    { revision: "wrong" },
    { job: { id: id(9) } },
    { context: { state: "completed", scope: "company" } },
  ])
    await assert.rejects(
      readSlackContext(
        { rpc: async () => ({ data: { ...base, ...patch }, error: null }) },
        scope,
        id(3),
        null,
        "Inspect context",
      ),
    );
  const read = await readSlackContext(
    { rpc: async () => ({ data: { ...base, private_payload: "must not escape" }, error: null }) },
    scope,
    id(3),
    null,
    "Inspect context",
  );
  assert.equal("private_payload" in read, false);
});
