// ServiceOS — Customer Health: shadow-safety boundary.
//
// The single source of truth for what shadow processing is ALLOWED to write. The pure
// pipeline emits a write plan naming only these tables; the impure handler asserts the
// plan against this allowlist before executing and refuses anything outside it. This
// makes "zero operational side effects" a checkable invariant, not a hope.
//
// Explicitly FORBIDDEN targets (canonical work / execution / notification / outcome):
//   intelligence_objects, object_state_history, recommendations (write), decision_log,
//   automation_intents, automation_intent_states, automation_approvals,
//   automation_executions, outcomes, review_tasks, platform_events (domain effects),
//   customer_cards (write), interactions (write), and any *_notifications table.

export const SHADOW_WRITE_ALLOWLIST = [
  "health_objects",
  "health_assessments",
  "health_commitment_proposals",
  "health_proposal_sources",
  "health_proposal_decisions",
  // corrections is append-only learning; a correction-class review decision may append
  // one (it never mutates or deletes). It is NOT canonical work, execution or output.
  "corrections",
  // platform_jobs is the queue bookkeeping for the shadow job itself (status only).
  "platform_jobs",
] as const;

export type ShadowWriteTable = (typeof SHADOW_WRITE_ALLOWLIST)[number];

/** Tables that would represent an operational side effect if ever written in shadow. */
export const FORBIDDEN_SHADOW_TABLES = [
  "intelligence_objects",
  "object_state_history",
  "decision_log",
  "automation_intents",
  "automation_intent_states",
  "automation_approvals",
  "automation_executions",
  "outcomes",
  "review_tasks",
] as const;

export interface ShadowSafetyResult {
  safe: boolean;
  offending: string[];
}

/** Assert a set of target tables is a subset of the shadow allowlist. Pure. */
export function assertShadowSafe(tables: Iterable<string>): ShadowSafetyResult {
  const allow = new Set<string>(SHADOW_WRITE_ALLOWLIST);
  const offending: string[] = [];
  for (const t of tables) if (!allow.has(t)) offending.push(t);
  return { safe: offending.length === 0, offending };
}
