import test from "node:test";
import assert from "node:assert/strict";
import {
  loadWorkPage,
  readWorkDraft,
  resolveWorkDraft,
  workOutboxKey,
  type WorkDraft,
} from "./learn-commusoft-work.ts";
import type { ReviewClient } from "./learn-commusoft-review.ts";
import type { RecoveryLock } from "./learn-slack-recovery-outbox.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { backend: "https://fixture.invalid", tenantId: id(1), actorId: id(2) };
const draft = (): WorkDraft => ({
  version: 1,
  scope,
  id: id(3),
  connection: id(4),
  kind: "job",
  items: [
    { version_id: id(5), target_id: null },
    { version_id: id(6), target_id: null },
  ],
  reason: "Reviewed customer ownership",
});
const receipt = () => ({
  batch_id: id(3),
  tenant_id: id(1),
  actor_id: id(2),
  connection_id: id(4),
  kind: "job",
  state: "recorded",
  linked: 1,
  held: 1,
  items: [
    {
      version_id: id(5),
      outcome: {
        state: "linked",
        entity_id: id(7),
        entity_kind: "job",
        link_id: id(8),
        already: false,
      },
    },
    { version_id: id(6), outcome: { state: "held", reason: "property_identity_unreviewed" } },
  ],
});
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v);
    },
    removeItem: (k: string) => {
      values.delete(k);
    },
  };
}
const lock: RecoveryLock = async (_k, work) => work();
test("lost response retains the exact draft; a later check recovers without another write", async () => {
  const s = storage();
  let saved: unknown = null,
    writes = 0;
  const db: ReviewClient = {
    rpc: async (name, args) => {
      assert.deepEqual(readWorkDraft(s, scope), draft());
      if (name.endsWith("_result")) return { data: saved, error: null };
      writes++;
      assert.equal(args.p_expected_actor, scope.actorId);
      saved = receipt();
      throw Error("private provider text");
    },
  };
  await assert.rejects(
    resolveWorkDraft(db, s, lock, scope, draft(), "apply", () => true),
    /could not be verified/,
  );
  assert.deepEqual(readWorkDraft(s, scope), draft());
  assert.deepEqual(
    await resolveWorkDraft(db, s, lock, scope, draft(), "check", () => true),
    receipt(),
  );
  assert.equal(writes, 1);
  assert.equal(readWorkDraft(s, scope), null);
});
test("missing result is not cancellation and check never applies", async () => {
  const s = storage();
  s.setItem(workOutboxKey(scope), JSON.stringify(draft()));
  const db: ReviewClient = {
    rpc: async (name) => {
      assert.equal(name, "learn_commusoft_work_batch_result");
      return { data: null, error: null };
    },
  };
  assert.equal(await resolveWorkDraft(db, s, lock, scope, draft(), "check", () => true), null);
  assert.deepEqual(readWorkDraft(s, scope), draft());
});
test("explicit cancellation records a server decision before clearing the draft", async () => {
  const s = storage();
  s.setItem(workOutboxKey(scope), JSON.stringify(draft()));
  let writes = 0;
  const db: ReviewClient = {
    rpc: async (name, args) => {
      if (name.endsWith("_result")) return { data: null, error: null };
      writes++;
      assert.equal(args.p_cancel, true);
      assert.deepEqual(args.p_items, draft().items);
      return {
        data: { ...receipt(), state: "cancelled", items: [], linked: 0, held: 0 },
        error: null,
      };
    },
  };
  assert.equal(
    (await resolveWorkDraft(db, s, lock, scope, draft(), "cancel", () => true))?.state,
    "cancelled",
  );
  assert.equal(writes, 1);
  assert.equal(readWorkDraft(s, scope), null);
});
test("unavailable storage or corrupt/foreign drafts prevent any RPC", async () => {
  let calls = 0;
  const db: ReviewClient = {
    rpc: async () => {
      calls++;
      return { data: null, error: null };
    },
  };
  const s = storage();
  s.setItem(workOutboxKey(scope), "broken");
  await assert.rejects(resolveWorkDraft(db, s, lock, scope, draft(), "apply", () => true));
  s.setItem(
    workOutboxKey(scope),
    JSON.stringify({ ...draft(), scope: { ...scope, actorId: id(99) } }),
  );
  await assert.rejects(resolveWorkDraft(db, s, lock, scope, draft(), "apply", () => true));
  await assert.rejects(
    resolveWorkDraft(
      db,
      {
        ...storage(),
        setItem: () => {
          throw Error("storage disabled");
        },
      },
      lock,
      scope,
      draft(),
      "apply",
      () => true,
    ),
  );
  assert.equal(calls, 0);
});
test("read failure never starts a write and unverified receipts never clear recovery", async () => {
  for (const data of [
    null,
    { ...receipt(), actor_id: id(99) },
    { ...receipt(), kind: "site" },
    { ...receipt(), linked: 2 },
    { ...receipt(), items: [...receipt().items].reverse() },
  ]) {
    const s = storage();
    let calls = 0;
    const db: ReviewClient = {
      rpc: async (name) => {
        calls++;
        assert.ok(name.endsWith("_result"));
        return { data, error: data === null ? { message: "private" } : null };
      },
    };
    await assert.rejects(resolveWorkDraft(db, s, lock, scope, draft(), "apply", () => true));
    assert.equal(calls, 1);
    assert.deepEqual(readWorkDraft(s, scope), draft());
  }
});
test("session change or another saved draft during a request prevents local acknowledgement", async () => {
  for (const change of ["session", "storage"]) {
    const s = storage();
    let allowed = true;
    const db: ReviewClient = {
      rpc: async () => {
        if (change === "session") allowed = false;
        else s.setItem(workOutboxKey(scope), JSON.stringify({ ...draft(), id: id(99) }));
        return { data: receipt(), error: null };
      },
    };
    await assert.rejects(resolveWorkDraft(db, s, lock, scope, draft(), "apply", () => allowed));
    assert.ok(readWorkDraft(s, scope));
  }
});
test("source pages enforce scope, cursor order and typed display fields", async () => {
  const row = {
    external_id: "101",
    version_id: id(5),
    title: "Synthetic job",
    property_reference: "1",
    customer_name: "Synthetic customer",
    relationship_reason: null,
    source_status: "Open",
    linked_version_id: null,
    last_result: null,
    selectable: true,
  };
  const page = {
    tenant_id: id(1),
    connection_id: id(4),
    kind: "job",
    rows: [row],
    next_cursor: null,
  };
  const db = (data: unknown): ReviewClient => ({ rpc: async () => ({ data, error: null }) });
  assert.deepEqual(
    (
      await loadWorkPage(
        db({ ...page, rows: [{ ...row, payload: { private: true } }] }),
        id(1),
        id(4),
        "job",
      )
    ).rows,
    [row],
  );
  for (const changed of [
    { tenant_id: id(99) },
    { kind: "site" },
    { rows: [row, row] },
    { next_cursor: "999" },
    { rows: [{ ...row, customer_name: { private: true } }] },
  ])
    await assert.rejects(loadWorkPage(db({ ...page, ...changed }), id(1), id(4), "job"));
});
