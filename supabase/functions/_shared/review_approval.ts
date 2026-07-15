// ServiceOS — Review Approval (PURE helpers for the backend approval flow).
//
// Bridges a human approval of a review_task into the EXISTING intelligence.review_resolve
// flow, which materialises the proposed Action + Automation Intent. Two pure concerns:
//
//  1. reconstructApprovalDecision — turn the immutable DecisionPackage produced by
//     intelligence.observe (decision_log.decision_package) back into the minimal
//     PolicyDecision shape buildActionDrafts() consumes. This is the missing seam:
//     observe writes decision_package (proposedAction + automationIntent), whereas the
//     older evaluate path wrote outputs.action_proposals. We prefer the package and
//     fall back to outputs, so review_resolve understands BOTH generations without any
//     change to the decision engine.
//  2. Endpoint helpers — parse the approve/reject route, choose the review_resolve
//     resolution, and authorize the action against the caller's tenant + task state.
//
// PURITY: no DB / queue / event / network. Deterministic and unit-testable.

import type {
  ActionProposal,
  DecisionPackage,
  OwnershipAssignment,
  PolicyDecision,
} from "./intelligence/types.ts";

// The minimal slice of a PolicyDecision that buildActionDrafts() actually reads.
export type ApprovalDecision = Pick<
  PolicyDecision,
  "priority" | "severity" | "deadline" | "assignments" | "action_proposals"
>;

/** The legacy (evaluate-path) shape stored in decision_log.outputs, if present. */
export interface ApprovalOutputs {
  priority?: string | null;
  severity?: string | null;
  deadline?: string | null;
  assignments?: OwnershipAssignment[];
  action_proposals?: ActionProposal[];
}

/** Flatten a DecisionPackage's RACI ownership into the assignment list used for the
 *  accountable-owner fallback (mirrors intelligence_observe.flattenOwnership). */
export function flattenPackageOwnership(pkg: DecisionPackage): OwnershipAssignment[] {
  const o = pkg.ownership;
  return [
    o.responsible,
    o.accountable,
    o.approver,
    o.waitingOn,
    ...o.consulted,
    ...o.informed,
  ].filter((a): a is OwnershipAssignment => a != null);
}

/**
 * Reconstruct the proposed action(s) to materialise on approval. Prefers the immutable
 * DecisionPackage (observe generation) — its `proposedAction` + `automationIntent` are
 * the source of truth — and falls back to legacy `outputs.action_proposals` (evaluate
 * generation). Returns an empty proposal list when the decision proposed no action, so
 * approving a no-action review creates no intent. Pure + deterministic.
 */
export function reconstructApprovalDecision(args: {
  decisionPackage: DecisionPackage | null;
  outputs: ApprovalOutputs | null;
}): ApprovalDecision {
  const pkg = args.decisionPackage;
  if (pkg && pkg.proposedAction) {
    const assignments = flattenPackageOwnership(pkg);
    const owner = pkg.ownership?.responsible ?? pkg.ownership?.accountable ?? null;
    const proposal: ActionProposal = {
      action_type: pkg.proposedAction.actionType,
      title: pkg.proposedAction.title,
      description: pkg.proposedAction.description ?? null,
      reason: null,
      // The Automation Intent type the executor will run — carried on the package.
      automation_intent: pkg.automationIntent?.intentType ?? null,
      owner,
    };
    return {
      priority: pkg.proposedAction.priority ?? null,
      severity: null,
      deadline: pkg.proposedAction.dueAt ?? null,
      assignments,
      action_proposals: [proposal],
    };
  }
  const o = args.outputs ?? {};
  return {
    priority: o.priority ?? null,
    severity: o.severity ?? null,
    deadline: o.deadline ?? null,
    assignments: o.assignments ?? [],
    action_proposals: o.action_proposals ?? [],
  };
}

// ── Endpoint helpers ─────────────────────────────────────────────────────────

export type ReviewAction = "approve" | "reject";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse a review-action route: …/{review_task_id}/(approve|reject). Scans segments so
 *  it is robust to the function-name prefix Supabase prepends. Returns null if absent. */
export function parseReviewPath(
  pathname: string,
): { reviewId: string; action: ReviewAction } | null {
  const segs = pathname.split("/").filter(Boolean);
  for (let i = 0; i + 1 < segs.length; i++) {
    const action = segs[i + 1].toLowerCase();
    if (UUID_RE.test(segs[i]) && (action === "approve" || action === "reject")) {
      return { reviewId: segs[i], action: action as ReviewAction };
    }
  }
  return null;
}

/** Fallback: read {review_task_id, action} from a JSON body. */
export function parseReviewBody(
  body: Record<string, unknown> | null | undefined,
): { reviewId: string; action: ReviewAction } | null {
  if (!body) return null;
  const id = body.review_task_id;
  const action = body.action;
  if (typeof id !== "string" || !UUID_RE.test(id)) return null;
  if (action !== "approve" && action !== "reject") return null;
  return { reviewId: id, action };
}

/** The intelligence.review_resolve resolution for a review action. Approve materialises
 *  the action + intent; reject dismisses the task and creates none. */
export function reviewResolutionFor(action: ReviewAction): "approve" | "reject" {
  return action;
}

export interface AuthorizeResult {
  ok: boolean;
  code?: string;
  message?: string;
  httpStatus?: number;
}

/**
 * Authorize a review action against the caller's tenant and the task's state. Rejects a
 * missing task (404), a cross-tenant task (403 tenant_mismatch), or an already-resolved
 * task (409 already_resolved — the idempotency gate: a retried approve creates nothing).
 */
export function authorizeReviewAction(
  callerTenantId: string,
  task: { tenant_id: string; status: string } | null,
): AuthorizeResult {
  if (!task)
    return { ok: false, code: "not_found", message: "review task not found", httpStatus: 404 };
  if (task.tenant_id !== callerTenantId) {
    return {
      ok: false,
      code: "tenant_mismatch",
      message: "review task belongs to another tenant",
      httpStatus: 403,
    };
  }
  if (task.status !== "pending") {
    return {
      ok: false,
      code: "already_resolved",
      message: "review task already resolved",
      httpStatus: 409,
    };
  }
  return { ok: true };
}

// ── Automation-layer approval (the verified engine's native gate) ────────────
//
// For an AUTOMATION_REQUIRES_APPROVAL intent, the Automation Engine's execution guard
// requires an `automation_approvals` row before it will execute — this is the human
// gate, NOT the review_task. The endpoint records that approval; the verified engine
// then executes unchanged. These helpers are pure.

/** The platform's internal connector id — the controlled, NO-external-effect connector
 *  the Automation Engine runs internal capabilities (internal.create_note /
 *  internal.record_execution) through. Seeded per tenant by the vertical seed; stamped
 *  onto materialised intents so the guard's connector check passes. */
export const DEFAULT_INTERNAL_CONNECTOR = "openfolk-core";

export type ApprovalSubject = "review_task" | "intent";

/**
 * Parse an approval route, distinguishing an INTENT approval (…/intent/{id}/approve) —
 * which records an automation_approvals row — from a REVIEW-TASK approval (…/{id}/approve)
 * — which drives review_resolve. Function-name-prefix tolerant.
 */
export function parseApprovalRoute(
  pathname: string,
): { subject: ApprovalSubject; id: string; action: ReviewAction } | null {
  const segs = pathname.split("/").filter(Boolean);
  for (let i = 0; i + 1 < segs.length; i++) {
    const action = segs[i + 1].toLowerCase();
    if (UUID_RE.test(segs[i]) && (action === "approve" || action === "reject")) {
      const subject: ApprovalSubject =
        segs[i - 1]?.toLowerCase() === "intent" ? "intent" : "review_task";
      return { subject, id: segs[i], action: action as ReviewAction };
    }
  }
  return null;
}

/** The automation_approvals.approver_kind a human approval should carry, derived from
 *  the DecisionPackage routing. Falls back to tenant_senior (a tenant operator). The
 *  engine's guard skips the kind check when the decision requires no specific holder. */
export function approverKindFor(
  pkg: { routing?: DecisionPackage["routing"] } | null,
): "openfolk" | "tenant_senior" | "customer" {
  const r = pkg?.routing;
  if (r?.customerApprovalRequired) return "customer";
  if (r?.openfolkRequired) return "openfolk";
  return "tenant_senior";
}

/** Authorize an intent approval: the intent must exist, be this tenant's, and be
 *  pending (the idempotency gate — an already-decided intent is never re-approved). */
export function authorizeIntentApproval(
  callerTenantId: string,
  intent: { tenant_id: string; status: string } | null,
): AuthorizeResult {
  if (!intent)
    return {
      ok: false,
      code: "not_found",
      message: "automation intent not found",
      httpStatus: 404,
    };
  if (intent.tenant_id !== callerTenantId) {
    return {
      ok: false,
      code: "tenant_mismatch",
      message: "automation intent belongs to another tenant",
      httpStatus: 403,
    };
  }
  if (intent.status !== "pending") {
    return {
      ok: false,
      code: "already_decided",
      message: "automation intent is not pending approval",
      httpStatus: 409,
    };
  }
  return { ok: true };
}
