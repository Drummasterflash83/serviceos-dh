import assert from "node:assert/strict";
import test from "node:test";
import { loadRecentUnlinkedJobs, readRecentUnlinkedJobs } from "./new-dawn-recent-unlinked-jobs.ts";

const tenant = "00000000-0000-0000-0000-000000000001";
const connection = "11111111-1111-1111-1111-111111111111";
const actor = "22222222-2222-2222-2222-222222222222";
const now = Date.parse("2026-10-19T20:30:00Z");
const row = {
  external_id: "12345",
  version_id: "33333333-3333-3333-3333-333333333333",
  source_observed_at: "2026-10-19T18:33:03Z",
  source_status: "Open",
  relationship_state: "site_customer_source_retained",
  customer_identity_state: "unreviewed",
};
const payload = () => ({
  version: "new-dawn-recent-unlinked-jobs/1",
  tenant_id: tenant,
  connection_id: connection,
  actor_id: actor,
  audit_id: "44444444-4444-4444-4444-444444444444",
  observed_at: "2026-10-19T20:30:00Z",
  window_start: "2026-10-18T20:30:00Z",
  unlinked_count: 40,
  latest_source_observed_at: row.source_observed_at,
  latest_checkpoint_at: "2026-10-19T20:15:26Z",
  rows: [row],
});

test("reads bounded operator-only recent source evidence while distinguishing checkpoint time", () => {
  const result = readRecentUnlinkedJobs(payload(), { tenant, connection, actor }, now);
  assert.equal(result.unlinkedCount, 40);
  assert.equal(result.rows[0]?.external_id, "12345");
  assert.notEqual(result.latestSourceObservedAt, result.latestCheckpointAt);
  const noRecent = readRecentUnlinkedJobs(
    { ...payload(), unlinked_count: 0, rows: [] },
    { tenant, connection, actor },
    now,
  );
  assert.equal(noRecent.latestSourceObservedAt, row.source_observed_at);
});

test("rejects foreign scope, stale receipt, duplicate IDs and false freshness", () => {
  const scope = { tenant, connection, actor };
  assert.throws(() => readRecentUnlinkedJobs(payload(), { ...scope, tenant: actor }, now));
  assert.throws(() =>
    readRecentUnlinkedJobs({ ...payload(), observed_at: "2026-10-19T19:00:00Z" }, scope, now),
  );
  assert.throws(() => readRecentUnlinkedJobs({ ...payload(), rows: [row, row] }, scope, now));
  assert.throws(() =>
    readRecentUnlinkedJobs(
      { ...payload(), latest_source_observed_at: "2026-10-19T18:00:00Z" },
      scope,
      now,
    ),
  );
  assert.throws(() => readRecentUnlinkedJobs({ ...payload(), unlinked_count: 0 }, scope, now));
});

test("invalid operator reason cannot call the RPC", async () => {
  let called = false;
  const db = {
    rpc: async () => {
      called = true;
      return { data: payload(), error: null };
    },
  };
  await assert.rejects(loadRecentUnlinkedJobs(db, { tenant, connection, actor, reason: "" }));
  assert.equal(called, false);
});
