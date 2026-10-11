import { test } from "node:test";
import assert from "node:assert/strict";
import { newContinuationPlan } from "./learn-commusoft-continuation-session.mjs";
import { PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import {
  COMPATIBILITY057_SCHEMA,
  refreshPreparedContinuation,
  refreshSummary,
} from "./learn-commusoft-continuation-refresh.mjs";
const deltas = {
  "public.phone_recordings": 2,
  "public.phone_transcripts": 2,
  "public.tenants": 2,
  "public.phone_sync_runs": 6,
  "public.phone_ai_insights": 2,
  "public.audit_logs": 8,
};
function fixture() {
  const p = {
    ...newContinuationPlan(),
    runId: "d764008e-8c8f-4837-999a-8d38b5e6e2d5",
    email: "learn-continuation-d764008e@example.invalid",
    cutoff: "2026-10-10T21:30:28.288Z",
    keyFingerprint: "f".repeat(64),
    before: PHONE_HEALTH_PRESERVED.map((name) => ({ name, count: 0, fingerprint: "a".repeat(32) })),
  };
  const current = p.before.map((r) => ({
    ...r,
    count: deltas[r.name] ?? 0,
    fingerprint: deltas[r.name] ? "b".repeat(32) : r.fingerprint,
  }));
  let calls = 0;
  const query = async (sql) => {
    calls++;
    assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|grant|revoke|alter|create)\b/i);
    if (sql.includes("continuation_fixture_identity")) return [{ fixtures: 2, expected: 2 }];
    return structuredClone(sql.includes("coalesce(to_jsonb(s)->>'tenant_id'") ? p.before : current);
  };
  return {
    p,
    current,
    query,
    catalog: async () => ({ fingerprint: COMPATIBILITY057_SCHEMA }),
    calls: () => calls,
  };
}
test("refresh proves original rows and keeps all new fixture rows protected without changing approval scope", async () => {
  const f = fixture(),
    original = structuredClone(f.p);
  const p = await refreshPreparedContinuation(f.p, f);
  assert.deepEqual(f.p, original);
  const { before, compatibility057, preserved, ...rest } = p;
  const { before: old, ...oldRest } = original;
  assert.deepEqual(rest, oldRest);
  assert.deepEqual(
    compatibility057.priorBaseline,
    [...old].sort((a, b) => a.name.localeCompare(b.name)),
  );
  assert.deepEqual(
    before,
    [...f.current].sort((a, b) => a.name.localeCompare(b.name)),
  );
  assert.equal(preserved, true);
  assert.equal(p.state, "prepared");
  assert.equal(f.calls(), 5);
  const summary = refreshSummary(p);
  assert.equal(summary.newGrants, 0);
  assert.equal(summary.providerRequests, 0);
  assert.equal(summary.approval, "still_required_for_activation");
  assert.doesNotMatch(JSON.stringify(summary), /password|keyFingerprint|"priorBaseline":/);
});
test("active, foreign or previously refreshed runs stop before any external read", async () => {
  for (const patch of [
    { state: "active" },
    { runId: "00000000-0000-4000-8000-000000000111" },
    { compatibility057: {} },
    { password: "PRIVATE" },
  ]) {
    const f = fixture();
    Object.assign(f.p, patch);
    await assert.rejects(
      refreshPreparedContinuation(f.p, {
        query: async () => assert.fail(),
        catalog: async () => assert.fail(),
      }),
    );
  }
});
test("unknown old-row changes, extra additions or changed fixture metadata cannot refresh", async () => {
  for (const fault of ["old", "extra", "fixture"]) {
    const f = fixture(),
      before = structuredClone(f.p);
    const query = async (sql) => {
      const rows = await f.query(sql);
      if (fault === "fixture" && sql.includes("continuation_fixture_identity"))
        rows[0].expected = 1;
      if (fault === "old" && sql.includes("coalesce(to_jsonb(s)->>'tenant_id'"))
        rows[0].fingerprint = "c".repeat(32);
      if (
        fault === "extra" &&
        !sql.includes("continuation_fixture_identity") &&
        !sql.includes("coalesce(to_jsonb(s)->>'tenant_id'")
      )
        rows[0].count++;
      return rows;
    };
    await assert.rejects(refreshPreparedContinuation(f.p, { ...f, query }));
    assert.deepEqual(f.p, before);
  }
});
test("schema drift and current-row drift between passes reject refreshed evidence", async () => {
  for (const fault of ["schema", "rows"]) {
    const f = fixture();
    let catalogs = 0,
      normal = 0;
    const catalog = async () => ({
      fingerprint:
        ++catalogs === 2 && fault === "schema" ? "0".repeat(32) : COMPATIBILITY057_SCHEMA,
    });
    const query = async (sql) => {
      const rows = await f.query(sql);
      if (
        !sql.includes("continuation_fixture_identity") &&
        !sql.includes("coalesce(to_jsonb(s)->>'tenant_id'")
      ) {
        if (++normal === 2 && fault === "rows") rows[0].fingerprint = "c".repeat(32);
      }
      return rows;
    };
    await assert.rejects(refreshPreparedContinuation(f.p, { query, catalog }));
  }
});
