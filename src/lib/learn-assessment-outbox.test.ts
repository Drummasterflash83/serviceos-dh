import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessmentOutboxKey,
  prepareAssessmentDraft,
  readAssessmentDraft,
  recoverAssessmentDraft,
} from "./learn-assessment-outbox.ts";
import type { AssessmentClient, SaveAssessmentRequest } from "./learn-assessments.ts";
import type { RecoveryLock } from "./learn-slack-recovery-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  backend: "https://test.supabase.co",
  tenantId: id(1),
  actorId: id(2),
  subject: { kind: "member" as const, id: id(3) },
};
const request: SaveAssessmentRequest = {
  tenantId: scope.tenantId,
  requestId: id(4),
  publicationId: id(5),
  subject: scope.subject,
  groupId: null,
  period: { start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" },
  expected: [{ id: id(6), reviewRevision: 3 }],
  reason: "Evidence checked",
};
const draft = () => prepareAssessmentDraft(scope, structuredClone(request));
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function fixture() {
  const store = storage();
  let state = "pending",
    saves = 0,
    tail = Promise.resolve();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const lock: RecoveryLock = async (_, task) => {
    const prior = tail;
    let done!: () => void;
    tail = new Promise<void>((r) => {
      done = r;
    });
    await prior;
    try {
      return await task();
    } finally {
      done();
    }
  };
  const db: AssessmentClient = {
    rpc: async (name, args) => {
      assert.ok(
        store.getItem(assessmentOutboxKey(scope)),
        "request must be stored before any call",
      );
      calls.push({ name, args });
      if (name === "learn_assessment_save") {
        assert.notEqual(state, "cancelled");
        state = "recorded";
        saves++;
        return {
          data: {
            assessmentId: request.requestId,
            recordedAt: "2026-01-03T00:00:00Z",
            reused: false,
          },
          error: null,
        };
      }
      if (args.p_cancel && state === "pending") state = "cancelled";
      return {
        data: {
          state,
          assessmentId: request.requestId,
          tenantId: scope.tenantId,
          actorId: scope.actorId,
          ...(state === "recorded" ? { recordedAt: "2026-01-03T00:00:00Z" } : {}),
        },
        error: null,
      };
    },
  };
  return {
    store,
    db,
    lock,
    calls,
    saves: () => saves,
    recorded: () => {
      state = "recorded";
    },
  };
}
test("refresh restores the exact request; lost response recovers without a duplicate or changed evidence", async () => {
  const f = fixture();
  let fail = true;
  const db: AssessmentClient = {
    rpc: async (name, args) => {
      const result = await f.db.rpc(name, args);
      if (name === "learn_assessment_save" && fail) {
        fail = false;
        throw Error("lost response");
      }
      return result;
    },
  };
  await assert.rejects(
    recoverAssessmentDraft(db, f.store, f.lock, scope, draft(), "save", () => true),
    /lost response/,
  );
  const restored = readAssessmentDraft(f.store, scope)!;
  assert.deepEqual(restored, draft());
  assert.equal(
    (await recoverAssessmentDraft(db, f.store, f.lock, scope, restored, "save", () => true)).state,
    "recorded",
  );
  assert.equal(f.saves(), 1);
  assert.equal(readAssessmentDraft(f.store, scope), null);
  assert.equal(f.calls[1].args.p_publication, request.publicationId);
  assert.deepEqual(f.calls[1].args.p_expected, request.expected);
  assert.ok(!("score" in f.calls[1].args));
});
test("status checks retain a pending request and never submit a save", async () => {
  const f = fixture();
  assert.equal(
    (await recoverAssessmentDraft(f.db, f.store, f.lock, scope, draft(), "check", () => true))
      .state,
    "pending",
  );
  assert.equal(f.saves(), 0);
  assert.ok(readAssessmentDraft(f.store, scope));
});
test("cancel clears only a confirmed cancellation; an already completed save remains recorded", async () => {
  for (const recorded of [false, true]) {
    const f = fixture();
    if (recorded) f.recorded();
    assert.equal(
      (await recoverAssessmentDraft(f.db, f.store, f.lock, scope, draft(), "cancel", () => true))
        .state,
      recorded ? "recorded" : "cancelled",
    );
    assert.equal(f.saves(), 0);
    assert.equal(readAssessmentDraft(f.store, scope), null);
  }
});
test("two tabs retrying the same request serialize and recover one assessment", async () => {
  const f = fixture();
  const results = await Promise.all(
    [1, 2].map(() =>
      recoverAssessmentDraft(f.db, f.store, f.lock, scope, draft(), "save", () => true),
    ),
  );
  assert.ok(results.every((r) => r.state === "recorded"));
  assert.equal(f.saves(), 1);
});
test("storage write failure or lost write prevents any server request", async () => {
  for (const throwing of [false, true]) {
    const f = fixture();
    f.store.setItem = () => {
      if (throwing) throw Error("full");
    };
    await assert.rejects(
      recoverAssessmentDraft(f.db, f.store, f.lock, scope, draft(), "save", () => true),
    );
    assert.equal(f.calls.length, 0);
  }
});
test("scope isolates backend, actor, company and card, and rejects a foreign draft", async () => {
  const f = fixture();
  f.store.setItem(assessmentOutboxKey(scope), JSON.stringify(draft()));
  for (const changed of [
    { ...scope, backend: "https://prod.supabase.co" },
    { ...scope, actorId: id(9) },
    { ...scope, tenantId: id(9) },
    { ...scope, subject: { ...scope.subject, id: id(9) } },
  ]) {
    assert.equal(readAssessmentDraft(f.store, changed), null);
    await assert.rejects(
      recoverAssessmentDraft(f.db, f.store, f.lock, changed, draft(), "save", () => true),
    );
  }
  assert.equal(f.calls.length, 0);
});
test("malformed, oversized or enriched stored requests fail closed without removal", () => {
  const f = fixture(),
    key = assessmentOutboxKey(scope);
  for (const raw of [
    "{",
    "x".repeat(100001),
    JSON.stringify({ ...draft(), version: 2 }),
    JSON.stringify({ ...draft(), request: { ...request, score: 100 } }),
    JSON.stringify({ ...draft(), request: { ...request, expected: [null] } }),
  ]) {
    f.store.setItem(key, raw);
    assert.throws(() => readAssessmentDraft(f.store, scope));
    assert.equal(f.store.getItem(key), raw);
  }
});
test("stale evidence or unauthorized response keeps the exact request for check/cancel", async () => {
  for (const code of ["PT409", "42501", "40001"]) {
    const f = fixture();
    const db: AssessmentClient = {
      rpc: async (n, a) =>
        n === "learn_assessment_save" ? { data: null, error: { code } } : f.db.rpc(n, a),
    };
    await assert.rejects(
      recoverAssessmentDraft(db, f.store, f.lock, scope, draft(), "save", () => true),
    );
    assert.deepEqual(readAssessmentDraft(f.store, scope), draft());
  }
});
test("foreign, incomplete and impossible outcome receipts cannot clear recovery", async () => {
  for (const change of [
    { tenantId: id(9) },
    { actorId: id(9) },
    { assessmentId: id(9) },
    { state: "unknown" },
    { state: "recorded", recordedAt: null },
    { state: "pending" },
  ]) {
    const f = fixture();
    const db: AssessmentClient = {
      rpc: async () => ({
        data: {
          state: "cancelled",
          tenantId: scope.tenantId,
          actorId: scope.actorId,
          assessmentId: request.requestId,
          ...change,
        },
        error: null,
      }),
    };
    await assert.rejects(
      recoverAssessmentDraft(db, f.store, f.lock, scope, draft(), "cancel", () => true),
    );
    assert.ok(readAssessmentDraft(f.store, scope));
  }
});
test("closing the card while checking keeps the request and prevents a follow-up save", async () => {
  const f = fixture();
  let allowed = true;
  const db: AssessmentClient = {
    rpc: async (n, a) => {
      const r = await f.db.rpc(n, a);
      allowed = false;
      return r;
    },
  };
  await assert.rejects(
    recoverAssessmentDraft(db, f.store, f.lock, scope, draft(), "save", () => allowed),
    /closed/,
  );
  assert.equal(f.saves(), 0);
  assert.ok(readAssessmentDraft(f.store, scope));
});
test("replacement browser request is not overwritten or removed", async () => {
  const f = fixture(),
    other = prepareAssessmentDraft(scope, { ...request, requestId: id(9) }),
    key = assessmentOutboxKey(scope);
  f.store.setItem(key, JSON.stringify(other));
  await assert.rejects(
    recoverAssessmentDraft(f.db, f.store, f.lock, scope, draft(), "save", () => true),
    /Another/,
  );
  assert.equal(f.calls.length, 0);
  f.store.removeItem(key);
  const db: AssessmentClient = {
    rpc: async (n, a) => {
      const r = await f.db.rpc(n, a);
      f.store.setItem(key, JSON.stringify(other));
      return r;
    },
  };
  await assert.rejects(
    recoverAssessmentDraft(db, f.store, f.lock, scope, draft(), "cancel", () => true),
    /changed/,
  );
  assert.deepEqual(readAssessmentDraft(f.store, scope), other);
});
test("failed local clearing remains recoverable without repeating the save", async () => {
  const f = fixture(),
    remove = f.store.removeItem;
  f.store.removeItem = () => {};
  await assert.rejects(
    recoverAssessmentDraft(f.db, f.store, f.lock, scope, draft(), "save", () => true),
    /browser recovery/,
  );
  assert.ok(readAssessmentDraft(f.store, scope));
  f.store.removeItem = remove;
  await recoverAssessmentDraft(f.db, f.store, f.lock, scope, draft(), "check", () => true);
  assert.equal(f.saves(), 1);
  assert.equal(readAssessmentDraft(f.store, scope), null);
});

test("browser replacement during the status read prevents a subsequent save", async () => {
  const f = fixture(),
    other = prepareAssessmentDraft(scope, { ...request, requestId: id(9) });
  const db: AssessmentClient = {
    rpc: async (n, a) => {
      const r = await f.db.rpc(n, a);
      f.store.setItem(assessmentOutboxKey(scope), JSON.stringify(other));
      return r;
    },
  };
  await assert.rejects(
    recoverAssessmentDraft(db, f.store, f.lock, scope, draft(), "save", () => true),
    /changed/,
  );
  assert.equal(f.saves(), 0);
  assert.deepEqual(readAssessmentDraft(f.store, scope), other);
});
