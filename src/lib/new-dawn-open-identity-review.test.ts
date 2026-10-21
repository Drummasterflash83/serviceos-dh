import assert from "node:assert/strict";
import test from "node:test";
import { loadAttentionIdentityGroups, loadOpenIdentityPage,
  readOpenIdentityPage } from "./new-dawn-open-identity-review.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const connection = "11111111-1111-4111-8111-111111111111";
const actor = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const audit = "44444444-4444-4444-8444-444444444444";
const scope = { tenant, connection, actor };
const now = Date.now();
const row = (external: string, status: string) => ({
  external_id: external, status, source_version_id: version,
  source_observed_at: "2026-10-20T20:30:00Z", property_external_id: "45",
  customer_external_id: "12", candidate_state: "review",
  hold_reason: "site_mapping_missing_or_stale", suggested_site_id: null,
  suggested_customer_id: null,
});
const page = (rows: unknown[]) => ({
  version: "new-dawn-open-identity-review/1", tenant_id: tenant,
  connection_id: connection, actor_id: actor, audit_id: audit,
  observed_at: new Date(now).toISOString(), snapshot_at: new Date(now - 1_000).toISOString(),
  total_unlinked: 293, next_cursor: null, rows,
});

test("accepts a scoped, audited on-hold then pending then open page", () => {
  const result = readOpenIdentityPage(page([
    row("100", "on_hold"), row("101", "pending"), row("102", "open"),
  ]), scope, now);
  assert.equal(result.totalUnlinked, 293);
  assert.deepEqual(result.rows.map(item => item.status), ["on_hold", "pending", "open"]);
});

test("rejects tenant confusion, status reordering and unsupported ready links", () => {
  assert.throws(() => readOpenIdentityPage({ ...page([row("100", "open")]), tenant_id: actor }, scope, now));
  assert.throws(() => readOpenIdentityPage(page([row("100", "open"), row("101", "on_hold")]), scope, now));
  assert.throws(() => readOpenIdentityPage(page([{ ...row("100", "open"),
    candidate_state: "ready", hold_reason: null }]), scope, now));
});

test("calls only the scoped read RPC and rejects its error", async () => {
  const calls: unknown[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push([name, args]);
    return { data: page([row("100", "on_hold")]), error: null };
  } };
  const result = await loadOpenIdentityPage(db, { ...scope, reason: "Open work review", cursor: null });
  assert.equal(result.rows[0].externalId, "100");
  assert.deepEqual(calls, [["new_dawn_open_identity_review_page", {
    p_tenant: tenant, p_connection: connection, p_reason: "Open work review",
    p_cursor: null, p_limit: 25,
  }]]);
  await assert.rejects(loadOpenIdentityPage({ rpc: async () => ({ data: null, error: {} }) },
    { ...scope, reason: "Open work review", cursor: null }));
});

test("groups the complete attention prefix across one pinned cursor", async () => {
  const cursor = Buffer.from("next").toString("base64");
  const first = readOpenIdentityPage({ ...page([row("100", "on_hold"), row("101", "on_hold")]),
    next_cursor: cursor }, scope, now);
  const second = readOpenIdentityPage(page([
    row("102", "pending"), row("103", "open")]), scope, now);
  const calls: Array<string | null> = [];
  const result = await loadAttentionIdentityGroups(async after => {
    calls.push(after);
    return after ? second : first;
  });
  assert.deepEqual(calls, [null, cursor]);
  assert.equal(result.jobs, 3);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].jobs.map(job => job.externalId), ["100", "101", "102"]);
});

test("keeps different properties and incomplete parents apart during urgent review", async () => {
  const source = readOpenIdentityPage(page([
    row("100", "on_hold"),
    { ...row("101", "on_hold"), property_external_id: "46" },
    { ...row("102", "pending"), property_external_id: null },
  ]), scope, now);
  const result = await loadAttentionIdentityGroups(async () => source);
  assert.equal(result.jobs, 3);
  assert.equal(result.groups.length, 3);
  assert.deepEqual(result.groups.map(group => [group.customerExternalId,
    group.propertyExternalId, group.jobs.map(job => job.externalId)]), [
    ["12", "45", ["100"]], ["12", "46", ["101"]], ["12", null, ["102"]],
  ]);
});

test("refuses mixed snapshots or duplicated rows rather than claiming full grouping", async () => {
  const cursor = Buffer.from("next").toString("base64");
  const first = readOpenIdentityPage({ ...page([row("100", "on_hold")]),
    next_cursor: cursor }, scope, now);
  const later = readOpenIdentityPage({ ...page([row("101", "pending")]),
    snapshot_at: new Date(now - 2_000).toISOString() }, scope, now);
  await assert.rejects(loadAttentionIdentityGroups(async after => after ? later : first));
  const duplicate = readOpenIdentityPage(page([row("100", "on_hold")]), scope, now);
  await assert.rejects(loadAttentionIdentityGroups(async after => after ? duplicate : first));
});
