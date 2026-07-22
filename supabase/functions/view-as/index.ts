// ServiceOS — Edge Function: view-as
//
// Secure, server-resolved View-As for a Tenant Superadmin. The real actor's JWT is always
// retained; the browser never receives the worker/service secret. RLS is not bypassed in
// the browser — re-scoping to the subject happens inside this trusted function, read-only.
//
//   POST {action:'open',   subject_kind, subject_ref?, mode?, reason?} → create context
//   POST {action:'resolve',context_id}                                → subject's ownership (read-only)
//   POST {action:'exit',   context_id}                                → immediate exit
//
// Entry requires an ACTIVE tenant.superadmin grant; subject must be same-tenant (or a valid
// 'unassigned' profile). Contexts expire (30m). Every call is audited with the real actor.
//
// Runtime: Deno. Deploy with verify_jwt=false (auth enforced via requireTenantUser).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";
import { resolveUserOwnership } from "../_shared/ownership.ts";
import { authorizeOpen, isContextUsable, VIEW_AS_MAX_MINUTES } from "../_shared/view_as.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
const fail = (code: string, message: string, s: number) => json({ ok: false, error: { code, message } }, s);
type Row = Record<string, any>; // deno-lint-ignore-line no-explicit-any
const activeGrant = (g: Row, now: number) =>
  (g.effective_from ? Date.parse(g.effective_from) : -Infinity) <= now &&
  (g.effective_to ? Date.parse(g.effective_to) : Infinity) > now;

async function actorIsSuperadmin(admin: Row, tenantId: string, userId: string, now: number): Promise<boolean> {
  const { data: member } = await admin.from("team_members").select("id").eq("tenant_id", tenantId).eq("profile_id", userId).is("effective_to", null).maybeSingle();
  if (!member) return false;
  const { data: grants } = await admin.from("authority_grants").select("permission, effective_from, effective_to")
    .eq("tenant_id", tenantId).eq("member_id", member.id).eq("permission", "tenant.superadmin");
  return (grants ?? []).some((g: Row) => activeGrant(g, now));
}

// Resolve a subject user's ownership read-only (service-role loads; resolver is pure).
async function resolveSubject(admin: Row, tenantId: string, subjectUserId: string, now: number) {
  const { data: member } = await admin.from("team_members")
    .select("id, display_name, formal_role, observed_role, observed_status, authority_level, org_unit_id")
    .eq("tenant_id", tenantId).eq("profile_id", subjectUserId).is("effective_to", null).maybeSingle();
  const { data: prof } = await admin.from("profiles").select("role").eq("id", subjectUserId).eq("tenant_id", tenantId).maybeSingle();
  let responsibilities: Row[] = [], grants: Row[] = [], objectives: Row[] = [], teams: Row[] = [], managed: Row[] = [];
  if (member) {
    responsibilities = (await admin.from("responsibility_assignments").select("kind, target_ref, label, raci_role, weekday_mask, cover_for, confidence, effective_from, effective_to").eq("tenant_id", tenantId).eq("member_id", member.id)).data ?? [];
    const rawGrants = (await admin.from("authority_grants").select("permission, scope, scope_ref, effective_from, effective_to").eq("tenant_id", tenantId).eq("member_id", member.id)).data ?? [];
    const perms = (await admin.from("authority_permissions").select("permission, category")).data ?? [];
    const catOf = new Map((perms as Row[]).map((p) => [p.permission, p.category]));
    grants = (rawGrants as Row[]).map((g) => ({ ...g, category: catOf.get(g.permission) ?? null }));
    const objRefs = (responsibilities as Row[]).filter((r) => r.kind === "objective" && r.target_ref).map((r) => r.target_ref);
    if (objRefs.length) objectives = (await admin.from("objectives").select("id, title, status").eq("tenant_id", tenantId).in("id", objRefs)).data ?? [];
    if (member.org_unit_id) teams = (await admin.from("org_units").select("id, name").eq("id", member.org_unit_id)).data ?? [];
  }
  return resolveUserOwnership({
    tenantId, userId: subjectUserId, now: new Date(now).toISOString(), profileRole: prof?.role ?? null,
    member: (member as Row) ?? null, responsibilities, authorityGrants: grants, objectives, teams, managedMembers: managed,
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId } = auth.ctx;
  const actorRef = auth.ctx.email ?? userId;
  const now = Date.now();

  let body: Row = {};
  try { body = ((await req.json()) ?? {}) as Row; } catch { body = {}; }
  const action = String(body.action ?? "");

  // ── open ───────────────────────────────────────────────────────────────────
  if (action === "open") {
    const isSuper = await actorIsSuperadmin(admin, tenantId, userId, now);
    const subjectKind = String(body.subject_kind ?? "");
    const subjectRef = body.subject_ref ? String(body.subject_ref) : null;

    // Determine the subject's tenant for the same-tenant check.
    let subjectTenantId: string | null = null;
    if (subjectKind === "user" && subjectRef) {
      const { data: p } = await admin.from("profiles").select("tenant_id").eq("id", subjectRef).maybeSingle();
      subjectTenantId = (p?.tenant_id as string | null) ?? null;
    } else if (subjectKind === "team" && subjectRef) {
      const { data: t } = await admin.from("org_units").select("tenant_id").eq("id", subjectRef).maybeSingle();
      subjectTenantId = (t?.tenant_id as string | null) ?? null;
    } else if (subjectKind !== "unassigned") {
      subjectTenantId = tenantId; // role / permission_profile are tenant-local labels
    }

    const decision = authorizeOpen({
      actorIsSuperadmin: isSuper, actorTenantId: tenantId, subjectKind,
      subjectTenantId, mode: String(body.mode ?? "view"), supervisedAllowed: false,
    });
    if (!decision.ok) {
      await writeAudit(admin, { tenantId, actor: actorRef, action: "view_as.open", resourceType: "view_as_context", status: "denied", detail: { code: decision.code, subjectKind } });
      return fail(decision.code!, decision.message!, decision.code === "forbidden" ? 403 : decision.code === "cross_tenant" ? 403 : 400);
    }

    const expiresAt = new Date(now + VIEW_AS_MAX_MINUTES * 60_000).toISOString();
    const { data: ctx, error } = await admin.from("view_as_context").insert({
      tenant_id: tenantId, actor_user_id: userId, subject_kind: subjectKind, subject_ref: subjectRef,
      mode: decision.mode, read_only: decision.readOnly, reason: body.reason ?? null, expires_at: expiresAt,
    }).select("id, subject_kind, subject_ref, mode, read_only, expires_at").single();
    if (error) return fail("open_failed", error.message ?? "failed", 400);
    await writeAudit(admin, { tenantId, actor: actorRef, action: "view_as.open", resourceType: "view_as_context", resourceId: ctx.id, status: "ok", detail: { subjectKind, subjectRef, mode: decision.mode } });
    return json({ ok: true, context: ctx, actor: { userId, ref: actorRef }, banner: { readOnly: decision.readOnly, expiresAt } });
  }

  // ── resolve (read-only) ─────────────────────────────────────────────────────
  if (action === "resolve") {
    const contextId = String(body.context_id ?? "");
    if (!contextId) return fail("bad_request", "context_id is required", 400);
    const { data: ctx } = await admin.from("view_as_context").select("*").eq("id", contextId).eq("tenant_id", tenantId).maybeSingle();
    if (!ctx) return fail("not_found", "view-as context not found", 404);
    const usable = isContextUsable(ctx as Row, userId, now);
    if (!usable.usable) return fail(usable.reason === "expired" ? "expired" : usable.reason === "not_actor" ? "forbidden" : "ended", `context ${usable.reason}`, usable.reason === "not_actor" ? 403 : 410);
    // Re-check authority NOW (revoked-superadmin rejection).
    if (!(await actorIsSuperadmin(admin, tenantId, userId, now))) return fail("forbidden", "Tenant Superadmin authority is no longer active", 403);

    let subject: unknown = { note: `View-As ${ctx.subject_kind}`, subjectRef: ctx.subject_ref };
    if (ctx.subject_kind === "user" && ctx.subject_ref) {
      subject = await resolveSubject(admin, tenantId, ctx.subject_ref, now);
    } else if (ctx.subject_kind === "unassigned") {
      subject = { user: { userId: null, memberId: null, formalRole: null }, roles: [], objectives: [], responsibilities: [], authority: [], reasons: ["unassigned user — no ownership yet"] };
    }
    await writeAudit(admin, { tenantId, actor: actorRef, action: "view_as.resolve", resourceType: "view_as_context", resourceId: contextId, status: "ok", detail: { subjectKind: ctx.subject_kind } });
    // Actor is ALWAYS the real signed-in user; subject is context only.
    return json({ ok: true, readOnly: usable.readOnly, actor: { userId, ref: actorRef }, viewingAs: { kind: ctx.subject_kind, ref: ctx.subject_ref, expiresAt: ctx.expires_at }, subject });
  }

  // ── exit ─────────────────────────────────────────────────────────────────────
  if (action === "exit") {
    const contextId = String(body.context_id ?? "");
    if (!contextId) return fail("bad_request", "context_id is required", 400);
    const { data: ctx } = await admin.from("view_as_context").select("id, actor_user_id").eq("id", contextId).eq("tenant_id", tenantId).maybeSingle();
    if (!ctx) return fail("not_found", "view-as context not found", 404);
    if (ctx.actor_user_id !== userId) return fail("forbidden", "not your context", 403);
    await admin.from("view_as_context").update({ ended_at: new Date(now).toISOString() }).eq("id", contextId);
    await writeAudit(admin, { tenantId, actor: actorRef, action: "view_as.exit", resourceType: "view_as_context", resourceId: contextId, status: "ok" });
    return json({ ok: true, exited: contextId });
  }

  return fail("bad_request", "unknown action (open|resolve|exit)", 400);
});
