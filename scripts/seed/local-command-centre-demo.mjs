// LOCAL-ONLY seed for authenticated Command Centre proof (never for remote).
// Creates a controlled tenant with six role users (Superadmin/MD, Senior leader, Operations,
// Scheduling, Finance, Engineer) and role-owned action work items, so the authenticated /app
// Command Centre + View-As can be exercised against REAL work-projection data on the local
// stack. Idempotent. Demo credentials are for the LOCAL stack only and are NOT production.
//
// Run: node scripts/seed/local-command-centre-demo.mjs
import { createClient } from "@supabase/supabase-js";
import { resolveDemoPassword } from "./_demo-secret.mjs";
const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const T = "0000cc00-0000-0000-0000-0000000000cc";
const PW = resolveDemoPassword(URL); // env COMMAND_CENTRE_DEMO_PASSWORD, or ephemeral local-only
const USERS = [
  { email: "chris.cc@demo.local", name: "Chris Drummond", role: "owner", auth: "owner", grants: ["tenant.superadmin", "work.assign", "work.approve", "ownership.confirm"], formal: "Tenant Superadmin (MD)" },
  { email: "sam.cc@demo.local", name: "Sam", role: "admin", auth: "director", grants: ["work.approve", "work.assign", "ownership.confirm"], formal: "Managing Director" },
  { email: "rudi.cc@demo.local", name: "Rudi", role: "ops", auth: "lead", grants: ["work.assign"], formal: "Operations Coordinator" },
  { email: "julie.cc@demo.local", name: "Julie", role: "ops", auth: "individual", grants: [], formal: "Scheduling Coordinator" },
  { email: "elaine.cc@demo.local", name: "Elaine", role: "ops", auth: "lead", grants: ["work.approve"], formal: "Finance & Operations Coordinator" },
  { email: "tony.cc@demo.local", name: "Tony", role: "viewer", auth: "individual", grants: [], formal: "Field Engineer" },
];

async function findUser(email) {
  for (let p = 1; p <= 10; p++) {
    const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
    if (u) return u; if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  const objs = (await db.from("intelligence_objects").select("id").eq("tenant_id", T)).data ?? [];
  for (const o of objs) { await db.from("object_state_history").delete().eq("object_id", o.id); await db.from("objective_links").delete().eq("target_ref", o.id); }
  await db.from("intelligence_objects").delete().eq("tenant_id", T);
  const mem = (await db.from("team_members").select("id").eq("tenant_id", T)).data ?? [];
  if (mem.length) { await db.from("authority_grants").delete().eq("tenant_id", T).in("member_id", mem.map((m) => m.id)); await db.from("responsibility_assignments").delete().eq("tenant_id", T).in("member_id", mem.map((m) => m.id)); }
  await db.from("team_members").delete().eq("tenant_id", T);
  await db.from("objective_health").delete().eq("tenant_id", T);
  await db.from("objectives").delete().eq("tenant_id", T);
  await db.from("config_versions").delete().eq("tenant_id", T);
  await db.from("tenants").upsert({ id: T, slug: "cc-demo", display_name: "Command Centre Demo", status: "active" });

  const members = {};
  for (const u of USERS) {
    let au = await findUser(u.email);
    if (!au) au = (await db.auth.admin.createUser({ email: u.email, password: PW, email_confirm: true })).data.user;
    else await db.auth.admin.updateUserById(au.id, { password: PW });
    await db.from("profiles").upsert({ id: au.id, tenant_id: T, email: u.email, full_name: u.name, role: u.role });
    const m = (await db.from("team_members").insert({ tenant_id: T, profile_id: au.id, display_name: u.name, formal_role: u.formal, authority_level: u.auth, observed_status: "confirmed", source: "local_demo" }).select("id").single()).data;
    members[u.email] = { memberId: m.id, uid: au.id };
    if (u.grants.length) await db.from("authority_grants").insert(u.grants.map((g) => ({ tenant_id: T, member_id: m.id, permission: g, scope: "company", confirmed: true })));
  }

  const cv = (await db.from("config_versions").insert({ tenant_id: T, artifact_kind: "operating_profile", artifact_key: "cc_demo", version: 1, status: "draft", author: "local_demo" }).select("id").single()).data;
  const mkObj = async (title, type) => (await db.from("objectives").insert({ tenant_id: T, objective_type: type, title, status: "draft", source: "openfolk_proposed", version_id: cv.id }).select("id").single()).data.id;
  const objMargin = await mkObj("Protect Further Works margin", "operational_target");
  const objSafety = await mkObj("Zero safety incidents", "risk_reduction");
  const objCapacity = await mkObj("Increase capacity without proportional overhead", "operational_target");
  await db.from("objective_health").insert([
    { tenant_id: T, objective_id: objMargin, status: "at_risk", progress: 0.4, evaluator_version: "demo" },
    { tenant_id: T, objective_id: objSafety, status: "at_risk", progress: 0.2, evaluator_version: "demo" },
    { tenant_id: T, objective_id: objCapacity, status: "at_risk", progress: 0.5, evaluator_version: "demo" },
  ]);
  // objective ownership (accountable)
  const own = async (email, objId, label) => db.from("responsibility_assignments").insert({ tenant_id: T, member_id: members[email].memberId, kind: "objective", target_ref: objId, label, raci_role: "accountable", source: "local_demo" });
  await own("chris.cc@demo.local", objMargin, "Owns margin");
  await own("sam.cc@demo.local", objCapacity, "Owns capacity");

  const mkAction = async (subject, owner, status, attrs, objId) => {
    const io = (await db.from("intelligence_objects").insert({
      tenant_id: T, domain: "serviceos", object_type: "Action", subject, status,
      attributes: attrs, accountable_ref: { kind: "user", ref: owner }, responsible_ref: { kind: "user", ref: owner },
      confidence: 0.8, deadline: attrs.deadline ?? null,
    }).select("id").single()).data;
    if (objId) { const lr = await db.from("objective_links").insert({ tenant_id: T, objective_id: objId, target_kind: "intelligence_object", target_ref: io.id, relation: "contributes_to", approved: true }); if (lr.error) console.error("link:", lr.error.message); }
    return io;
  };
  const soon = new Date(Date.now() + 5 * 3.6e6).toISOString();
  const overdue = new Date(Date.now() - 6 * 3.6e6).toISOString();

  // MD / Superadmin (Chris) — strategic + all material work
  await mkAction("Further Works SLA breach — 3 quotes >48h", "chris.cc@demo.local", "in_progress", { done_when: "All quotes issued within SLA", deadline: overdue }, objMargin);
  await mkAction("Approve New Dawn ARR target amendment (£700k+)", "chris.cc@demo.local", "proposed", { done_when: "Amendment confirmed & published" }, objMargin);
  // Senior leader (Sam)
  await mkAction("Engineer capacity shortfall next week", "sam.cc@demo.local", "ready", { done_when: "Cover plan agreed", deadline: soon }, objCapacity);
  await mkAction("Approve specialist-client rate override", "sam.cc@demo.local", "in_progress", { done_when: "Override approved with authority basis" }, objMargin);
  // Operations (Rudi)
  await mkAction("3 job sheets unprocessed >24h", "rudi.cc@demo.local", "ready", { done_when: "Sheets processed in Commusoft", deadline: soon }, objMargin);
  await mkAction("Parts blocker: boiler flue kit on backorder", "rudi.cc@demo.local", "blocked", { blocker: "Supplier backorder ETA 5d" }, null);
  // Scheduling (Julie)
  await mkAction("New enquiry — Mrs Okafor, no-heat callout", "julie.cc@demo.local", "ready", { done_when: "Visit booked & confirmed", deadline: soon, customer_id: "cust-okafor" }, null);
  await mkAction("Accepted quote — schedule follow-up (Harden Ltd)", "julie.cc@demo.local", "waiting", { customer_id: "cust-harden" }, objMargin);
  // Finance (Elaine)
  await mkAction("GP exception on invoice INV-4821 (margin 21%)", "elaine.cc@demo.local", "ready", { done_when: "Margin corrected or exception approved" }, objMargin);
  await mkAction("5 jobs invoice-ready, evidence gaps on 2", "elaine.cc@demo.local", "ready", { done_when: "Invoices raised" }, null);
  // Engineer (Tony)
  await mkAction("RAMS missing before Kingsway plant-room works", "tony.cc@demo.local", "blocked", { done_when: "Approved RAMS uploaded", blocker: "No RAMS on file" }, objSafety);
  await mkAction("Boiler service — 14 Meadow Rd", "tony.cc@demo.local", "ready", { done_when: "Signed service sheet on site", deadline: soon }, null);

  console.log("Seeded tenant cc-demo (LOCAL). Sign in at /login:");
  for (const u of USERS) console.log(`  ${u.email} / ${PW}  (${u.formal})`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
