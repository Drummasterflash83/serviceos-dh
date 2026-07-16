// ServiceOS — Intelligence Eligibility (PURE decision layer).
//
// "Should this interaction become intelligence?" — a deliberate, deterministic, channel-
// neutral decision made ONCE per interaction, NOT buried in an edge function. Not every
// enriched interaction deserves an intelligence object: a customer complaint does, a
// "thanks" or a newsletter does not. This module returns a structured, explainable verdict
// (eligible + reason + confidence + the signals that fired) that the ingestion bridge
// records in the ledger for audit. No I/O, no LLM, no channel branching: same inputs →
// same verdict. A future model-based classifier can replace the body behind this contract.

export const ELIGIBILITY_VERSION = "eligibility/1";

export type EligibilityReason =
  // eligible
  | "customer_risk"
  | "sales_opportunity"
  | "supplier_risk"
  | "customer_context"
  | "unclassified_inbound"
  // ineligible
  | "empty"
  | "marketing"
  | "automated_notification"
  | "low_value"
  | "outbound_no_signal";

export interface EligibilityDecision {
  eligible: boolean;
  reason: EligibilityReason;
  confidence: number; // 0..1
  signals: string[]; // which cues fired (explainability)
  version: string;
}

/** The interaction facts the decision reads (a subset of IngestInteraction). */
export interface EligibilityInput {
  direction: string | null;
  interaction_type: string | null;
  subject: string | null;
  summary: string | null;
  body_preview: string | null;
  sentiment: string | null;
  priority: string | null;
  from_address: string | null;
  related_person_id: string | null;
  related_company_id: string | null;
}

const RISK =
  /\b(complaint|broken|again|not working|isn'?t working|still|unresolved|urgent|asap|angry|unhappy|dissatisf|disappointed|cancel|refund|chase|chasing|escalat|no response|missed|leak|no heating|no hot water|emergency|failed)\b/;
const SALES =
  /\b(quote|quotation|price|pricing|cost|new system|replace|replacement|install|installation|interested|proposal|book(?:ing)?|arrange|new boiler|upgrade|survey|estimate)\b/;
const OPS =
  /\b(delay|delayed|parts?|supplier|shortage|resched|out of stock|lead time|running late|can'?t make|won'?t make|backorder|awaiting|stuck)\b/;
const PLEASANTRY =
  /^(thanks|thank you|ta|cheers|ok|okay|noted|received|got it|great|perfect|no problem|will do|understood)[.! ]*$/;
const MARKETING =
  /\b(unsubscribe|newsletter|marketing|promotion|special offer|% off|view in browser|manage preferences|you'?re receiving this)\b/;
const AUTOMATED =
  /\b(no[- ]?reply|do not reply|automated|notification|delivery status|read receipt|out of office|mailer[- ]?daemon|undeliverable|receipt for|your order|verification code|one[- ]?time)\b/;
const NOREPLY_ADDR =
  /(no-?reply|do-?not-?reply|donotreply|notifications?@|mailer-daemon|postmaster|bounce)/i;

function hay(i: EligibilityInput): string {
  return `${i.subject ?? ""} ${i.summary ?? ""} ${i.body_preview ?? ""}`.trim().toLowerCase();
}
function decide(
  eligible: boolean,
  reason: EligibilityReason,
  confidence: number,
  signals: string[],
): EligibilityDecision {
  return { eligible, reason, confidence, signals, version: ELIGIBILITY_VERSION };
}

/**
 * The deliberate eligibility verdict. Order matters: hard "ignore" gates first
 * (empty / marketing / automated / pleasantry), then value signals (risk > sales > ops),
 * then a conservative "known customer said something substantive" fallback, so a real
 * business event is never silently dropped while noise never floods the intelligence layer.
 */
export function shouldCreateIntelligence(i: EligibilityInput): EligibilityDecision {
  const text = hay(i);
  const resolved = !!i.related_person_id || !!i.related_company_id;
  const inbound = i.direction === "inbound" || i.direction == null;

  // ── ignore gates ────────────────────────────────────────────────────────────
  if (!text || text === "(no content)") return decide(false, "empty", 1, ["no_content"]);
  if (NOREPLY_ADDR.test(i.from_address ?? "") || AUTOMATED.test(text))
    return decide(false, "automated_notification", 0.9, ["automated"]);
  if (MARKETING.test(text)) return decide(false, "marketing", 0.9, ["marketing"]);
  if (text.length <= 40 && PLEASANTRY.test(text))
    return decide(false, "low_value", 0.85, ["pleasantry"]);

  // ── value signals ───────────────────────────────────────────────────────────
  const negative = i.sentiment === "negative" || i.sentiment === "very_negative";
  const highPriority =
    i.priority === "high" || i.priority === "critical" || i.priority === "urgent";

  if (RISK.test(text) || negative) {
    const signals = [
      ...(RISK.test(text) ? ["risk_language"] : []),
      ...(negative ? ["negative_sentiment"] : []),
      ...(highPriority ? ["high_priority"] : []),
    ];
    return decide(true, "customer_risk", negative && RISK.test(text) ? 0.92 : 0.85, signals);
  }
  if (SALES.test(text)) return decide(true, "sales_opportunity", 0.82, ["sales_language"]);
  if (OPS.test(text)) return decide(true, "supplier_risk", 0.78, ["operational_language"]);

  // ── conservative fallbacks ──────────────────────────────────────────────────
  // A known customer sending a substantive inbound message is worth understanding.
  if (resolved && inbound && text.length >= 20)
    return decide(true, "customer_context", 0.66, ["known_customer", "substantive"]);
  // An unresolved but substantive inbound message — surface at low confidence rather than
  // miss a real event; noise was already filtered by the gates above.
  if (inbound && text.length >= 25)
    return decide(true, "unclassified_inbound", 0.55, ["substantive_inbound"]);

  // Outbound / trivial with no signal → not worth an intelligence object.
  return decide(false, inbound ? "low_value" : "outbound_no_signal", 0.6, ["no_signal"]);
}
