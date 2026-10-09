// ServiceOS — Edge Function: work-transition
//
// Persists a Command Centre work-item transition to the append-only object_state_history
// ledger and the intelligence_objects row. Replaces the LOCAL_ONLY React triage
// (acknowledge/dismiss/edit were lost on refresh — silent data loss). One work item =
// one intelligence_objects row of object_class='action'.
//
//   POST  body: { object_id, expected_version, verb, reason?, evidence?, target_member_ref?,
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
import { decideWorkTransition, type WorkVerb } from "../_shared/work_transition.ts";

import { readWorkAuthority } from "../_shared/work_authority.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "content-type": "application/json" },
  });
const fail = (code: string, message: string, s: number) =>
  json({ ok: false, error: { code, message } }, s);

const VERBS = new Set<WorkVerb>([
  "acknowledge",
  "start",
  "wait",
  "resume",
  "block",
  "unblock",
  "escalate",
  "complete",
  "dismiss",
  "accept",
  "assign",
  "correct_owner",
  "correct_objective",
]);
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId } = auth.ctx;
  if (auth.ctx.userId === "service")
    return fail("forbidden", "A signed-in work actor is required", 403);
  const actorRef = auth.ctx.email ?? auth.ctx.userId;

  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const objectId = String(body.object_id ?? "");
  const verb = String(body.verb ?? "") as WorkVerb;
  if (!objectId) return fail("bad_request", "object_id is required", 400);
  if (!VERBS.has(verb)) return fail("bad_request", `unknown verb: ${verb}`, 400);
  if (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 1)
    return fail("bad_request", "Refresh work before acting: expected_version is required", 400);

  // ── read-only while viewing: if the actor has an ACTIVE View-As context, the
  //    whole session is read-only. Mutations are refused server-side (not just in the
  //    UI) — the actor must exit View-As before acting. ─────────────────────────
  const { data: activeView, error: viewError } = await admin
    .from("view_as_context")
    .select("id, expires_at, ended_at")
    .eq("actor_user_id", auth.ctx.userId)
    .is("ended_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1)
    .maybeSingle();
  if (viewError) return fail("authority_unavailable", "Could not verify View-As state", 503);
  if (activeView) {
    await writeAudit(admin, {
      tenantId,
      actor: actorRef,
      action: `work.transition.${verb}`,
      resourceType: "intelligence_object",
      resourceId: objectId,
      status: "denied",
      detail: { code: "read_only_view_active", view_as_context: activeView.id },
    });
    return fail(
      "read_only_view_active",
      "You have an active View-As context — exit it before mutating work",
      409,
    );
  }

  // ── load the work item (tenant-scoped) ─────────────────────────────────────
  const { data: object } = await admin
    .from("intelligence_objects")
    .select(
      "id, tenant_id, domain, object_type, status, attributes, responsible_ref, accountable_ref, waiting_on_ref, version",
    )
    .eq("id", objectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!object) return fail("not_found", "work item not found in your tenant", 404);
  if (object.version !== body.expected_version)
    return fail(
      "version_conflict",
      "Work changed since this card was loaded; refresh before retrying",
      409,
    );

  // ── legal status moves for this object's (domain, object_type) ─────────────
  const { data: legalTransitions, error: transitionsError } = await admin
    .from("state_transitions")
    .select("from_state, to_state, guard")
    .eq("domain", object.domain)
    .eq("object_type", object.object_type);
  if (transitionsError)
    return fail("authority_unavailable", "Could not load work transition rules", 503);

  // One scoped database decision; apply rechecks it against current authority.
  const { data: authorityData, error: authorityError } = await admin.rpc("learn_work_authority", {
    p_tenant: tenantId,
    p_object: objectId,
    p_actor: auth.ctx.userId,
    p_claim: verb === "accept",
    p_target_member:
      verb === "assign" || verb === "correct_owner" ? (body.target_member_ref ?? null) : null,
  });
  if (authorityError) {
    if (authorityError.code === "42501")
      return fail("forbidden", "Your current identity or session cannot act on this work", 403);
    if (authorityError.code === "22023" || authorityError.code === "22P02")
      return fail("invalid_target", "Choose an active, confirmed member of this company", 400);
    return fail("authority_unavailable", "Could not verify authority for this work item", 503);
  }
  let authority: ReturnType<typeof readWorkAuthority>;
  try {
    authority = readWorkAuthority(authorityData, {
      tenantId,
      objectId,
      actorId: auth.ctx.userId,
      version: Number(body.expected_version),
    });
  } catch {
    return fail("authority_unavailable", "Work or authority changed; refresh before retrying", 409);
  }
  const { actor, memberId } = authority;

  // ── decide (pure) ──────────────────────────────────────────────────────────
  const decision = decideWorkTransition({
    object,
    verb,
    actor,
    legalTransitions: (legalTransitions ?? []) as { from_state: string; to_state: string; guard?: unknown }[],
    reason: (body.reason as string | null) ?? null,
    evidence: body.evidence,
    targetMemberRef: (body.target_member_ref as string | null) ?? null,
    targetObjectiveId: (body.target_objective_id as string | null) ?? null,
    approvedException: body.approved_exception === true,
  });

  if (!decision.ok) {
    await writeAudit(admin, {
      tenantId,
      actor: actorRef,
      action: `work.transition.${verb}`,
      resourceType: "intelligence_object",
      resourceId: objectId,
      status: "denied",
      detail: { code: decision.code, from: object.status },
    });
    const httpStatus =
      decision.code === "forbidden"
        ? 403
        : decision.code === "noop" || decision.code === "illegal_transition"
          ? 409
          : 400;
    return fail(decision.code ?? "denied", decision.message ?? "transition denied", httpStatus);
  }

  // One locked transaction captures the actual before/after ownership and state.
  // A stale request or failed objective link cannot leave a false history row.
  const hist = decision.history!;
  const l = decision.objectiveLink;
  const { data: applied, error: applyError } = await admin.rpc("work_transition_apply", {
    p_tenant: tenantId,
    p_object: objectId,
    p_expected_version: body.expected_version,
    p_to_status: decision.toStatus ?? object.status,
    p_patch: decision.objectPatch ?? {},
    p_history: {
      verb,
      approved_exception: body.approved_exception === true,
      reason: hist.reason,
      actor: { ...hist.actor, user_id: auth.ctx.userId, member_id: memberId },
    },
    p_objective: l
      ? {
          objective_id: l.objectiveId,
          relation: l.relation,
          rationale: l.rationale,
          approved: actor.isSuperadmin,
        }
      : null,
  });
  if (applyError) {
    if (applyError.code === "42501")
      return fail(
        "forbidden",
        "Your authority no longer covers this work; refresh before retrying",
        403,
      );
    if (applyError.code === "P0409")
      return fail("version_conflict", "Work changed; refresh before retrying", 409);
    return fail(
      "transition_failed",
      "The work transition could not be saved; refresh to check its current state",
      409,
    );
  }

  await writeAudit(admin, {
    tenantId,
    actor: actorRef,
    action: `work.transition.${verb}`,
    resourceType: "intelligence_object",
    resourceId: objectId,
    status: "ok",
    detail: { from: object.status, to: decision.toStatus, statusChanged: decision.statusChanged },
  });

  return json({
    ok: true,
    object_id: objectId,
    verb,
    from: object.status,
    to: decision.toStatus,
    status_changed: decision.statusChanged,
    version: applied?.version,
    history_id: applied?.history_id,
    note: "transition persisted to object_state_history — survives refresh",
  });
});
