import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseUsersPageSaved, readUsersPageSaved, requestUsersPage,
  readUsersPageOutbox, saveUsersPageOutbox, clearUsersPageOutbox, usersPageKey,
} from "./new-dawn-isolated-users-page.ts";
const tenantId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const connectionId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
const audit = "00000000-0000-4000-8000-000000000005";
const backend = "https://test.openfolk.ai";
const scope = { tenantId, actorId, connectionId, requestId };
const request = { ...scope, version: 1 as const, backend, reason: "Review source user IDs" };
const saved = {
  version: "commusoft-isolated-users-page-saved/1", scope: "source_identity_only",
  tenant_id: tenantId, connection_id: connectionId, request_id: requestId,
  state: "complete", checked_at: "2026-10-20T10:00:00Z", record_count: 2, has_more: true,
  source_users: [
    { source_user_id: "001", observed_at: "2026-10-20T09:59:59Z" },
    { source_user_id: "9000000000000000", observed_at: "2026-10-20T09:59:59Z" },
  ], audit_id: audit,
};
const valid = { ...saved, source_users: [
  { source_user_id: "1", observed_at: "2026-10-20T09:59:59Z" },
  { source_user_id: "9000000000000000", observed_at: "2026-10-20T09:59:59Z" },
] };
test("saved source IDs are bounded, unique, fresh and tenant/connection/request scoped", () => {
  assert.equal(parseUsersPageSaved(valid, scope).sourceUsers.length, 2);
  for (const bad of [
    { ...valid, tenant_id: actorId }, { ...valid, connection_id: actorId },
    { ...valid, request_id: actorId }, { ...valid, source_users: saved.source_users },
    { ...valid, source_users: [valid.source_users[0], valid.source_users[0]] },
    { ...valid, record_count: 11 }, { ...valid, checked_at: "not-a-date" },
    { ...valid, source_users: [...valid.source_users, { source_user_id: "3", observed_at: "2026-10-20T09:59:59Z" }] },
  ]) assert.throws(() => parseUsersPageSaved(bad, scope));
});
test("one-page request sends no cursor and reads the saved IDs only after a bounded receipt", async () => {
  const calls: unknown[] = [];
  const client = {
    functions: { invoke: async (name: string, options: { body: Record<string, unknown> }) => {
      calls.push([name, options.body]);
      return { data: { version: "commusoft-isolated-users-page/1", scope: "source_identity_only",
        tenant_id: tenantId, connection_id: connectionId, request_id: requestId,
        record_count: 2, has_more: true }, error: null };
    } },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);return { data: valid, error: null };
    },
  };
  const result = await requestUsersPage(client, request);
  assert.equal(result.state, "saved");
  assert.deepEqual(calls[0], ["learn-commusoft-users-page", { tenantId, connectionId,
    requestId, after: null, reason: request.reason }]);
  assert.deepEqual(calls[1], ["new_dawn_commusoft_users_page_saved", {
    p_tenant: tenantId, p_connection: connectionId, p_request: requestId }]);
});
test("lease wait never reads saved IDs or retries a provider GET automatically", async () => {
  let calls = 0;
  const client = { functions: { invoke: async () => { calls++;return { data: {
    state: "waiting", request_id: requestId, retry_at: Date.now() + 30000 }, error: null }; } },
    rpc: async () => { throw Error("unexpected_saved_read"); } };
  const result = await requestUsersPage(client, request);
  assert.equal(result.state, "waiting");assert.equal(calls, 1);
});
test("readback never invokes the provider route", async () => {
  const client = { rpc: async () => ({ data: valid, error: null }) };
  assert.equal((await readUsersPageSaved(client, scope)).recordCount, 2);
});
test("saved request is isolated by tenant, actor and connection", () => {
  const rows = new Map<string, string>();
  const store = { getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); } };
  const entry = { version: 1 as const, savedAt: Date.now(), request };
  saveUsersPageOutbox(store, entry);
  assert.deepEqual(readUsersPageOutbox(store, { backend, tenantId, actorId, connectionId }), entry);
  assert.equal(readUsersPageOutbox(store, { backend, tenantId: actorId, actorId, connectionId }), null);
  assert.equal(readUsersPageOutbox(store, { backend, tenantId, actorId, connectionId: actorId }), null);
  assert.throws(() => saveUsersPageOutbox(store, { ...entry,
    request: { ...request, requestId: audit } }));
  clearUsersPageOutbox(store, { backend, tenantId, actorId, connectionId });
  assert.equal(rows.has(usersPageKey({ backend, tenantId, actorId, connectionId })), false);
});
