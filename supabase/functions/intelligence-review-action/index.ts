// ServiceOS — Edge Function: intelligence-review-action
//
// The minimal authenticated backend for human approval of a DecisionPackage review:
//
//   POST …/intelligence/review/{id}/approve   → materialise the proposed Action +
//                                                one PENDING automation_intent
//   POST …/intelligence/review/{id}/reject    → dismiss the review; create nothing
//   POST …/intent/{id}/approve                → record the human approval + LOCK the
//                                                reviewed response onto the intent
//   POST …/intent/{id}/reject                 → record the rejection; nothing executes
//   POST …/intent/{id}/revise {body,change_reason} → record a human refinement of the
//                                                proposed response (append-only) BEFORE
//                                                approval; the reviewed body is what runs
//   GET  …/intent/{id}/refinement             → read the audit trail
//                                                (AI proposal → human changes → approval)
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
  parseIntentRefinementRoute,
  reviewResolutionFor,
} from "../_shared/review_approval.ts";
import {
  loadRefinementTrail,
  recordApprovalSnapshot,
  recordResponseRevision,
} from "../_shared/response_refinement.ts";
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
async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return fail("method_not_allowed", "Use POST (GET only for refinement reads)", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // ── authz: bind tenant + role server-side (never trust the client) ─────────
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId } = auth.ctx;
  const operator = auth.ctx.email ?? auth.ctx.userId;
  const pathname = new URL(req.url).pathname;

  // ── REFINEMENT: inspect or MODIFY the proposed response BEFORE approval ───────
  //   POST …/intent/{id}/revise      → record a human edit (append-only) + stage it
  //   GET|POST …/intent/{id}/refinement → read the audit trail (proposal → edits → …)
  const refine = parseIntentRefinementRoute(pathname);
  if (refine) {
    if (refine.op === "refinement") {
      const trail = await loadRefinementTrail(admin, tenantId, refine.id);
      if (!trail) return fail("not_found", "no response proposal for this intent", 404);
      return json({ ok: true, subject: "intent", automation_intent_id: refine.id, trail });
    }
    // revise — a write; POST only.
    if (req.method !== "POST") return fail("method_not_allowed", "Use POST to revise", 405);
    const body = await readJson(req);
    const revisedBody = typeof body?.body === "string" ? body.body : null;
    if (!revisedBody || !revisedBody.trim()) {
      return fail("empty_body", "a non-empty `body` is required to revise", 400);
    }
    const result = await recordResponseRevision(admin, {
      tenantId,
      automationIntentId: refine.id,
      editorRef: operator,
      editorKind: "tenant_operator",
      body: revisedBody,
      changeReason: typeof body?.change_reason === "string" ? body.change_reason : null,
      now: new Date().toISOString(),
    });
    if (!result.ok) return fail(result.code, result.message, result.httpStatus);
    return json({
      ok: true,
      subject: "intent",
      action: "revise",
      automation_intent_id: refine.id,
      revision: { number: result.revision.revision_number, id: result.revisionId },
      effective: {
        source: result.effective.source,
        revision_number: result.effective.revision_number,
        preview: result.effective.body.slice(0, 280),
      },
      note: "revision recorded — approval will execute this reviewed version",
    });
  }

  // ── route: /intent/{id}/(approve|reject) OR /{review_task_id}/(approve|reject) ─
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);
  const route = parseApprovalRoute(pathname);
  if (!route) {
    return fail(
      "invalid_route",
      "Use POST /intent/{id}/approve|reject|revise or /{review_task_id}/approve|reject",
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

    // Capture the immutable APPROVED artifact snapshot + lock the reviewed body onto the
    // still-pending intent, so the Automation Engine executes the reviewed version only.
    // The snapshot rejects a DUPLICATE approval (an approved intent stays `pending` until
    // the engine claims it, so status alone cannot). A no-op for non-response intents.
    const evidence: Record<string, unknown> = { via: "intelligence-review-action" };
    let approvalAlreadyRecorded = false;
    if (route.action === "approve") {
      const snap = await recordApprovalSnapshot(admin, {
        tenantId,
        automationIntentId: route.id,
        approverRef: operator,
        approverKind,
        authorityBasis: "tenant_operator_review",
        evidence,
        now: new Date().toISOString(),
      });
      if (snap.kind === "already_approved") {
        return fail("already_approved", "this response has already been approved", 409);
      }
      if (snap.kind === "ok") {
        approvalAlreadyRecorded = true;
        evidence.response_approval_snapshot_id = snap.snapshotId;
        evidence.approved_response_proposal_id = snap.proposalId;
        evidence.approved_response_revision_id = snap.approvedRevisionId;
        evidence.approved_response_source = snap.effective.source;
        evidence.approved_response_edited = snap.effective.edited;
        evidence.approved_payload_hash = snap.approvedPayloadHash;
      }
    }

    // Record the human decision as an immutable automation_approvals row. The verified
    // Automation Engine consumes this on its next execution pass — this function never
    // executes the intent itself.
    const { error } = approvalAlreadyRecorded
      ? { error: null }
      : await admin.from("automation_approvals").insert({
          tenant_id: tenantId,
          automation_intent_id: route.id,
          decision_id: decisionId,
          approver_kind: approverKind,
          approver_ref: operator,
          authority_basis: "tenant_operator_review",
          decision: route.action === "approve" ? "approved" : "rejected",
          granted_at: new Date().toISOString(),
          evidence,
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
      approved_version: evidence.approved_response_source ?? null,
      note:
        route.action === "approve"
          ? "approval recorded — the Automation Engine will execute the reviewed version on its next pass"
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
