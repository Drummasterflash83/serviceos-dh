// Grant (or revoke) the tenant-scoped `tenant.superadmin` authority to a real user.
//
// SAFE BY DESIGN — this NEVER creates an auth identity. It resolves an EXISTING
// auth.users row + tenant, enforces one-tenant-per-profile, and writes an auditable,
// reversible authority_grants row via the mechanism from migration
// 20260819120000_view_as_and_superadmin.sql. Idempotent; dry-run by default.
//
// Distinct from is_openfolk() and from profiles.role='owner': this is a tenant-scoped
// grant, revocable and effective-date-aware, with NO cross-tenant or platform authority.
//
// Usage:
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/seed/grant-tenant-superadmin.mjs \
//     --email chris@allkin.co --tenant drummonds            # DRY-RUN plan (default)
//     … --email chris@allkin.co --tenant drummonds --apply  # perform the grant
//     … --email chris@allkin.co --tenant drummonds --revoke --apply
//   (--uid <auth uid> may be used instead of --email; --tenant accepts a slug or uuid.)
//
// Refuses when: the auth user does not exist; >1 identity resolves; the tenant is
// ambiguous/missing; the user's profile belongs to a different tenant; or a conflicting
// active grant exists on --revoke absence. Emits an audit_logs row on apply.
import { createClient } from "@supabase/supabase-js";

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) => {
  if (!a.startsWith("--")) return [];
  const k = a.slice(2);
  const v = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true;
  return [[k, v]];
}));
const APPLY = args.apply === true;
const REVOKE = args.revoke === true;
const die = (m) => { console.error("REFUSED: " + m); process.exit(1); };

const URL = process.env.SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) die("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
if (!args.email && !args.uid) die("provide --email or --uid");
if (!args.tenant) die("provide --tenant (slug or uuid)");
const db = createClient(URL, SR, { auth: { persistSession: false } });
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function resolveAuthUser() {
  if (args.uid) {
    const { data, error } = await db.auth.admin.getUserById(String(args.uid));
    if (error || !data?.user) die(`no auth.users row for uid ${args.uid} — the user must sign up first (identity is never fabricated)`);
    return data.user;
  }
  // Page through auth users to find an EXACT, UNIQUE email match.
  const target = String(args.email).toLowerCase();
  const matches = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) die("could not list auth users: " + error.message);
    for (const u of data.users) if ((u.email ?? "").toLowerCase() === target) matches.push(u);
    if (data.users.length < 200) break;
  }
  if (matches.length === 0) die(`no auth.users row for ${args.email} — the user must exist in this project first (identity is never fabricated)`);
  if (matches.length > 1) die(`${matches.length} auth identities resolve for ${args.email} — refusing to guess`);
  return matches[0];
}

async function resolveTenant() {
  const q = isUuid(String(args.tenant)) ? db.from("tenants").select("id, slug, display_name").eq("id", args.tenant)
    : db.from("tenants").select("id, slug, display_name").eq("slug", args.tenant);
  const { data } = await q;
  if (!data || data.length === 0) die(`no tenant matches "${args.tenant}"`);
  if (data.length > 1) die(`tenant "${args.tenant}" is ambiguous (${data.length} matches)`);
  return data[0];
}

try {
  const user = await resolveAuthUser();
  const tenant = await resolveTenant();

  // one-tenant-per-profile: the profile must belong to THIS tenant.
  const { data: profile } = await db.from("profiles").select("id, tenant_id, email, full_name").eq("id", user.id).maybeSingle();
  if (!profile) die(`user ${user.email} has no profile row — provision their profile in tenant ${tenant.slug} first`);
  if (!profile.tenant_id) die(`user's profile has no tenant assigned — provision it in tenant ${tenant.slug} before granting (identity is never auto-bound)`);
  if (profile.tenant_id !== tenant.id) die(`user's profile belongs to a different tenant (${profile.tenant_id}) — cross-tenant grant is not allowed`);

  // find or create the person's team_members row (grants bind to a member).
  let { data: member } = await db.from("team_members").select("id, display_name").eq("tenant_id", tenant.id).eq("profile_id", user.id).is("effective_to", null).maybeSingle();
  const plan = {
    action: REVOKE ? "revoke" : "grant", user: { id: user.id, email: user.email }, tenant: { id: tenant.id, slug: tenant.slug },
    member: member?.id ?? "(will be created)", permission: "tenant.superadmin", scope: "company",
  };
  console.log((APPLY ? "APPLYING" : "DRY-RUN — plan (re-run with --apply)") + ":\n" + JSON.stringify(plan, null, 2));

  if (!APPLY) { console.log("\nNo changes written."); process.exit(0); }

  if (!member) {
    const ins = await db.from("team_members").insert({
      tenant_id: tenant.id, profile_id: user.id, display_name: profile.full_name ?? profile.email ?? user.email,
      formal_role: "Tenant Superadmin", observed_status: "confirmed", authority_level: "owner", source: "operator_grant",
    }).select("id").single();
    if (ins.error) die("could not create team_members row: " + ins.error.message);
    member = ins.data;
  }

  if (REVOKE) {
    const upd = await db.from("authority_grants").update({ effective_to: new Date().toISOString() })
      .eq("tenant_id", tenant.id).eq("member_id", member.id).eq("permission", "tenant.superadmin").is("effective_to", null);
    if (upd.error) die("revoke failed: " + upd.error.message);
    await db.from("audit_logs").insert({ tenant_id: tenant.id, actor: "operator:grant-script", action: "authority.revoke.tenant.superadmin", resource_type: "authority_grant", resource_id: member.id, status: "ok", detail: { user: user.email } });
    console.log("REVOKED tenant.superadmin for " + user.email);
  } else {
    // idempotent: the unique index is on coalesce(scope_ref,'') (an expression), which
    // PostgREST upsert can't target — so check-then-insert to stay a clean no-op if present.
    const existing = await db.from("authority_grants").select("id")
      .eq("tenant_id", tenant.id).eq("member_id", member.id).eq("permission", "tenant.superadmin")
      .eq("scope", "company").is("effective_to", null).maybeSingle();
    if (existing.data) {
      console.log("tenant.superadmin already active for " + user.email + " — idempotent no-op");
    } else {
      const ins = await db.from("authority_grants").insert({
        tenant_id: tenant.id, member_id: member.id, permission: "tenant.superadmin", scope: "company",
        source: "operator_grant", confirmed: true, effective_from: new Date().toISOString(),
      });
      if (ins.error) die("grant failed: " + ins.error.message);
      await db.from("audit_logs").insert({ tenant_id: tenant.id, actor: "operator:grant-script", action: "authority.grant.tenant.superadmin", resource_type: "authority_grant", resource_id: member.id, status: "ok", detail: { user: user.email, scope: "company" } });
      console.log("GRANTED tenant.superadmin (company scope) to " + user.email + " in tenant " + tenant.slug);
    }
  }
  process.exit(0);
} catch (e) {
  die(e.message);
}
