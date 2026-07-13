// Universal Decision Engine — controlled reason-code registry (pure).
//
// Every routing decision cites machine-readable reason codes from THIS list.
// Prose summaries are generated from codes + tenant terminology; the codes, not
// the prose, are the audit trail. New codes are added here (a reviewed change),
// never invented ad hoc — the conformance gate rejects unknown codes in core.

export const REASON_CODES = [
  // machine-uncertainty (→ OpenFolk)
  "conflicting_evidence",
  "evidence_insufficient",
  "confidence_below_threshold",
  "ambiguity_too_high",
  "missing_policy",
  "unfamiliar_pattern",
  // incomplete configuration — a decision authority must fail safe, never permit
  "incomplete_configuration",
  "missing_authority_policy",
  "missing_automation_policy",
  "missing_risk_policy",
  "authority_currency_mismatch",
  // authority / judgement
  "authority_required",
  "outside_delegated_limit",
  "within_delegated_authority",
  "customer_approval_required",
  "tenant_judgement_required",
  // risk / reversibility
  "risk_exceeds_policy",
  "risk_within_policy",
  "irreversible_action",
  "reversible_within_policy",
  // dependency / lifecycle
  "dependency_unmet",
  // automation
  "automation_permitted",
  "automation_prohibited",
  "automation_authorised",
  "confidence_sufficient",
  // terminal
  "policy_prohibits_action",
  "no_action_required",
] as const;

export type ReasonCode = (typeof REASON_CODES)[number];

const SET: ReadonlySet<string> = new Set(REASON_CODES);

/** True when every code is in the controlled registry. */
export function areReasonCodes(codes: string[]): codes is ReasonCode[] {
  return codes.every((c) => SET.has(c));
}

export function isReasonCode(code: string): code is ReasonCode {
  return SET.has(code);
}
