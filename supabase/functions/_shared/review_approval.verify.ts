// Unit tests for the PURE review-approval helpers. No DB/queue/network.
// Run: node supabase/functions/_shared/review_approval.verify.ts

import {
  DEFAULT_INTERNAL_CONNECTOR,
  approverKindFor,
  authorizeIntentApproval,
  authorizeReviewAction,
  parseApprovalRoute,
  parseReviewBody,
  parseReviewPath,
  reconstructApprovalDecision,
  reviewResolutionFor,
} from "./review_approval.ts";
import { automationIntentFor, buildActionDrafts } from "./intelligence/action.ts";
import type { DecisionPackage, IntelligenceObject, PolicyDecision } from "./intelligence/types.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (!cond) failures++;
  console.log(
    `  [${cond ? "PASS" : "FAIL"}] ${name}${!cond ? ` — got ${JSON.stringify(detail)}` : ""}`,
  );
}

const T = "00000000-0000-0000-0000-000000000001";
const ID = "11111111-2222-3333-4444-555555555555";

// A DecisionPackage shaped like intelligence.observe writes (proposedAction +
// automationIntent), enough for reconstruction + materialisation.
function pkgWithAction(over: Partial<DecisionPackage> = {}): DecisionPackage {
  return {
    id: "dp-1",
    tenantId: T,
    supersedes: null,
    intelligenceObjectId: "obs-1",
    proposedAction: {
      actionType: "record_internal_note",
      title: "Record a controlled internal note",
      description: "Draft an internal suggested response",
      priority: "medium",
      dueAt: null,
    },
    automationIntent: {
      intentType: "record_internal_note",
      payload: { action_type: "record_internal_note" },
      requiresApproval: true,
    },
    ownership: {
      responsible: { raci_role: "responsible", party_kind: "ai", party_ref: "engine" },
      accountable: { raci_role: "accountable", party_kind: "human", party_ref: "ops" },
      approver: null,
      waitingOn: null,
      consulted: [],
      informed: [],
    },
    ...over,
  } as unknown as DecisionPackage;
}

const observation: IntelligenceObject = {
  tenant_id: T,
  domain: "core",
  object_type: "Observation",
  object_class: "observation",
  subject: "Inbound email from a customer",
  status: "monitoring",
  source_interactions: ["int-1"],
  source_entities: [],
  evidence: [{ ref: "interaction", interaction_id: "int-1" }],
  attributes: { channel: "email" },
};

// ── Reconstruction: DecisionPackage → materialised Automation Intent ─────────
console.log("Reconstruct approval decision:");
const recon = reconstructApprovalDecision({ decisionPackage: pkgWithAction(), outputs: null });
check(
  "reconstructs one proposal carrying the package's automation intent",
  recon.action_proposals.length === 1 &&
    recon.action_proposals[0].action_type === "record_internal_note" &&
    recon.action_proposals[0].automation_intent === "record_internal_note",
);
const drafts = buildActionDrafts({ ...observation, id: "obs-1" }, recon as PolicyDecision);
const intents = drafts.map((d) => automationIntentFor(d)).filter((x) => x != null);
check(
  "approve materialises exactly ONE pending automation intent (record_internal_note)",
  intents.length === 1 && intents[0]!.intent_type === "record_internal_note",
);
check(
  "the intent is derived from the observation (provenance preserved)",
  drafts[0].derived_from === "obs-1" &&
    (intents[0]!.parameters as { derived_from?: string }).derived_from === "obs-1",
);
check(
  "the intent carries the observation's source interactions (DecisionPackage provenance)",
  JSON.stringify(drafts[0].source_interactions) === JSON.stringify(["int-1"]),
);

// A decision that proposed NO action ⇒ approve materialises nothing.
const reconNoAction = reconstructApprovalDecision({
  decisionPackage: pkgWithAction({ proposedAction: null }) as DecisionPackage,
  outputs: null,
});
const noDrafts = buildActionDrafts(
  { ...observation, id: "obs-1" },
  reconNoAction as PolicyDecision,
);
check(
  "approve of a no-action decision materialises no intent",
  noDrafts.length === 0 || noDrafts.every((d) => automationIntentFor(d) === null),
);

// Legacy evaluate-path fallback: no package, outputs carry action_proposals.
const reconLegacy = reconstructApprovalDecision({
  decisionPackage: null,
  outputs: {
    priority: "high",
    action_proposals: [
      {
        action_type: "record_internal_note",
        title: "legacy",
        description: null,
        reason: null,
        automation_intent: "record_internal_note",
        owner: null,
      },
    ],
  },
});
check(
  "falls back to legacy outputs.action_proposals when no DecisionPackage",
  reconLegacy.action_proposals.length === 1 && reconLegacy.priority === "high",
);

// ── Route parsing ────────────────────────────────────────────────────────────
console.log("Route + body parsing:");
check(
  "parses /{id}/approve and /{id}/reject (function-prefix tolerant)",
  parseReviewPath(`/intelligence-review-action/intelligence/review/${ID}/approve`)?.action ===
    "approve" &&
    parseReviewPath(`/${ID}/reject`)?.action === "reject" &&
    parseReviewPath(`/${ID}/approve`)?.reviewId === ID,
);
check(
  "rejects a non-uuid or unknown action path",
  parseReviewPath(`/not-a-uuid/approve`) === null && parseReviewPath(`/${ID}/delete`) === null,
);
check(
  "body fallback parses {review_task_id, action}",
  parseReviewBody({ review_task_id: ID, action: "approve" })?.reviewId === ID &&
    parseReviewBody({ review_task_id: ID, action: "nope" }) === null &&
    parseReviewBody({ review_task_id: "x", action: "approve" }) === null,
);
check(
  "resolution mapping: approve→approve, reject→reject",
  reviewResolutionFor("approve") === "approve" && reviewResolutionFor("reject") === "reject",
);

// ── Authorization (auth already verified upstream; this gates tenant + state) ─
console.log("Authorization:");
check("unknown review task ⇒ 404 not_found", authorizeReviewAction(T, null).code === "not_found");
check(
  "wrong tenant ⇒ 403 tenant_mismatch (cannot approve another tenant's review)",
  authorizeReviewAction(T, { tenant_id: "other", status: "pending" }).code === "tenant_mismatch",
);
check(
  "already-resolved ⇒ 409 already_resolved (retry approve is idempotent, no second intent)",
  authorizeReviewAction(T, { tenant_id: T, status: "resolved" }).code === "already_resolved" &&
    authorizeReviewAction(T, { tenant_id: T, status: "dismissed" }).code === "already_resolved",
);
check(
  "pending, same tenant ⇒ authorized",
  authorizeReviewAction(T, { tenant_id: T, status: "pending" }).ok === true,
);

// ── Automation-layer approval (engine-native gate) ──────────────────────────
console.log("Intent approval routing + authorization:");
check(
  "distinguishes an INTENT approval from a review-task approval",
  parseApprovalRoute(`/intelligence-review-action/intent/${ID}/approve`)?.subject === "intent" &&
    parseApprovalRoute(`/${ID}/approve`)?.subject === "review_task" &&
    parseApprovalRoute(`/intent/${ID}/reject`)?.action === "reject",
);
check(
  "approver kind derives from DecisionPackage routing (default tenant_senior)",
  approverKindFor(null) === "tenant_senior" &&
    approverKindFor({ routing: { openfolkRequired: true } as never }) === "openfolk" &&
    approverKindFor({ routing: { customerApprovalRequired: true } as never }) === "customer",
);
check(
  "intent approval authorization gates tenant + pending (idempotent)",
  authorizeIntentApproval(T, null).code === "not_found" &&
    authorizeIntentApproval(T, { tenant_id: "other", status: "pending" }).code ===
      "tenant_mismatch" &&
    authorizeIntentApproval(T, { tenant_id: T, status: "succeeded" }).code === "already_decided" &&
    authorizeIntentApproval(T, { tenant_id: T, status: "pending" }).ok === true,
);
check(
  "the controlled internal connector constant is defined",
  typeof DEFAULT_INTERNAL_CONNECTOR === "string" && DEFAULT_INTERNAL_CONNECTOR.length > 0,
);

console.log(
  failures === 0 ? "\nALL REVIEW-APPROVAL UNIT CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
