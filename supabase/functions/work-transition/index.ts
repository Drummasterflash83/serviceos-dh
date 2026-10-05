// ServiceOS — Edge Function: work-transition
//
// Persists a Command Centre work-item transition to the append-only object_state_history
// ledger and the intelligence_objects row. Replaces the LOCAL_ONLY React triage
// (acknowledge/dismiss/edit were lost on refresh — silent data loss). One work item =
// one intelligence_objects row of object_class='action'.
//
//   POST  body: { object_id, verb, reason?, evidence?, target_member_ref?,
//                 target_objective_id?, approved_exception? }
//   verbs: acknowledge|start|wait|resume|block|unblock|escalate|complete|dismiss|
//          accept|assign|correct_owner|correct_objective
//
// Authority is enforced server-side from authority_grants (work.assign / work.approve /
// ownership.confirm / tenant.superadmin) + the object's own RACI (self-service of your
// own queue). The legal status moves come from the state_transitions DATA (universal;
// same lifecycle for ServiceOS + ProductOS). Completion requires done_when evidence or an
// approved exception. Every call is audited with the REAL actor.
//
// Runtime: Deno. Deploy with verify_jwt=false (auth enforced here).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";
import { decideWorkTransition, type ActorAuthority, type WorkVerb } from "../_shared/work_transition.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "content-type": "application/json" } });
const fail = (code: string, message: string, s: number) => json({ ok: false, error: { code, message } }, s);

const VERBS = new Set<WorkVerb>([
  "acknowledge", "start", "wait", "resume", "block", "unblock", "escalate",
  "complete", "dismiss", "accept", "assign", "correct_owner", "correct_objective",
]);
const activeGrant = (g: Record<string, unknown>, now: number): boolean => {
  const from = g.effective_from ? Date.parse(g.effective_from as string) : Number.NEGATIVE_INFINITY;
  const to = g.effective_to ? Date.parse(g.effective_to as string) : Number.POSITIVE_INFINITY;
  return from <= now && to > now;
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId } = auth.ctx;
  const actorRef = auth.ctx.email ?? auth.ctx.userId;

  let body: Record<string, unknown> = {};
  try { body = ((await req.json()) ?? {}) as Record<string, unknown>; } catch { body = {}; }
  const objectId = String(body.object_id ?? "");
  const verb = String(body.verb ?? "") as WorkVerb;
  if (!objectId) return fail("bad_request", "object_id is required", 400);
  if (!VERBS.has(verb)) return fail("bad_request", `unknown verb: ${verb}`, 400);

  // ── read-only while viewing: if the actor has an ACTIVE View-As context, the
  //    whole session is read-only. Mutations are refused server-side (not just in the
  //    UI) — the actor must exit View-As before acting. ─────────────────────────
  const { data: activeView } = await admin
    .from("view_as_context")
    .select("id, expires_at, ended_at")
    .eq("tenant_id", tenantId).eq("actor_user_id", auth.ctx.userId).is("ended_at", null)
    .gt("expires_at", new Date().toISOString()).limit(1).maybeSingle();
  if (activeView) {
    await writeAudit(admin, { tenantId, actor: actorRef, action: `work.transition.${verb}`, resourceType: "intelligence_object", resourceId: objectId, status: "denied", detail: { code: "read_only_view_active", view_as_context: activeView.id } });
    return fail("read_only_view_active", "You have an active View-As context — exit it before mutating work", 409);
  }

  // ── load the work item (tenant-scoped) ─────────────────────────────────────
  const { data: object } = await admin
    .from("intelligence_objects")
    .select("id, tenant_id, domain, object_type, status, attributes, responsible_ref, accountable_ref, waiting_on_ref, version")
    .eq("id", objectId).eq("tenant_id", tenantId).maybeSingle();
  if (!object) return fail("not_found", "work item not found in your tenant", 404);

  // ── legal status moves for this object's (domain, object_type) ─────────────
  const { data: legalTransitions } = await admin
    .from("state_transitions")
    .select("from_state, to_state")
    .eq("domain", object.domain).eq("object_type", object.object_type);

  // ── resolve the actor's authority (grants + RACI on THIS object) ───────────
  const { data: member } = await admin.from("team_members")
    .select("id").eq("tenant_id", tenantId).eq("profile_id", auth.ctx.userId).is("effective_to", null).maybeSingle();
  const memberId = (member?.id as string | undefined) ?? null;
  let grants: Record<string, unknown>[] = [];
  if (memberId) {
    grants = (await admin.from("authority_grants")
      .select("permission, effective_from, effective_to")
      .eq("tenant_id", tenantId).eq("member_id", memberId)).data ?? [];
  }
  const now = Date.now();
  const held = new Set(grants.filter((g) => activeGrant(g, now)).map((g) => g.permission as string));
  const raciRefs = [object.responsible_ref, object.accountable_ref, object.waiting_on_ref]
    .map((r) => (r && typeof r === "object" ? String((r as Record<string, unknown>).ref ?? "") : ""));
  const isAssignee = raciRefs.some((r) => r && (r === actorRef || r === auth.ctx.userId || (memberId && r === memberId)));

  const actor: ActorAuthority = {
    userRef: actorRef,
    isSuperadmin: held.has("tenant.superadmin"),
    canAssign: held.has("work.assign"),
    canApprove: held.has("work.approve"),
    canConfirmOwnership: held.has("ownership.confirm"),
    isAssignee,
  };

  // ── decide (pure) ──────────────────────────────────────────────────────────
  const decision = decideWorkTransition({
    object, verb, actor,
    legalTransitions: (legalTransitions ?? []) as { from_state: string; to_state: string }[],
    reason: (body.reason as string | null) ?? null,
    evidence: body.evidence,
    targetMemberRef: (body.target_member_ref as string | null) ?? null,
    targetObjectiveId: (body.target_objective_id as string | null) ?? null,
    approvedException: body.approved_exception === true,
  });

  if (!decision.ok) {
    await writeAudit(admin, {
      tenantId, actor: actorRef, action: `work.transition.${verb}`,
      resourceType: "intelligence_object", resourceId: objectId, status: "denied",
      detail: { code: decision.code, from: object.status },
    });
    const httpStatus = decision.code === "forbidden" ? 403
      : decision.code === "noop" || decision.code === "illegal_transition" ? 409 : 400;
    return fail(decision.code ?? "denied", decision.message ?? "transition denied", httpStatus);
  }

  // ── persist: history (append-only) + object row + optional objective link ──
  const hist = decision.history!;
  const { error: hErr } = await admin.from("object_state_history").insert({
    tenant_id: tenantId, object_id: objectId,
    from_state: hist.from_state, to_state: hist.to_state, actor: hist.actor, reason: hist.reason,
  });
  if (hErr) return fail("history_write_failed", hErr.message ?? "failed", 400);

  const patch: Record<string, unknown> = { ...(decision.objectPatch ?? {}), version: (object.version ?? 1) + 1 };
  if (decision.statusChanged && decision.toStatus) patch.status = decision.toStatus;
  const { error: uErr } = await admin.from("intelligence_objects").update(patch).eq("id", objectId).eq("tenant_id", tenantId);
  if (uErr) return fail("object_update_failed", uErr.message ?? "failed", 400);

  if (decision.objectiveLink) {
    const l = decision.objectiveLink;
    await admin.from("objective_links").insert({
      tenant_id: tenantId, objective_id: l.objectiveId, target_kind: l.targetKind, target_ref: objectId,
      relation: l.relation, rationale: l.rationale, created_by: actorRef, approved: actor.isSuperadmin,
    });
  }

  await writeAudit(admin, {
    tenantId, actor: actorRef, action: `work.transition.${verb}`,
    resourceType: "intelligence_object", resourceId: objectId, status: "ok",
    detail: { from: object.status, to: decision.toStatus, statusChanged: decision.statusChanged },
  });

  return json({
    ok: true, object_id: objectId, verb,
    from: object.status, to: decision.toStatus, status_changed: decision.statusChanged,
    note: "transition persisted to object_state_history — survives refresh",
  });
});
