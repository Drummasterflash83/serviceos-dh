import test from "node:test";
import assert from "node:assert/strict";
import {
  newContinuationPlan,
  CONTINUATION_SCHEMA,
  continuationPreservationQuery,
} from "./learn-commusoft-continuation-session.mjs";
import { PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import {
  refreshCurrentContinuation,
  originalShapeQuery,
  IDENTITY_QUERY,
  DELTAS,
} from "./learn-commusoft-continuation-current-refresh.mjs";
const runId = "d764008e-8c8f-4837-999a-8d38b5e6e2d5";
function fixture() {
  const p = {
    ...newContinuationPlan(),
    runId,
    email: "learn-continuation-d764008e@example.invalid",
    cutoff: "2026-10-10T21:30:00Z",
    keyFingerprint: "a".repeat(64),
    compatibility058: { originalDataMatched: true },
  };
  p.before = PHONE_HEALTH_PRESERVED.map((name) => ({
    name,
    count: 2,
    fingerprint: "b".repeat(32),
  }));
  const current = p.before.map((r) => ({
    ...r,
    count: r.count + (DELTAS[r.name] ?? 0),
    fingerprint: DELTAS[r.name] ? "c".repeat(32) : r.fingerprint,
  }));
  const identity = {
    tenants: 14,
    marked_archived: 14,
    objects: 4,
    marked_objects: 4,
    private_buckets: 2,
    changed_original_provenance: 0,
    active_fixture_logins: 0,
  };
  let calls = 0;
  const query = async (sql) => {
    calls++;
    if (sql === IDENTITY_QUERY) return [structuredClone(identity)];
    if (sql === originalShapeQuery(p)) return structuredClone(p.before);
    if (sql === continuationPreservationQuery(p)) return structuredClone(current);
    throw Error("Unexpected query");
  };
  const deps = {
    query,
    catalog: async () => ({ fingerprint: CONTINUATION_SCHEMA }),
    fullCatalog: async () => ({ fingerprint: "e9243d82b156c9ab535d7abf601a9aae" }),
    now: () => "2026-10-12T09:00:00Z",
  };
  return { p, current, identity, deps, calls: () => calls };
}
test("reconciles exact known additions and preserves prior evidence without mutating input", async () => {
  const f = fixture(),
    before = structuredClone(f.p);
  const next = await refreshCurrentContinuation(f.p, f.deps);
  assert.deepEqual(f.p, before);
  assert.deepEqual(next.compatibility079.priorBaseline, before.before);
  assert.equal(next.compatibility079.originalDataMatched, true);
  assert.equal(next.before.length, 78);
  assert.equal(f.calls(), 6);
});
test("rejects retired or repeated reconciliation before hosted reads", async () => {
  for (const patch of [
    { state: "retired" },
    { compatibility079: {} },
    { password: "unexpected" },
    { compatibility058: { originalDataMatched: false } },
  ]) {
    const f = fixture();
    await assert.rejects(refreshCurrentContinuation({ ...f.p, ...patch }, f.deps));
    assert.equal(f.calls(), 0);
  }
});
test("rejects changed source rows, unexpected new rows and source drift", async () => {
  for (const mode of ["old", "extra", "drift"]) {
    const f = fixture(),
      query = f.deps.query;
    let reads = 0;
    f.deps.query = async (sql) => {
      const rows = await query(sql);
      if (sql === originalShapeQuery(f.p) && mode === "old") rows[0].fingerprint = "e".repeat(32);
      if (sql === continuationPreservationQuery(f.p)) {
        reads++;
        if (mode === "extra") rows[0].count++;
        if (mode === "drift" && reads === 2) rows[0].fingerprint = "d".repeat(32);
      }
      return rows;
    };
    await assert.rejects(refreshCurrentContinuation(f.p, f.deps));
  }
});
test("rejects changed fixture identity, public storage, active login and non-null original provenance", async () => {
  for (const field of [
    "tenants",
    "marked_archived",
    "objects",
    "marked_objects",
    "private_buckets",
    "changed_original_provenance",
    "active_fixture_logins",
  ]) {
    const f = fixture();
    f.identity[field]++;
    await assert.rejects(refreshCurrentContinuation(f.p, f.deps));
  }
});
test("requires both current catalog fingerprints before and after reading data", async () => {
  for (const field of ["catalog", "fullCatalog"]) {
    const f = fixture(),
      read = f.deps[field];
    let n = 0;
    f.deps[field] = async () => (++n === 2 ? { fingerprint: "0".repeat(32) } : read());
    await assert.rejects(refreshCurrentContinuation(f.p, f.deps));
  }
});
test("normalisation groups OR predicates and removes only known additions", () => {
  const f = fixture(),
    sql = originalShapeQuery(f.p);
  const flags = sql.split(" union all ").find((x) => x.includes("'public.feature_flags'"));
  assert.match(flags, /where \(tenant_id<>.+ or flag not in \(.+\)\) and \(/);
  const interactions = sql.split(" union all ").find((x) => x.includes("'public.interactions'"));
  assert.match(interactions, /from \(select id,tenant_id/);
  assert.doesNotMatch(interactions, /source_updated_at|source_version/);
  assert.match(IDENTITY_QUERY, /source_updated_at is not null or source_version is not null/);
});
