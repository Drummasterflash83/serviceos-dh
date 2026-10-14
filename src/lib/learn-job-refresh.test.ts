import test from "node:test";
import assert from "node:assert/strict";
import {
  loadJobRefresh,
  prepareJobRefresh,
  resolveJobRefresh,
  readJobRefreshDraft,
  refreshKey,
  type RefreshDraft,
} from "./learn-job-refresh.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
    backend: "https://test.example.invalid",
    tenant: id(1),
    actor: id(2),
  },
  link = id(3);
const fields = {
  title: "001. Work",
  description: "001. Work",
  status: "open",
  created_date: null,
  completed_date: null,
};
const plan = {
  version: "learn-business-refresh/1",
  state: "ready",
  tenant_id: scope.tenant,
  link_id: link,
  job_id: id(4),
  source_version_id: id(5),
  previous_version_id: id(6),
  job_number: "101",
  revision: "a".repeat(32),
  before: fields,
  after: { ...fields, status: "completed" },
  changed_fields: ["status"],
  timing_limitations: ["completed"],
};
const locked = async <T>(_: string, work: () => Promise<T>) => work();
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
async function draft() {
  return prepareJobRefresh(
    scope,
    await loadJobRefresh({ rpc: async () => ({ data: plan, error: null }) }, scope, link),
    id(7),
    "Reviewed completion update",
  );
}
const committed = (d: RefreshDraft) => ({
  version: "learn-business-refresh/1",
  state: "committed",
  request_id: d.request,
  tenant_id: d.scope.tenant,
  link_id: d.link,
  job_id: d.job,
  source_version_id: d.source,
  previous_version_id: d.previous,
  revision: 1,
  changed_fields: ["status"],
  timing_limitations: ["completed"],
});
test("keeps leading zeros and uncertain time out of elapsed-time evidence", async () => {
  const p = await loadJobRefresh({ rpc: async () => ({ data: plan, error: null }) }, scope, link);
  assert.equal(p.state, "ready");
  if (p.state === "ready") {
    assert.equal(p.after.title, "001. Work");
    assert.equal(p.after.completed_date, null);
    assert.deepEqual(p.timing_limitations, ["completed"]);
  }
});
test("rejects another tenant plan and an incomplete projection", async () => {
  for (const data of [
    { ...plan, tenant_id: id(9) },
    { ...plan, after: { status: "completed" } },
  ])
    await assert.rejects(loadJobRefresh({ rpc: async () => ({ data, error: null }) }, scope, link));
});
test("read-only recovery never dispatches apply", async () => {
  const d = await draft(),
    s = storage(),
    actions: string[] = [];
  const r = await resolveJobRefresh(
    {
      rpc: async (_, a) => {
        actions.push(String(a.p_action));
        return {
          data: { state: "pending", request_id: d.request },
          error: null,
        };
      },
    },
    s,
    d,
    "check",
    locked,
    () => true,
  );
  assert.deepEqual(r, { state: "pending" });
  assert.deepEqual(actions, ["check"]);
  assert.deepEqual(readJobRefreshDraft(s, scope, link), d);
});
test("lost apply response retains request and retries recover receipt without applying twice", async () => {
  const d = await draft(),
    s = storage(),
    actions: string[] = [];
  let applied = false;
  const c = {
    rpc: async (_: string, a: Record<string, unknown>) => {
      actions.push(String(a.p_action));
      if (a.p_action === "apply") {
        applied = true;
        throw Error("Lost response");
      }
      return {
        data: applied ? committed(d) : { state: "pending", request_id: d.request },
        error: null,
      };
    },
  };
  await assert.rejects(resolveJobRefresh(c, s, d, "apply", locked, () => true));
  assert.deepEqual(readJobRefreshDraft(s, scope, link), d);
  const r = await resolveJobRefresh(c, s, d, "apply", locked, () => true);
  assert.equal(r.state, "committed");
  assert.deepEqual(actions, ["check", "apply", "check"]);
  assert.equal(readJobRefreshDraft(s, scope, link), null);
});
test("foreign receipt leaves draft intact and does not trigger apply", async () => {
  const d = await draft(),
    s = storage(),
    actions: string[] = [];
  await assert.rejects(
    resolveJobRefresh(
      {
        rpc: async (_, a) => {
          actions.push(String(a.p_action));
          return {
            data: { ...committed(d), source_version_id: id(9) },
            error: null,
          };
        },
      },
      s,
      d,
      "apply",
      locked,
      () => true,
    ),
  );
  assert.deepEqual(actions, ["check"]);
  assert.deepEqual(readJobRefreshDraft(s, scope, link), d);
});
test("saved different request and switched actor cannot overwrite the outbox", async () => {
  const d = await draft(),
    s = storage();
  s.setItem(refreshKey(scope, link), JSON.stringify(d));
  let calls = 0;
  const c = {
    rpc: async () => {
      calls++;
      throw Error("Must not call");
    },
  };
  await assert.rejects(
    resolveJobRefresh(c, s, { ...d, request: id(8) }, "apply", locked, () => true),
  );
  await assert.rejects(resolveJobRefresh(c, s, d, "apply", locked, () => false));
  assert.equal(calls, 0);
  assert.deepEqual(readJobRefreshDraft(s, scope, link), d);
  assert.notEqual(refreshKey(scope, link), refreshKey({ ...scope, actor: id(8) }, link));
});
const cancelled = (d: RefreshDraft) => ({
  version: "learn-business-refresh/1",
  state: "cancelled",
  request_id: d.request,
  tenant_id: d.scope.tenant,
  link_id: d.link,
  job_id: d.job,
  source_version_id: d.source,
  actor_id: d.scope.actor,
});
test("lost cancellation response recovers the tombstone without dispatching apply", async () => {
  const d = await draft(),
    s = storage(),
    actions: string[] = [];
  let cancelledAlready = false;
  const client = {
    rpc: async (_: string, a: Record<string, unknown>) => {
      actions.push(String(a.p_action));
      if (a.p_action === "cancel") {
        cancelledAlready = true;
        throw Error("Lost cancellation response");
      }
      return {
        data: cancelledAlready ? cancelled(d) : { state: "pending", request_id: d.request },
        error: null,
      };
    },
  };
  await assert.rejects(resolveJobRefresh(client, s, d, "cancel", locked, () => true));
  assert.deepEqual(readJobRefreshDraft(s, scope, link), d);
  const result = await resolveJobRefresh(client, s, d, "apply", locked, () => true);
  assert.equal(result.state, "cancelled");
  assert.deepEqual(actions, ["check", "cancel", "check"]);
  assert.equal(readJobRefreshDraft(s, scope, link), null);
});
test("cancelling an already committed request reports the saved commit", async () => {
  const d = await draft(),
    s = storage(),
    actions: string[] = [];
  const result = await resolveJobRefresh(
    {
      rpc: async (_, a) => {
        actions.push(String(a.p_action));
        return { data: committed(d), error: null };
      },
    },
    s,
    d,
    "cancel",
    locked,
    () => true,
  );
  assert.equal(result.state, "committed");
  assert.deepEqual(actions, ["check"]);
});
test("another actors cancellation cannot clear a saved request", async () => {
  const d = await draft(),
    s = storage();
  await assert.rejects(
    resolveJobRefresh(
      { rpc: async () => ({ data: { ...cancelled(d), actor_id: id(99) }, error: null }) },
      s,
      d,
      "check",
      locked,
      () => true,
    ),
  );
  assert.deepEqual(readJobRefreshDraft(s, scope, link), d);
});
