// Regression test — secure View-As (view_as edge fn + pure core).
// Proves: only a Superadmin may open; cross-tenant rejected; unassigned allowed; supervised
// mode separately permissioned; read-only default; contexts are actor-only, expire, and end;
// and the RLS policy scopes reads to the actor (browser can't read others' contexts).
//
// Run:  node --experimental-strip-types scripts/view-as.test.mjs
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { authorizeOpen, isContextUsable } from "../supabase/functions/_shared/view_as.ts";

const URL = process.env.SUPABASE_URL || "http://127.0.0.1:54321";
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const db = createClient(URL, SR, { auth: { persistSession: false } });
const T = "00000000-0000-0000-0000-0000000000f1";
const ACTOR = "00000000-0000-0000-0000-0000000000fa";
const OTHER = "00000000-0000-0000-0000-0000000000fb";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };
const NOW = Date.parse("2026-07-22T12:00:00Z");

// ═══ 1. PURE authorization ═══════════════════════════════════════════════════
ok(!authorizeOpen({ actorIsSuperadmin: false, actorTenantId: T, subjectKind: "user", subjectTenantId: T, mode: "view", supervisedAllowed: false }).ok, "non-Superadmin cannot open View-As");
ok(!authorizeOpen({ actorIsSuperadmin: true, actorTenantId: T, subjectKind: "user", subjectTenantId: "other", mode: "view", supervisedAllowed: false }).ok, "cross-tenant subject rejected");
ok(authorizeOpen({ actorIsSuperadmin: true, actorTenantId: T, subjectKind: "unassigned", subjectTenantId: null, mode: "view", supervisedAllowed: false }).ok, "unassigned subject allowed (same-tenant not required)");
const sup = authorizeOpen({ actorIsSuperadmin: true, actorTenantId: T, subjectKind: "user", subjectTenantId: T, mode: "supervised_test", supervisedAllowed: false });
ok(!sup.ok && sup.code === "supervised_not_permitted", "supervised_test refused unless separately permitted");
const view = authorizeOpen({ actorIsSuperadmin: true, actorTenantId: T, subjectKind: "user", subjectTenantId: T, mode: "view", supervisedAllowed: false });
ok(view.ok && view.readOnly === true, "view mode is read-only by default");

// ═══ 2. PURE usability ═══════════════════════════════════════════════════════
const base = { ended_at: null, expires_at: new Date(NOW + 1e6).toISOString(), read_only: true, actor_user_id: ACTOR };
ok(!isContextUsable({ ...base, actor_user_id: OTHER }, ACTOR, NOW).usable, "context belonging to another actor is not usable");
ok(!isContextUsable({ ...base, ended_at: new Date(NOW - 1).toISOString() }, ACTOR, NOW).usable, "exited context is not usable");
ok(!isContextUsable({ ...base, expires_at: new Date(NOW - 1).toISOString() }, ACTOR, NOW).usable, "expired context is not usable");
ok(isContextUsable(base, ACTOR, NOW).usable, "own, active, unexpired context is usable");

// ═══ 3. DB — real rows + RLS shape ═══════════════════════════════════════════
async function cleanup() { await db.from("view_as_context").delete().eq("tenant_id", T); await db.from("tenants").delete().eq("id", T); }
try {
  await cleanup();
  await db.from("tenants").insert({ id: T, slug: "va-test", display_name: "VA Test", status: "active" });
  const mk = (o) => db.from("view_as_context").insert({ tenant_id: T, actor_user_id: ACTOR, subject_kind: "user", subject_ref: OTHER, mode: "view", read_only: true, ...o }).select("*").single();
  const active = (await mk({ expires_at: new Date(Date.now() + 6e5).toISOString() })).data;
  const expired = (await mk({ expires_at: new Date(Date.now() - 6e5).toISOString() })).data;
  ok(isContextUsable(active, ACTOR, Date.now()).usable, "DB: freshly-created context is usable by its actor");
  ok(!isContextUsable(expired, ACTOR, Date.now()).usable, "DB: past-expiry context rejected");
  ok(!isContextUsable(active, OTHER, Date.now()).usable, "DB: a different user cannot use the actor's context");

  // RLS policy scopes browser reads to the actor (actor_user_id = auth.uid()).
  const pol = execFileSync("docker", ["exec", "supabase_db_serviceos-dh", "psql", "-U", "postgres", "-d", "postgres", "-tAc",
    "select qual from pg_policies where tablename='view_as_context' and cmd='SELECT'"], { encoding: "utf8" });
  ok(/actor_user_id/.test(pol) && /auth\.uid/.test(pol), "RLS SELECT policy scopes reads to actor_user_id = auth.uid()");
  ok(!/INSERT|UPDATE|DELETE/.test(execFileSync("docker", ["exec", "supabase_db_serviceos-dh", "psql", "-U", "postgres", "-d", "postgres", "-tAc",
    "select string_agg(cmd,',') from pg_policies where tablename='view_as_context'"], { encoding: "utf8" })), "no browser write policy on view_as_context (writes = service-role only)");

  await cleanup();
  console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
} catch (e) { console.error("ERROR", e.message); try { await cleanup(); } catch { /**/ } process.exit(1); }
