import assert from "node:assert/strict";
import test from "node:test";
import { runIsolatedUsersPage, validateIsolatedUsersPageRequest } from "./isolated_users_page.ts";

const tenantId = "00000000-0000-4000-8000-000000000001";
const otherTenant = "00000000-0000-4000-8000-000000000002";
const connectionId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
const request = { tenantId, connectionId, requestId, after: null, reason: "Review source engineers" };
const reply = (data: unknown) => ({ data, error: null });
const ready = { state: "ready", request_id: requestId, tenant_id: tenantId,
  connection_id: connectionId, region: "uk", after: null, send_before: Date.now() + 4000,
  api_key: "fixture-key" };

test("one bounded users GET retains a version receipt without changing source capture", async () => {
  const calls: string[] = [];
  const capture = { status: "running", phase: 3, cursor: "current-source-page" };
  const result = await runIsolatedUsersPage(request, {
    userRpc: async (name, args) => {
      calls.push(name); assert.equal(args.p_tenant, tenantId); assert.equal(args.p_connection, connectionId);
      return reply({ state: "prepared", request_id: requestId });
    },
    serviceRpc: async (name, args) => {
      calls.push(name); assert.equal(args.p_request, requestId);
      if (name.endsWith("_acquire")) return reply(ready);
      if (name.endsWith("_guard")) return reply(true);
      if (name.endsWith("_finish")) {
        const page = args.p_envelope as { data: { id: number }[] };
        assert.deepEqual(page.data.map((row) => row.id), [1, 2]);
        return reply({ version: "commusoft-isolated-users-page/1", request_id: requestId,
          tenant_id: tenantId, connection_id: connectionId, record_count: 2,
          has_more: true, next_cursor: 2 });
      }
      throw Error(name);
    },
    fetcher: async (url, init) => {
      calls.push("GET");
      assert.equal(url, "https://app.commusoft.co.uk/api/v2/users?limit=10");
      assert.equal(init?.method, "GET");
      return Response.json({ data: [{ id: 1, firstName: "A" }, { id: 2, firstName: "B" }],
        pagination: { hasMore: true, nextCursor: 2 } });
    },
  });
  assert.equal((result as { record_count: number }).record_count, 2);
  assert.equal(calls.filter((name) => name === "GET").length, 1);
  assert.equal(calls.filter((name) => name.endsWith("_guard")).length, 2);
  assert.deepEqual(capture, { status: "running", phase: 3, cursor: "current-source-page" });
  assert.equal(calls.some((name) => /commit_page|yield_job|source_sync|sync_cursor/.test(name)), false);
});

test("busy recurring capture yields a lease wait; retry may use the same prepared request", async () => {
  const retryAt = Date.now() + 1000;
  let leaseBusy = true, gets = 0, starts = 0;
  const ports = {
    userRpc: async () => { starts++; return reply({ state: "prepared", request_id: requestId }); },
    serviceRpc: async (name: string) => name.endsWith("_acquire")
      ? reply(leaseBusy ? { state: "wait", retry_at: retryAt, wait_kind: "lease" } : ready)
      : name.endsWith("_guard") ? reply(true)
      : reply({ version: "commusoft-isolated-users-page/1", request_id: requestId,
          tenant_id: tenantId, connection_id: connectionId, record_count: 0, has_more: false, next_cursor: null }),
    fetcher: async () => { gets++; return Response.json({ data: [], pagination: { hasMore: false, nextCursor: null } }); },
  };
  assert.deepEqual(await runIsolatedUsersPage(request, ports),
    { state: "waiting", request_id: requestId, retry_at: retryAt });
  assert.equal(gets, 0);
  leaseBusy = false;
  await runIsolatedUsersPage(request, ports);
  assert.equal(gets, 1); assert.equal(starts, 2);
});

test("concurrent operator attempts share one lease and never overlap provider GETs", async () => {
  const secondId = "00000000-0000-4000-8000-000000000005";
  let owner: string | null = null, inFlight = 0, maxInFlight = 0;
  const serviceRpc = async (name: string, args: Record<string, unknown>) => {
    const id = String(args.p_request);
    if (name.endsWith("_acquire")) {
      if (owner) return reply({ state: "wait", retry_at: Date.now() + 1000, wait_kind: "lease" });
      owner = id;
      return reply({ ...ready, request_id: id, send_before: Date.now() + 4000 });
    }
    if (name.endsWith("_guard")) return reply(owner === id);
    if (name.endsWith("_finish")) {
      assert.equal(owner, id); owner = null;
      return reply({ version: "commusoft-isolated-users-page/1", request_id: id,
        tenant_id: tenantId, connection_id: connectionId, record_count: 0, has_more: false, next_cursor: null });
    }
    throw Error(name);
  };
  const ports = {
    userRpc: async (_name: string, args: Record<string, unknown>) =>
      reply({ state: "prepared", request_id: args.p_request }),
    serviceRpc,
    fetcher: async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
      return Response.json({ data: [], pagination: { hasMore: false, nextCursor: null } });
    },
  };
  const results = await Promise.all([
    runIsolatedUsersPage(request, ports),
    runIsolatedUsersPage({ ...request, requestId: secondId }, ports),
  ]);
  assert.equal(maxInFlight, 1);
  assert.equal(results.filter((value) => (value as { state?: string }).state === "waiting").length, 1);
  assert.equal(results.filter((value) => (value as { version?: string }).version === "commusoft-isolated-users-page/1").length, 1);
});

test("cross-tenant start denial and mismatched acquisition cannot release a provider key", async () => {
  let gets = 0;
  await assert.rejects(runIsolatedUsersPage({ ...request, tenantId: otherTenant }, {
    userRpc: async () => ({ data: null, error: { code: "42501" } }),
    serviceRpc: async () => { throw Error("service must not run"); },
    fetcher: async () => { gets++; throw Error("provider must not run"); },
  }), /scope_denied/);
  await assert.rejects(runIsolatedUsersPage(request, {
    userRpc: async () => reply({ state: "prepared", request_id: requestId }),
    serviceRpc: async () => reply({ ...ready, tenant_id: otherTenant }),
    fetcher: async () => { gets++; throw Error("provider must not run"); },
  }), /scope_changed/);
  assert.equal(gets, 0);
});

test("revocation before GET or after GET prevents publication", async () => {
  for (const permittedReads of [0, 1]) {
    let checks = 0, gets = 0, finishes = 0, fails = 0;
    await assert.rejects(runIsolatedUsersPage(request, {
      userRpc: async () => reply({ state: "prepared", request_id: requestId }),
      serviceRpc: async (name) => {
        if (name.endsWith("_acquire")) return reply(ready);
        if (name.endsWith("_guard")) return reply(++checks <= permittedReads);
        if (name.endsWith("_finish")) finishes++;
        if (name.endsWith("_fail")) fails++;
        return reply(null);
      },
      fetcher: async () => { gets++; return Response.json({ data: [], pagination: { hasMore: false, nextCursor: null } }); },
    }), /scope_changed/);
    assert.equal(gets, permittedReads); assert.equal(finishes, 0); assert.equal(fails, 1);
  }
});

test("request accepts one cursor and rejects scope expansion", () => {
  assert.equal(validateIsolatedUsersPageRequest(request), true);
  assert.equal(validateIsolatedUsersPageRequest({ ...request, after: 7 }), true);
  assert.equal(validateIsolatedUsersPageRequest({ ...request, after: 0 }), false);
  assert.equal(validateIsolatedUsersPageRequest({ ...request, limit: 100 }), false);
  assert.equal(validateIsolatedUsersPageRequest({ ...request, resource: "jobs" }), false);
});
