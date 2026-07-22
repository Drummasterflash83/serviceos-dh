// Runtime HTTP proof — work-projection / work-transition / view-as through their REAL
// served Edge Function contract (npx supabase functions serve). Uses real Supabase Auth
// JWTs. Proves auth, tenant resolution, envelopes, rejections, persistence, and View-As
// security end-to-end — not just the pure logic.
//
// Prereq: `npx supabase functions serve` running + local stack up.
// Run: node scripts/command-centre-http.test.mjs
import { createClient } from "@supabase/supabase-js";
import { resolveDemoPassword } from "./seed/_demo-secret.mjs";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const ANON = process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const T = "00000000-0000-0000-0000-0000000000b1";
const T2 = "00000000-0000-0000-0000-0000000000b2";
const SUPER = "cc-super@test.local", NORMAL = "cc-normal@test.local", OTHER = "cc-other@test.local";
const PW = resolveDemoPassword(URL);
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

async function findUser(email) {
  for (let p = 1; p <= 10; p++) {
    const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
    if (u) return u; if (data.users.length < 200) break;
  }
  return null;
}
async function ensureUser(email, tenant, role) {
  let u = await findUser(email);
  if (!u) u = (await db.auth.admin.createUser({ email, password: PW, email_confirm: true })).data.user;
  else await db.auth.admin.updateUserById(u.id, { password: PW });
  await db.from("profiles").upsert({ id: u.id, tenant_id: tenant, email, full_name: email.split("@")[0] });
  return u;
}
async function token(email) {
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error("signin " + email + ": " + error.message);
  return data.session.access_token;
}
async function call(fn, tok, body) {
  const headers = { "content-type": "application/json", apikey: ANON };
  if (tok) headers.Authorization = "Bearer " + tok;
  const r = await fetch(`${URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body ?? {}) });
  let json = null; try { json = await r.json(); } catch { /* */ }
  return { status: r.status, json };
}

async function cleanup() {
  for (const t of [T, T2]) {
    const objs = (await db.from("intelligence_objects").select("id").eq("tenant_id", t)).data ?? [];
    for (const o of objs) { await db.from("object_state_history").delete().eq("object_id", o.id); await db.from("objective_links").delete().eq("target_ref", o.id); }
    await db.from("intelligence_objects").delete().eq("tenant_id", t);
    await db.from("view_as_context").delete().eq("tenant_id", t);
    const mem = (await db.from("team_members").select("id").eq("tenant_id", t)).data ?? [];
    if (mem.length) await db.from("authority_grants").delete().eq("tenant_id", t).in("member_id", mem.map((m) => m.id));
    await db.from("team_members").delete().eq("tenant_id", t);
    await db.from("objectives").delete().eq("tenant_id", t);
    await db.from("config_versions").delete().eq("tenant_id", t);
  }
  for (const e of [SUPER, NORMAL, OTHER]) { const u = await findUser(e); if (u) { await db.from("profiles").delete().eq("id", u.id); } }
  await db.from("tenants").delete().eq("id", T);
  await db.from("tenants").delete().eq("id", T2);
}

try {
  await cleanup();
  await db.from("tenants").insert([{ id: T, slug: "cc-http", display_name: "CC HTTP", status: "active" },
    { id: T2, slug: "cc-http-2", display_name: "CC HTTP 2", status: "active" }]);
  const su = await ensureUser(SUPER, T, "owner");
  const nu = await ensureUser(NORMAL, T, "ops");
  const ou = await ensureUser(OTHER, T2, "ops");
  await db.from("profiles").update({ role: "owner" }).eq("id", su.id);
  await db.from("profiles").update({ role: "ops" }).eq("id", nu.id);

  // team members
  const superMem = (await db.from("team_members").insert({ tenant_id: T, profile_id: su.id, display_name: "Super", authority_level: "owner", observed_status: "confirmed", source: "test" }).select("id").single()).data;
  const normMem = (await db.from("team_members").insert({ tenant_id: T, profile_id: nu.id, display_name: "Normal", formal_role: "Coordinator", authority_level: "individual", observed_status: "confirmed", source: "test" }).select("id").single()).data;
  await db.from("authority_grants").insert({ tenant_id: T, member_id: superMem.id, permission: "tenant.superadmin", scope: "company", confirmed: true });

  // objective + a couple of action work items owned by NORMAL
  const cv = (await db.from("config_versions").insert({ tenant_id: T, artifact_kind: "operating_profile", artifact_key: "cc", version: 1, status: "draft", author: "test" }).select("id").single()).data;
  const obj = (await db.from("objectives").insert({ tenant_id: T, objective_type: "operational_target", title: "Protect margin", status: "draft", source: "test", version_id: cv.id }).select("id").single()).data;
  const io = (await db.from("intelligence_objects").insert({ tenant_id: T, domain: "serviceos", object_type: "Action", subject: "Quote Further Works at site 12", status: "proposed", attributes: { done_when: "Quote sent" }, accountable_ref: { kind: "user", ref: NORMAL }, responsible_ref: { kind: "user", ref: NORMAL } }).select("id").single()).data;
  await db.from("objective_links").insert({ tenant_id: T, objective_id: obj.id, target_kind: "intelligence_object", target_ref: io.id, relation: "contributes_to", approved: true });

  const superTok = await token(SUPER), normTok = await token(NORMAL), otherTok = await token(OTHER);

  // ── work-projection ────────────────────────────────────────────────────────
  const wpNoAuth = await call("work-projection", null, {});
  ok(wpNoAuth.status === 401 || wpNoAuth.json?.ok === false, "work-projection: unauthenticated rejected");
  const wp = await call("work-projection", normTok, {});
  ok(wp.json?.ok === true, "work-projection: authenticated request ok");
  ok(wp.json?.data?.user?.userRef === NORMAL, "work-projection: resolves the caller (tenant + user)");
  const mine = (wp.json?.data?.all ?? []).find((w) => w.id === io.id);
  ok(!!mine, "work-projection: returns the caller's action work item");
  ok(mine?.objectiveTitle === "Protect margin", "work-projection: objective linkage surfaced");
  ok(mine?.doneWhen === "Quote sent", "work-projection: done_when surfaced from attributes");
  ok(Array.isArray(mine?.explanation?.factors) && mine.explanation.whyHere.length > 0, "work-projection: ranking explanation present");

  // ── work-transition ────────────────────────────────────────────────────────
  const bad = await call("work-transition", normTok, { object_id: io.id, verb: "complete", evidence: "x" });
  ok(bad.json?.ok === false, "work-transition: illegal complete-from-proposed rejected");
  const ack = await call("work-transition", normTok, { object_id: io.id, verb: "acknowledge" });
  ok(ack.json?.ok === true && ack.json?.to === "ready", "work-transition: acknowledge proposed→ready persists");
  const refetched = (await db.from("intelligence_objects").select("status").eq("id", io.id).single()).data;
  ok(refetched.status === "ready", "work-transition: status survives re-fetch (server-persisted)");
  const hist = (await db.from("object_state_history").select("id").eq("object_id", io.id)).data ?? [];
  ok(hist.length === 1, "work-transition: exactly one history row written");
  // move to in_progress then attempt complete without evidence (done_when present) → fail
  await call("work-transition", normTok, { object_id: io.id, verb: "start" });
  const noEv = await call("work-transition", normTok, { object_id: io.id, verb: "complete" });
  ok(noEv.json?.ok === false && noEv.json?.error?.code === "evidence_required", "work-transition: complete without evidence rejected (done_when gate)");

  // ── view-as ──────────────────────────────────────────────────────────────────
  const openNormal = await call("view-as", normTok, { action: "open", subject_kind: "user", subject_ref: nu.id });
  ok(openNormal.json?.ok === false, "view-as: non-Superadmin cannot open");
  const openSuper = await call("view-as", superTok, { action: "open", subject_kind: "user", subject_ref: nu.id });
  ok(openSuper.json?.ok === true && openSuper.json?.context?.read_only === true, "view-as: Superadmin opens a read-only context");
  const ctxId = openSuper.json?.context?.id;
  const openCross = await call("view-as", superTok, { action: "open", subject_kind: "user", subject_ref: ou.id });
  ok(openCross.json?.ok === false, "view-as: cross-tenant subject rejected");
  const resolve = await call("view-as", superTok, { action: "resolve", context_id: ctxId });
  ok(resolve.json?.ok === true && resolve.json?.actor?.ref === SUPER, "view-as: resolve retains the REAL actor (Chris), not the subject");
  ok(resolve.json?.viewingAs?.ref === nu.id && resolve.json?.readOnly === true, "view-as: resolves subject read-only");

  // work-projection re-scoped through a View-As context = the SUBJECT's Command Centre, read-only
  const wpView = await call("work-projection", superTok, { view_as_context_id: ctxId });
  ok(wpView.json?.ok === true && wpView.json?.data?.readOnly === true, "work-projection View-As: read-only projection returned");
  ok(wpView.json?.data?.user?.userRef === NORMAL, "work-projection View-As: scoped to the SUBJECT, not the actor");
  ok(wpView.json?.data?.viewingAs?.ref === nu.id, "work-projection View-As: reports the viewed subject");
  const wpViewNorm = await call("work-projection", normTok, { view_as_context_id: ctxId });
  ok(wpViewNorm.json?.ok === false, "work-projection View-As: a non-owner/non-Superadmin cannot use the context");
  // A mutation while the actor holds an active View-As context is refused SERVER-SIDE.
  const mutWhileView = await call("work-transition", superTok, { object_id: io.id, verb: "acknowledge" });
  ok(mutWhileView.json?.ok === false && mutWhileView.json?.error?.code === "read_only_view_active", "work-transition: mutation refused server-side while a View-As context is active");
  const exit = await call("view-as", superTok, { action: "exit", context_id: ctxId });
  ok(exit.json?.ok === true, "view-as: immediate exit");
  const afterExit = await call("view-as", superTok, { action: "resolve", context_id: ctxId });
  ok(afterExit.json?.ok === false, "view-as: exited context no longer usable");

  await cleanup();
  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) { console.error("ERROR", e.message); try { await cleanup(); } catch { /* */ } process.exit(1); }
