// Regression test — resolveUserOwnership (user-ownership Edge Function).
// Proves the resolver answers, for a user: roles (formal+observed), objectives owned,
// responsibilities (incl. weekday/escalation), authority, agent configure-vs-observe
// split, work approval, effective-date filtering, and explainable reasons.
//
// Serve locally: supabase functions serve user-ownership --env-file <WORKER_SECRET> --no-verify-jwt
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<local sr> \
//   WORKER_SECRET=local-test-worker-secret node scripts/ownership-resolver.test.mjs
import { createClient } from "@supabase/supabase-js";
const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const WORKER = process.env.WORKER_SECRET || "local-test-worker-secret";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const T = "00000000-0000-0000-0000-0000000000c1";
const USER = "00000000-0000-0000-0000-0000000000c2";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

async function cleanup() {
  const mem = (await db.from("team_members").select("id").eq("tenant_id", T)).data ?? [];
  const ids = mem.map((m) => m.id);
  if (ids.length) {
    await db.from("authority_grants").delete().eq("tenant_id", T).in("member_id", ids);
    await db.from("responsibility_assignments").delete().eq("tenant_id", T).in("member_id", ids);
  }
  await db.from("team_members").delete().eq("tenant_id", T);
  const objs = (await db.from("objectives").select("id").eq("tenant_id", T)).data ?? [];
  if (objs.length) await db.from("objective_metrics").delete().eq("tenant_id", T).in("objective_id", objs.map((o) => o.id));
  await db.from("objectives").delete().eq("tenant_id", T);
  await db.from("config_versions").delete().eq("tenant_id", T);
  await db.from("tenants").delete().eq("id", T);
}

try {
  await cleanup();
  await db.from("tenants").insert({ id: T, slug: "own-test", display_name: "Own Test", status: "active" });
  const cv = (await db.from("config_versions").insert({ tenant_id: T, artifact_kind: "operating_profile", artifact_key: "strategic_objectives", version: 1, status: "draft", author: "openfolk" }).select("id").single()).data;
  const obj = (await db.from("objectives").insert({ tenant_id: T, objective_type: "operational_target", title: "Reduce dropped actions", status: "draft", source: "openfolk_proposed", version_id: cv.id }).select("id").single()).data;
  const member = (await db.from("team_members").insert({ tenant_id: T, profile_id: USER, display_name: "Test Manager", formal_role: "Operations Manager", observed_role: "Runs scheduling + escalation", observed_status: "proposed", authority_level: "director", source: "openfolk_proposed" }).select("id").single()).data;
  const M = member.id;
  const rIns = await db.from("responsibility_assignments").insert([
    { tenant_id: T, member_id: M, kind: "objective", target_ref: obj.id, label: "Owns: reduce dropped actions", raci_role: "accountable", source: "openfolk_proposed" },
    { tenant_id: T, member_id: M, kind: "responsibility_area", target_ref: "scheduling", label: "Scheduling (Mon/Wed)", raci_role: "responsible", weekday_mask: 5, source: "openfolk_proposed" },
    { tenant_id: T, member_id: M, kind: "escalation", target_ref: "senior", label: "Escalation", raci_role: "accountable", source: "openfolk_proposed" },
  ]);
  if (rIns.error) throw new Error("responsibilities insert: " + rIns.error.message);
  const nowIso = new Date().toISOString();
  const gIns = await db.from("authority_grants").insert([
    { tenant_id: T, member_id: M, permission: "agent.configure", scope: "company", source: "openfolk_proposed", effective_from: nowIso },
    { tenant_id: T, member_id: M, permission: "agent.view", scope: "self", source: "openfolk_proposed", effective_from: nowIso },
    { tenant_id: T, member_id: M, permission: "work.approve", scope: "company", source: "openfolk_proposed", effective_from: nowIso },
    // EXPIRED grant — must be filtered out by effective-date awareness
    { tenant_id: T, member_id: M, permission: "agent.retire", scope: "company", source: "openfolk_proposed", effective_from: "2020-01-01T00:00:00Z", effective_to: "2020-02-01T00:00:00Z" },
  ]);
  if (gIns.error) throw new Error("grants insert: " + gIns.error.message);

  let res;
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${URL}/functions/v1/user-ownership`, {
      method: "POST", headers: { "content-type": "application/json", "x-openfolk-secret": WORKER },
      body: JSON.stringify({ tenant_id: T, user_id: USER }),
    }).catch(() => null);
    if (r && r.status === 200) { res = (await r.json()).ownership; break; }
    await new Promise((x) => setTimeout(x, 1500));
  }

  console.log("\n--- assertions ---");
  ok(!!res, "resolver returned ownership");
  ok(res?.user?.memberId === M, "resolves the user to their team member");
  ok(res?.roles?.some((r) => r.includes("Operations Manager")) && res?.roles?.some((r) => r.includes("proposed")), "returns formal + observed(proposed) roles");
  ok(res?.objectives?.length === 1 && res.objectives[0].id === obj.id && res.objectives[0].raci === "accountable", "resolves the owned objective (accountable) with a reason");
  ok(res?.responsibilities?.some((r) => r.kind === "responsibility_area" && r.weekdayMask === 5), "resolves weekday-scoped responsibility");
  ok(res?.responsibilities?.some((r) => r.kind === "escalation"), "resolves escalation ownership");
  ok(res?.agents?.configurable === true && res.agents.observeOnly === false, "agent authority: configurable (not observe-only)");
  ok(!res?.authority?.some((a) => a.permission === "agent.retire"), "EXPIRED grant filtered out (effective-date aware)");
  ok(res?.canApproveWork === true, "holds work-approval authority");
  ok(Array.isArray(res?.reasons) && res.reasons.length > 0, "returns explainable reasons, not only ids");
} catch (e) {
  console.error("ERROR:", e.message); fail++;
} finally {
  await cleanup();
  console.log(fail === 0 ? "\n✅ OWNERSHIP RESOLVER TEST PASSED" : `\n❌ ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
