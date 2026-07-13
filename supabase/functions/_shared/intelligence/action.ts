// Universal Intelligence Foundation — Action derivation (pure).
//
// Turns a Decision's action proposals into Action drafts, and an Action into an
// Automation INTENT. This layer never executes automations — it only emits
// intent, keeping intelligence pure (a separate Automation Engine decides
// execution). Domain-agnostic: no domain-specific knowledge lives here.

import type {
  ActionDraft,
  AutomationIntent,
  IntelligenceObject,
  OwnershipAssignment,
  PolicyDecision,
} from "./types.ts";

/**
 * Materialise the Action(s) a decision proposed, derived from an observation.
 * Ownership falls back to the decision's accountable party when a proposal
 * carries no explicit owner. Pure — same inputs, same drafts.
 */
export function buildActionDrafts(
  observation: IntelligenceObject,
  decision: PolicyDecision,
): ActionDraft[] {
  const accountable: OwnershipAssignment | null =
    decision.assignments.find((a) => a.raci_role === "accountable") ?? null;

  return decision.action_proposals.map((p) => ({
    domain: observation.domain,
    object_type: "Action",
    object_class: "action",
    subject: p.title,
    action_type: p.action_type,
    description: p.description,
    reason: p.reason,
    priority: decision.priority,
    severity: decision.severity,
    confidence: observation.confidence ?? null,
    status: "ready",
    deadline: decision.deadline,
    evidence: observation.evidence ?? [],
    source_interactions: observation.source_interactions ?? [],
    source_entities: observation.source_entities ?? [],
    owner: p.owner ?? accountable,
    automation_intent: p.automation_intent,
    derived_from: observation.id ?? null,
  }));
}

/**
 * Return the Automation INTENT for an action, or null if it triggers no
 * automation. The intelligence layer emits this; it NEVER executes it.
 */
export function automationIntentFor(action: ActionDraft): AutomationIntent | null {
  if (!action.automation_intent) return null;
  return {
    intent_type: action.automation_intent,
    parameters: {
      action_type: action.action_type,
      subject: action.subject,
      owner: action.owner,
      due: action.deadline,
      derived_from: action.derived_from,
    },
  };
}
