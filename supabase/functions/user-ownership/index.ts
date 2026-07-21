// ServiceOS — Edge Function: user-ownership
//
// Resolves what a user actually owns, covers and may govern (operational role,
// objectives, workflows, responsibilities, authority, agent-governance permissions).
// Two auth paths:
//   • Normal: a tenant user JWT → resolves the CALLER (owner|admin|ops|viewer).
//   • OpenFolk/supervision/test: `x-openfolk-secret` == WORKER_SECRET + body
//     {tenant_id, user_id} → resolves that user (service-role assembles).
// Read-only. Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.
import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { requireTenantUser } from "../_shared/authz.ts";
import { resolveUserOwnership } from "../_shared/ownership.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-openfolk-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ success: false, error: "Use POST" }, 405);

  const admin = createSupabaseAdmin();
  if (!admin) return json({ success: false, error: "service role not configured" }, 500);

  let body: Record<string, unknown> = {};
  try { body = ((await req.json()) ?? {}) as Record<string, unknown>; } catch { body = {}; }

  // Resolve tenant + user, by either path.
  let tenantId: string, userId: string, profileRole: string | null = null;
  const openfolkSecret = req.headers.get("x-openfolk-secret");
  const expected = Deno.env.get("WORKER_SECRET") ?? "";
  if (openfolkSecret && expected && safeEqual(openfolkSecret, expected)) {
    tenantId = String(body.tenant_id ?? "");
    userId = String(body.user_id ?? "");
    if (!tenantId || !userId) return json({ success: false, error: "tenant_id and user_id required" }, 400);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", userId).eq("tenant_id", tenantId).maybeSingle();
    profileRole = (prof?.role as string | null) ?? null;
  } else {
    const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"] as never);
    // deno-lint-ignore no-explicit-any
    const ctx = auth.ctx as any;
    tenantId = ctx.tenantId;
    userId = ctx.userId;
    profileRole = ctx.role ?? null;
  }

  // Load the user's operational model (tenant-scoped, current unless asked otherwise).
  const nowIso = new Date().toISOString();
  const { data: member } = await admin
    .from("team_members")
    .select("id, display_name, formal_role, observed_role, observed_status, authority_level, org_unit_id, effective_from, effective_to")
    .eq("tenant_id", tenantId).eq("profile_id", userId).is("effective_to", null).maybeSingle();

  let responsibilities: unknown[] = [], grants: unknown[] = [], objectives: unknown[] = [],
    teams: unknown[] = [], managedMembers: unknown[] = [];

  if (member) {
    const memberId = (member as Record<string, unknown>).id as string;
    responsibilities = (await admin.from("responsibility_assignments")
      .select("kind, target_ref, label, raci_role, weekday_mask, cover_for, confidence, effective_from, effective_to")
      .eq("tenant_id", tenantId).eq("member_id", memberId)).data ?? [];
    // authority grants + category from the vocabulary
    const rawGrants = (await admin.from("authority_grants")
      .select("permission, scope, scope_ref, effective_from, effective_to")
      .eq("tenant_id", tenantId).eq("member_id", memberId)).data ?? [];
    const perms = (await admin.from("authority_permissions").select("permission, category")).data ?? [];
    const catOf = new Map((perms as Record<string, string>[]).map((p) => [p.permission, p.category]));
    grants = (rawGrants as Record<string, unknown>[]).map((g) => ({ ...g, category: catOf.get(g.permission as string) ?? null }));
    // objectives owned: via objective-ownership responsibilities OR owner jsonb ref
    const objRefs = (responsibilities as Record<string, unknown>[])
      .filter((r) => r.kind === "objective" && r.target_ref).map((r) => r.target_ref as string);
    if (objRefs.length) {
      objectives = (await admin.from("objectives").select("id, title, status").eq("tenant_id", tenantId).in("id", objRefs)).data ?? [];
    }
    if ((member as Record<string, unknown>).org_unit_id) {
      teams = (await admin.from("org_units").select("id, name").eq("id", (member as Record<string, unknown>).org_unit_id)).data ?? [];
    }
    const level = (member as Record<string, unknown>).authority_level as string;
    if (level === "owner" || level === "director") {
      managedMembers = (await admin.from("team_members").select("id, display_name")
        .eq("tenant_id", tenantId).neq("id", memberId).is("effective_to", null)).data ?? [];
    }
  }

  const resolved = resolveUserOwnership({
    tenantId, userId, now: nowIso, profileRole,
    member: (member as Record<string, unknown> | null) ?? null,
    responsibilities: responsibilities as Record<string, unknown>[],
    authorityGrants: grants as Record<string, unknown>[],
    objectives: objectives as Record<string, unknown>[],
    teams: teams as Record<string, unknown>[],
    managedMembers: managedMembers as Record<string, unknown>[],
  });

  return json({ success: true, ownership: resolved });
});
