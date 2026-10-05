// Regression test — automation intent semantic de-dup guard (migration 20260817120000).
//
// Proves automation_intents_active_dedup_uk: at most ONE pending intent per
// (tenant, dedup_key), so the generic "record a controlled internal note" flood
// cannot regenerate for the same entity/day — WHILE genuinely distinct incidents
// (different dedup_key: other entity / day / type) are preserved, and unkeyed
// (dedup_key = NULL) rows are never de-duplicated.
//
// SAFE: unique-tagged test tenant + object; all rows deleted in finally.
// Run against a DB with the migration applied (local: 127.0.0.1:54322).
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const T = "00000000-0000-0000-0000-0000000000db";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };
const key = `record_internal_note:ent-A:2026-07-21`;

async function cleanup() {
  await db.from("automation_intents").delete().eq("tenant_id", T);
  await db.from("intelligence_objects").delete().eq("tenant_id", T);
  await db.from("tenants").delete().eq("id", T);
}
async function obj() {
  const { data } = await db.from("intelligence_objects").insert({
    tenant_id: T, domain: "core", object_type: "Action", subject: "Record a controlled internal note",
    status: "ready", created_by: "system", created_from: "test",
  }).select("id").single();
  return data.id;
}
async function insertIntent(dedup_key) {
  return db.from("automation_intents").insert({
    tenant_id: T, action_object_id: await obj(), intent_type: "record_internal_note",
    status: "pending", dedup_key,
  }).select("id").single();
}

try {
  await cleanup();
  await db.from("tenants").insert({ id: T, slug: "dedup-test", display_name: "Dedup Test", status: "active" });

  const a = await insertIntent(key);
  ok(!a.error && a.data, "first pending intent with a dedup_key is accepted");

  const b = await insertIntent(key);
  ok(b.error && b.error.code === "23505",
    `second PENDING intent with the SAME dedup_key is REJECTED (got ${b.error?.code}) — no regeneration`);

  const c = await insertIntent(`record_internal_note:ent-B:2026-07-21`);
  ok(!c.error, "different entity (distinct incident) is ALLOWED — distinct incidents not collapsed");
  const d = await insertIntent(`record_internal_note:ent-A:2026-07-22`);
  ok(!d.error, "different day is ALLOWED — not over-collapsed");

  const n1 = await insertIntent(null);
  const n2 = await insertIntent(null);
  ok(!n1.error && !n2.error, "NULL dedup_key rows are never de-duplicated (existing/unkeyed rows unaffected)");

  // once the first goes terminal, the key frees (no false permanent lockout)
  await db.from("automation_intents").update({ dedup_key: null }).eq("id", a.data.id); // simulate supersede/clear
  const e = await insertIntent(key);
  ok(!e.error, "after the active intent is cleared, a fresh intent for the key is allowed again");
} catch (e) {
  console.error("ERROR:", e.message); fail++;
} finally {
  await cleanup();
  console.log(fail === 0 ? "\n✅ AUTOMATION DEDUP GUARD TEST PASSED" : `\n❌ ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
