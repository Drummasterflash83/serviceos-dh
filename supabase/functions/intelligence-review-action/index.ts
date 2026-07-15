// ServiceOS — Edge Function: intelligence-review-action
//
// The minimal authenticated backend for human approval of a DecisionPackage review:
//
//   POST …/intelligence/review/{id}/approve   → materialise the proposed Action +
//                                                one PENDING automation_intent
//   POST …/intelligence/review/{id}/reject    → dismiss the review; create nothing
//
// It authenticates the caller (Supabase user JWT → tenant bound server-side, role
// owner/admin/ops), verifies the review_task belongs to the caller's tenant and is
// still pending, then invokes the EXISTING intelligence.review_resolve handler in
// process — NO business logic is duplicated here and NO decision is re-made. Approval
// creates a pending intent ONLY; execution remains the separate, already-verified
// Automation Engine step (this function never executes an intent). No scheduler, no UI.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false (auth is
// enforced here via requireTenantUser so the internal service path also works).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  approverKindFor,
  authorizeIntentApproval,
  authorizeReviewAction,
  parseApprovalRoute,
  reviewResolutionFor,
} from "../_shared/review_approval.ts";
import { handleIntelligenceReviewResolve } from "../_shared/worker_handlers/intelligence_review_resolve.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-tenant-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
function fail(code: string, message: string, status: number): Response {
  return json({ ok: false, error: { code, message } }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // ── authz: bind tenant + role server-side (never trust the client) ─────────
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId } = auth.ctx;
  const operator = auth.ctx.email ?? auth.ctx.userId;

  // ── route: /intent/{id}/(approve|reject) OR /{review_task_id}/(approve|reject) ─
  const route = parseApprovalRoute(new URL(req.url).pathname);
  if (!route) {
    return fail(
      "invalid_route",
      "Use POST /intent/{id}/approve|reject or /{review_task_id}/approve|reject",
      400,
    );
  }

  // ── INTENT approval → the Automation Engine's native gate (automation_approvals) ─
  if (route.subject === "intent") {
    const { data: intent } = await admin
      .from("automation_intents")
      .select("id, tenant_id, status, decision_id, action_object_id")
      .eq("id", route.id)
      .maybeSingle();
    const iAuthz = authorizeIntentApproval(
      tenantId,
      intent as { tenant_id: string; status: string } | null,
    );
    if (!iAuthz.ok) return fail(iAuthz.code!, iAuthz.message!, iAuthz.httpStatus!);

    // Derive the required approver kind from the originating DecisionPackage (routing).
    let decisionId = (intent!.decision_id as string | null) ?? null;
    if (!decisionId && intent!.action_object_id) {
      const { data: action } = await admin
        .from("intelligence_objects")
        .select("decision_id")
        .eq("id", intent!.action_object_id as string)
        .maybeSingle();
      decisionId = (action?.decision_id as string | null) ?? null;
    }
    let approverKind: "openfolk" | "tenant_senior" | "customer" = "tenant_senior";
    if (decisionId) {
      const { data: dec } = await admin
        .from("decision_log")
        .select("decision_package")
        .eq("id", decisionId)
        .maybeSingle();
      approverKind = approverKindFor((dec?.decision_package as { routing?: never } | null) ?? null);
    }

    // Record the human decision as an immutable automation_approvals row. The verified
    // Automation Engine consumes this on its next execution pass — this function never
    // executes the intent itself.
    const { error } = await admin.from("automation_approvals").insert({
      tenant_id: tenantId,
      automation_intent_id: route.id,
      decision_id: decisionId,
      approver_kind: approverKind,
      approver_ref: operator,
      authority_basis: "tenant_operator_review",
      decision: route.action === "approve" ? "approved" : "rejected",
      granted_at: new Date().toISOString(),
      evidence: { via: "intelligence-review-action" },
    });
    if (error) {
      return fail(
        "approval_write_failed",
        (error as { message?: string }).message ?? "failed",
        400,
      );
    }
    return json({
      ok: true,
      subject: "intent",
      action: route.action,
      automation_intent_id: route.id,
      approver_kind: approverKind,
      note:
        route.action === "approve"
          ? "approval recorded — the Automation Engine will execute on its next pass"
          : "rejection recorded — the intent will not execute",
    });
  }

  // ── REVIEW-TASK approval → drive the EXISTING review_resolve flow in-process ─
  const { data: task } = await admin
    .from("review_tasks")
    .select("id, tenant_id, status")
    .eq("id", route.id)
    .maybeSingle();
  const authz = authorizeReviewAction(
    tenantId,
    task as { tenant_id: string; status: string } | null,
  );
  if (!authz.ok) return fail(authz.code!, authz.message!, authz.httpStatus!);

  const result = await handleIntelligenceReviewResolve({
    supabaseAdmin: admin,
    tenantId,
    jobId: null,
    payload: {
      review_task_id: route.id,
      resolution: reviewResolutionFor(route.action),
      operator,
    },
  });
  if (!result.success) {
    const code = result.error?.code ?? "review_resolve_failed";
    const status = code === "already_resolved" || code === "not_found" ? 409 : 400;
    return fail(code, result.error?.message ?? "review resolve failed", status);
  }
  return json({
    ok: true,
    subject: "review_task",
    action: route.action,
    review_task_id: route.id,
    result: result.result,
  });
});
