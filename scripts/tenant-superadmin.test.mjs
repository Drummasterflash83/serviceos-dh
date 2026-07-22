// Regression test — Tenant Superadmin grant mechanism + handoff script.
// Proves against the LOCAL stack: dry-run writes nothing; --apply grants a tenant-scoped,
// revocable tenant.superadmin; idempotent; refuses missing identity and cross-tenant; and
// the grant is distinct from platform/openfolk (a plain authority_grants row).
//
// Run:  node scripts/tenant-superadmin.test.mjs
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { resolveDemoPassword } from "./seed/_demo-secret.mjs";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const T = "00000000-0000-0000-0000-0000000000e1";
const T2 = "00000000-0000-0000-0000-0000000000e2";
const EMAIL = "ts-super@test.local";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

function run(args) {
  try {
    const out = execFileSync("node", ["scripts/seed/grant-tenant-superadmin.mjs", ...args],
      { env: { ...process.env, SUPABASE_URL: URL, SUPABASE_SERVICE_ROLE_KEY: SR }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) { return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") }; }
}
const activeGrants = async (t) => ((await db.from("authority_grants").select("id, scope, permission")
  .eq("tenant_id", t).eq("permission", "tenant.superadmin").is("effective_to", null)).data ?? []);

async function findUser(email) {
  for (let p = 1; p <= 10; p++) {
    const { data } = await db.auth.admin.listUsers({ page: p, perPage: 200 });
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email);
    if (u) return u;
    if (data.users.length < 200) break;
  }
  return null;
}
async function cleanup() {
  const u = await findUser(EMAIL);
  for (const t of [T, T2]) {
    const mem = (await db.from("team_members").select("id").eq("tenant_id", t)).data ?? [];
    if (mem.length) await db.from("authority_grants").delete().eq("tenant_id", t).in("member_id", mem.map((m) => m.id));
    await db.from("team_members").delete().eq("tenant_id", t);
    if (u) await db.from("profiles").delete().eq("id", u.id).eq("tenant_id", t);
    await db.from("tenants").delete().eq("id", t);
  }
  if (u) { await db.from("profiles").delete().eq("id", u.id); await db.auth.admin.deleteUser(u.id); }
}

try {
  await cleanup();
  await db.from("tenants").insert([{ id: T, slug: "ts-drummonds", display_name: "TS Drummonds", status: "active" },
    { id: T2, slug: "ts-other", display_name: "TS Other", status: "active" }]);
  const created = await db.auth.admin.createUser({ email: EMAIL, password: resolveDemoPassword(URL), email_confirm: true });
  if (created.error) throw new Error("createUser: " + created.error.message);
  const uid = created.data.user.id;
  // createUser may auto-create a null-tenant profile (handle_new_user); upsert to bind it to T.
  await db.from("profiles").upsert({ id: uid, tenant_id: T, email: EMAIL, full_name: "TS Super" });

  // 1. missing identity refused
  ok(run(["--email", "nobody@nowhere.local", "--tenant", "ts-drummonds", "--apply"]).code !== 0, "refuses when auth user does not exist");

  // 2. cross-tenant refused (profile is in T, granting on T2)
  ok(run(["--email", EMAIL, "--tenant", "ts-other", "--apply"]).code !== 0, "refuses cross-tenant grant (profile belongs to a different tenant)");

  // 3. dry-run writes nothing
  const dry = run(["--email", EMAIL, "--tenant", "ts-drummonds"]);
  ok(dry.code === 0 && /DRY-RUN/.test(dry.out), "dry-run succeeds and is labelled");
  ok((await activeGrants(T)).length === 0, "dry-run wrote NO grant");

  // 4. apply grants tenant-scoped company superadmin
  const ap = run(["--email", EMAIL, "--tenant", "ts-drummonds", "--apply"]);
  ok(ap.code === 0 && /GRANTED/.test(ap.out), "--apply grants tenant.superadmin");
  let g = await activeGrants(T);
  ok(g.length === 1 && g[0].scope === "company", "exactly one active company-scope grant");

  // 5. idempotent
  const ap2 = run(["--email", EMAIL, "--tenant", "ts-drummonds", "--apply"]);
  ok(ap2.code === 0 && /idempotent no-op/.test(ap2.out), "re-apply is an idempotent no-op");
  ok((await activeGrants(T)).length === 1, "still exactly one active grant after re-apply");

  // 6. distinct from platform/openfolk — it's a tenant-scoped authority_grants row, and the
  //    user's profile.role is untouched (not elevated to owner/openfolk)
  const prof = (await db.from("profiles").select("role").eq("id", uid).single()).data;
  ok(prof.role !== "openfolk", "grant did NOT elevate profile.role to openfolk (no cross-tenant power)");

  // 7. no grant leaked into the OTHER tenant
  ok((await activeGrants(T2)).length === 0, "no grant in unrelated tenant (tenant isolation)");

  // 8. revoke
  const rv = run(["--email", EMAIL, "--tenant", "ts-drummonds", "--revoke", "--apply"]);
  ok(rv.code === 0 && /REVOKED/.test(rv.out), "--revoke succeeds");
  ok((await activeGrants(T)).length === 0, "no active grant after revoke (reversible)");

  await cleanup();
  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) {
  console.error("ERROR", e.message);
  try { await cleanup(); } catch { /* ignore */ }
  process.exit(1);
}
