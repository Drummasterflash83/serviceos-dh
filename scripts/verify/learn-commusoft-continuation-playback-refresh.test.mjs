import test from "node:test";
import assert from "node:assert/strict";
import { newContinuationPlan } from "./learn-commusoft-continuation-session.mjs";
import { PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import { refreshAfterPlayback, summary } from "./learn-commusoft-continuation-playback-refresh.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const plan = {
    ...newContinuationPlan(),
    runId: "d764008e-8c8f-4837-999a-8d38b5e6e2d5",
    email: "learn-continuation-d764008e@example.invalid",
    cutoff: "2026-10-10T21:30:28.288Z",
    keyFingerprint: "f".repeat(64),
    compatibility057: { originalDataMatched: true, priorBaseline: ["retained"] },
    before: PHONE_HEALTH_PRESERVED.map((name) => ({ name, count: 0, fingerprint: "a".repeat(32) })),
  };
  const p = {
    projectRef: plan.projectRef,
    runId: "73e083fe-4195-49fb-89a2-7679b6eab517",
    state: "retired",
    httpVerifiedAt: "2026-10-11T12:16:54Z",
    retiredAt: "2026-10-11T12:18:16Z",
    user: "effb2fb2-0782-491b-9a49-5cf2a5ef9e4d",
    tenants: ["b6da43b2-0eec-4a70-9117-5a325b6b2e25", "f671e7aa-07d7-44a2-8bfa-ebbe1f2607b9"],
    call: id(1),
    recording: id(2),
    foreignRecording: id(3),
    interaction: id(4),
    person: id(5),
    company: id(6),
    card: id(7),
  };
  p.storagePath = p.tenants[0] + "/" + p.runId + "/generated.wav";
  const deltas = {
    "public.phone_calls": 1,
    "public.phone_recordings": 2,
    "public.interactions": 1,
    "public.people": 1,
    "public.companies": 1,
    "public.customer_cards": 1,
    "public.profiles": 1,
    "public.tenants": 2,
    "storage.objects": 1,
  };
  const current = plan.before.map((r) => ({
    ...r,
    count: deltas[r.name] ?? 0,
    fingerprint: deltas[r.name] ? "b".repeat(32) : r.fingerprint,
  }));
  let calls = 0;
  const dep = {
    catalog: async () => ({ fingerprint: "b35981f6b70c615e9e234540ddff1777" }),
    savedCatalog: async () => ({ fingerprint: "6632f3df219ea27a9ccc3f668f198f00" }),
    query: async (sql) => {
      calls++;
      assert.doesNotMatch(sql, /\b(insert|update|delete|truncate|grant|revoke|alter|create)\b/i);
      if (sql.includes("playback_retirement_identity"))
        return [{ tenants: 2, banned: 1, retired: 1, private_bucket: 1, generated_object: 1 }];
      return structuredClone(sql.includes("s.id not in") ? plan.before : current);
    },
  };
  return { plan, p, current, dep, calls: () => calls };
}
test("exact retired fixture refresh retains old proof and protects all new rows without extending approval", async () => {
  const f = fixture(),
    old = structuredClone(f.plan),
    p = await refreshAfterPlayback(f.plan, f.p, f.dep);
  assert.deepEqual(f.plan, old);
  assert.deepEqual(p.compatibility057, old.compatibility057);
  assert.deepEqual(p.compatibility058.priorBaseline, old.before);
  assert.deepEqual(
    p.before,
    [...f.current].sort((a, b) => a.name.localeCompare(b.name)),
  );
  const { before, compatibility058, preserved, ...rest } = p;
  const { before: oldBefore, ...oldRest } = old;
  assert.deepEqual(rest, oldRest);
  assert.equal(f.calls(), 5);
  assert.equal(summary(p).providerRequests, 0);
  assert.doesNotMatch(JSON.stringify(summary(p)), /keyFingerprint|priorBaseline":|password/);
});
test("active access, wrong run or repeated refresh stop before external reads", async () => {
  for (const patch of [
    { state: "active" },
    { password: "PRIVATE" },
    { compatibility058: {} },
    { runId: id(999) },
  ]) {
    const f = fixture();
    Object.assign(f.plan, patch);
    await assert.rejects(refreshAfterPlayback(f.plan, f.p, f.dep));
    assert.equal(f.calls(), 0);
  }
  const f = fixture();
  f.p.state = "active";
  await assert.rejects(refreshAfterPlayback(f.plan, f.p, f.dep));
  assert.equal(f.calls(), 0);
});
test("unknown additions, changed old rows, unretired identity and wrong schema reject rather than rebaseline", async () => {
  for (const fault of ["extra", "old", "identity", "schema"]) {
    const f = fixture(),
      query = f.dep.query;
    if (fault === "extra") f.current.find((r) => r.name === "public.email_messages").count++;
    if (fault === "schema") f.dep.catalog = async () => ({ fingerprint: "0".repeat(32) });
    f.dep.query = async (sql) => {
      const rows = await query(sql);
      if (fault === "old" && sql.includes("s.id not in")) rows[0].fingerprint = "c".repeat(32);
      if (fault === "identity" && sql.includes("playback_retirement_identity")) rows[0].banned = 0;
      return rows;
    };
    await assert.rejects(refreshAfterPlayback(f.plan, f.p, f.dep));
    assert.equal(f.plan.compatibility058, undefined);
  }
});
test("drift between both scans rejects refresh", async () => {
  const f = fixture(),
    query = f.dep.query;
  let scans = 0;
  f.dep.query = async (sql) => {
    const rows = await query(sql);
    if (
      !sql.includes("playback_retirement_identity") &&
      !sql.includes("s.id not in") &&
      ++scans === 2
    )
      rows[0].count++;
    return rows;
  };
  await assert.rejects(refreshAfterPlayback(f.plan, f.p, f.dep));
});
