// ServiceOS — Customer Health: labelled callback evaluation set.
//
// SYNTHETIC / ANONYMISED. No real customer PII, no real DDIs, no real staff names —
// the named persona is "Synthia", an UNMISTAKABLY synthetic identity chosen so it can
// never collide with a real staff member. This is the labelled REGRESSION set the
// classifier + ownership + grouping are measured against; passing it is software
// regression evidence, NOT production validation (a real-data evaluation gate is
// required before any live shadow activation). Each case records the human truth
// (obligation exists / none / uncertain / already-satisfied), the expected
// responsibility source, the expected due policy and the expected grouping
// (obligationId — cases sharing one are the SAME obligation).

import type { CommunicationInput, OwnershipMaps, OwnershipSourceKind } from "../types.ts";

export type ObligationTruth = "exists" | "none" | "uncertain" | "already_satisfied";

export interface EvalCase {
  id: string;
  tenant: string;
  category: string;
  comm: CommunicationInput;
  truth: {
    obligation: ObligationTruth;
    expectedOwnerSource: OwnershipSourceKind;
    obligationId: string; // cases with the same obligationId are ONE obligation
    duePolicy?: "default" | "priority";
  };
  identity: { companyId: string | null; companyConf?: number | null; personId: string | null };
  resolution?: "none" | "possible" | "verified";
}

// Tenant ownership maps used for the wrong-responsibility measurement (synthetic).
export const EVAL_OWNERSHIP_MAPS: Record<string, Partial<OwnershipMaps>> = {
  "tenant-A": {
    ddi: { "+441111000001": { responsibility: "team:finance", label: "Finance line" } },
    queue: { scheduling: { responsibility: "team:scheduling", label: "Scheduling queue" } },
    named_recipient: { synthia: { responsibility: "member:synthia", label: "Synthia" } },
    fallback_role: { responsibility: "role:coordinator", label: "Coordinator" },
  },
  "tenant-B": {
    queue: { support: { responsibility: "team:support", label: "Support queue" } },
    fallback_role: { responsibility: "role:duty-manager", label: "Duty Manager" },
  },
};

function phone(over: Partial<CommunicationInput>): CommunicationInput {
  return {
    interactionId: over.interactionId ?? "x",
    interactionType: "phone_call",
    direction: "inbound",
    occurredAt: "2026-07-22T09:00:00Z",
    fromName: "Customer",
    fromAddress: null,
    phoneFrom: "+449000000000",
    phoneTo: "+441111000009",
    subject: null,
    summary: null,
    bodyPreview: null,
    disposition: null,
    ...over,
  };
}

export const CALLBACK_EVAL_SET: EvalCase[] = [
  // ── Explicit callback requests (obligation exists). ───────────────────────
  {
    id: "A01",
    tenant: "tenant-A",
    category: "explicit_callback",
    comm: phone({
      interactionId: "A01",
      queue: "scheduling",
      summary: "Customer asked us to call them back to rebook their annual service.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "A01" },
    identity: { companyId: "coA1", companyConf: 0.95, personId: "peA1" },
  },
  {
    id: "A02",
    tenant: "tenant-A",
    category: "explicit_callback_named",
    comm: phone({
      interactionId: "A02",
      summary: "Please could you ask Synthia to call me back about my quote.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "named_recipient", obligationId: "A02" },
    identity: { companyId: null, personId: "peA2" },
  },
  {
    id: "A03",
    tenant: "tenant-A",
    category: "explicit_callback_priority",
    comm: phone({
      interactionId: "A03",
      queue: "scheduling",
      summary: "No hot water, emergency — please call me back asap.",
    }),
    truth: {
      obligation: "exists",
      expectedOwnerSource: "queue",
      obligationId: "A03",
      duePolicy: "priority",
    },
    identity: { companyId: "coA3", companyConf: 0.9, personId: "peA3" },
  },
  {
    id: "A04",
    tenant: "tenant-A",
    category: "explicit_callback_ddi",
    comm: phone({
      interactionId: "A04",
      phoneTo: "+441111000001",
      summary: "Ring me back regarding my invoice please.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "ddi", obligationId: "A04" },
    identity: { companyId: "coA4", companyConf: 0.92, personId: "peA4" },
  },
  {
    id: "A05",
    tenant: "tenant-A",
    category: "reach_unavailable_person",
    comm: phone({
      interactionId: "A05",
      summary: "Is Synthia available? Can you get her to call me back today.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "named_recipient", obligationId: "A05" },
    identity: { companyId: null, personId: "peA5" },
  },
  {
    id: "A06",
    tenant: "tenant-A",
    category: "voicemail_enquiry",
    comm: phone({
      interactionId: "A06",
      disposition: "voicemail",
      queue: "scheduling",
      summary: "Voicemail left regarding a booking enquiry for next week.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "A06" },
    identity: { companyId: "coA6", companyConf: 0.88, personId: "peA6" },
  },
  {
    id: "A07",
    tenant: "tenant-A",
    category: "email_asks_for_call",
    comm: phone({
      interactionId: "A07",
      interactionType: "email_message",
      queue: "scheduling",
      summary: "Can you call me back on my mobile to arrange the visit?",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "A07" },
    identity: { companyId: "coA7", companyConf: 0.91, personId: "peA7" },
  },
  {
    id: "A08",
    tenant: "tenant-A",
    category: "fallback_owner",
    comm: phone({
      interactionId: "A08",
      summary: "Please give me a call back about my recent job.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "fallback_role", obligationId: "A08" },
    identity: { companyId: "coA8", companyConf: 0.9, personId: "peA8" },
  },

  // ── Multiple communications concerning ONE obligation (must fold). ────────
  {
    id: "A09a",
    tenant: "tenant-A",
    category: "one_obligation_many_comms",
    comm: phone({
      interactionId: "A09a",
      queue: "scheduling",
      summary: "Please call me back about my quote for the new boiler.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "OBLIG-Q" },
    identity: { companyId: "coA9", companyConf: 0.95, personId: "peA9" },
  },
  {
    id: "A09b",
    tenant: "tenant-A",
    category: "one_obligation_many_comms",
    comm: phone({
      interactionId: "A09b",
      queue: "scheduling",
      summary: "Chasing a callback on my boiler quote from earlier.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "OBLIG-Q" },
    identity: { companyId: "coA9", companyConf: 0.95, personId: "peA9" },
  },
  {
    id: "A09c",
    tenant: "tenant-A",
    category: "one_obligation_many_comms",
    comm: phone({
      interactionId: "A09c",
      queue: "scheduling",
      summary: "Still waiting for someone to call me back about that quote.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "OBLIG-Q" },
    identity: { companyId: "coA9", companyConf: 0.95, personId: "peA9" },
  },

  // ── Same customer, DIFFERENT obligations (must stay separate). ────────────
  {
    id: "A10",
    tenant: "tenant-A",
    category: "same_customer_diff_obligation",
    comm: phone({
      interactionId: "A10",
      queue: "scheduling",
      summary: "Call me back to book an appointment for a service.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "OBLIG-BOOK" },
    identity: { companyId: "coA9", companyConf: 0.95, personId: "peA9" },
  },
  {
    id: "A11",
    tenant: "tenant-A",
    category: "same_customer_diff_obligation",
    comm: phone({
      interactionId: "A11",
      phoneTo: "+441111000001",
      summary: "Also please call me back about my invoice — think I was overcharged.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "ddi", obligationId: "OBLIG-INV" },
    identity: { companyId: "coA9", companyConf: 0.95, personId: "peA9" },
  },

  // ── Repeated contact (overdue escalation). ────────────────────────────────
  {
    id: "A12",
    tenant: "tenant-A",
    category: "repeated_contact",
    comm: phone({
      interactionId: "A12",
      queue: "scheduling",
      summary: "This is the third time I've called — please call me back!",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "A12" },
    identity: { companyId: "coA12", companyConf: 0.9, personId: "peA12" },
  },

  // ── Already-resolved callback (must NOT become new open work). ────────────
  {
    id: "A13",
    tenant: "tenant-A",
    category: "already_resolved",
    comm: phone({
      interactionId: "A13",
      queue: "scheduling",
      summary: "Earlier asked for a callback about the quote; we spoke and it's sorted now.",
    }),
    truth: { obligation: "already_satisfied", expectedOwnerSource: "queue", obligationId: "A13" },
    identity: { companyId: "coA13", companyConf: 0.9, personId: "peA13" },
    resolution: "verified",
  },

  // ── Staff commitment + generic-person request (regression additions). ─────
  {
    id: "A14",
    tenant: "tenant-A",
    category: "staff_callback_commitment",
    comm: phone({
      interactionId: "A14",
      disposition: "answered",
      queue: "scheduling",
      summary: "Told the customer we'll call them back tomorrow about the boiler quote.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "A14" },
    identity: { companyId: "coA14", companyConf: 0.9, personId: "peA14" },
  },
  {
    id: "A15",
    tenant: "tenant-A",
    category: "ask_someone_generic",
    comm: phone({
      interactionId: "A15",
      summary: "Please ask someone to call me back about my radiator.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "fallback_role", obligationId: "A15" },
    identity: { companyId: null, personId: "peA15" },
  },

  // ── Calls with NO callback request (negatives). ───────────────────────────
  {
    id: "N01",
    tenant: "tenant-A",
    category: "generic_unanswered",
    comm: phone({
      interactionId: "N01",
      disposition: "missed",
      summary: "Missed call from customer, line dropped before answer.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N01" },
    identity: { companyId: "coN1", companyConf: 0.9, personId: "peN1" },
  },
  {
    id: "N02",
    tenant: "tenant-A",
    category: "answered_resolved",
    comm: phone({
      interactionId: "N02",
      disposition: "answered",
      summary: "Confirmed appointment time for Thursday, nothing further needed.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N02" },
    identity: { companyId: "coN2", companyConf: 0.9, personId: "peN2" },
  },
  {
    id: "N03",
    tenant: "tenant-A",
    category: "resolved_on_transfer",
    comm: phone({
      interactionId: "N03",
      disposition: "resolved_on_transfer",
      summary: "Wanted a callback but was transferred and the query was resolved.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N03" },
    identity: { companyId: "coN3", companyConf: 0.9, personId: "peN3" },
  },
  {
    id: "N04",
    tenant: "tenant-A",
    category: "email_only",
    comm: phone({
      interactionId: "N04",
      interactionType: "email_message",
      summary: "Please email me the quote when it's ready.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N04" },
    identity: { companyId: "coN4", companyConf: 0.9, personId: "peN4" },
  },
  {
    id: "N05",
    tenant: "tenant-A",
    category: "spam",
    comm: phone({
      interactionId: "N05",
      summary: "We offer marketing services to rank your website — call us back to hear more.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N05" },
    identity: { companyId: null, personId: null },
  },
  {
    id: "N06",
    tenant: "tenant-A",
    category: "internal",
    comm: phone({
      interactionId: "N06",
      direction: "internal",
      summary: "Engineer calling office to confirm parts — call me back.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N06" },
    identity: { companyId: null, personId: null },
  },
  {
    id: "N07",
    tenant: "tenant-A",
    category: "supplier",
    comm: phone({
      interactionId: "N07",
      callerKind: "supplier",
      summary: "Supplier: please call us back about the parts delivery slot.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N07" },
    identity: { companyId: null, personId: null },
  },
  {
    id: "N08",
    tenant: "tenant-A",
    category: "accidental_empty",
    comm: phone({ interactionId: "N08", disposition: "abandoned", summary: "" }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N08" },
    identity: { companyId: null, personId: null },
  },

  // ── Adversarial negatives (contain "call ... back" but are NOT requests). ─
  {
    id: "N09",
    tenant: "tenant-A",
    category: "customer_will_call_back",
    comm: phone({
      interactionId: "N09",
      disposition: "answered",
      summary: "Customer said they'll call us back later themselves, no action needed.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N09" },
    identity: { companyId: "coN9", companyConf: 0.9, personId: "peN9" },
  },
  {
    id: "N10",
    tenant: "tenant-A",
    category: "thanks_no_request",
    comm: phone({
      interactionId: "N10",
      disposition: "answered",
      summary: "Just calling to say thanks for the great service, no need to do anything.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N10" },
    identity: { companyId: "coN10", companyConf: 0.9, personId: "peN10" },
  },
  {
    id: "N11",
    tenant: "tenant-A",
    category: "customer_will_ring",
    comm: phone({
      interactionId: "N11",
      disposition: "voicemail",
      summary: "I'll call you back tomorrow once I've checked my diary.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N11" },
    identity: { companyId: "coN11", companyConf: 0.9, personId: "peN11" },
  },

  {
    id: "N12",
    tenant: "tenant-A",
    category: "callback_declined",
    comm: phone({
      interactionId: "N12",
      disposition: "voicemail",
      summary: "All sorted now, no need to call me back, thanks.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N12" },
    identity: { companyId: "coN12", companyConf: 0.9, personId: "peN12" },
  },
  {
    id: "N13",
    tenant: "tenant-A",
    category: "customer_will_ring_curly_apostrophe",
    comm: phone({
      interactionId: "N13",
      disposition: "voicemail",
      summary: "I’ll call you back tomorrow once I’ve checked my diary.",
    }),
    truth: { obligation: "none", expectedOwnerSource: "needs_context", obligationId: "N13" },
    identity: { companyId: "coN13", companyConf: 0.9, personId: "peN13" },
  },

  // ── Ambiguous messages (should route to uncertain). ───────────────────────
  {
    id: "U01",
    tenant: "tenant-A",
    category: "ambiguous",
    comm: phone({ interactionId: "U01", disposition: "voicemail", summary: "left message" }),
    truth: { obligation: "uncertain", expectedOwnerSource: "needs_context", obligationId: "U01" },
    identity: { companyId: "coU1", companyConf: 0.9, personId: "peU1" },
  },
  {
    id: "U02",
    tenant: "tenant-A",
    category: "ambiguous",
    comm: phone({
      interactionId: "U02",
      summary: "Customer rang, unclear what they wanted, connection was poor.",
    }),
    truth: { obligation: "uncertain", expectedOwnerSource: "needs_context", obligationId: "U02" },
    identity: { companyId: "coU2", companyConf: 0.9, personId: "peU2" },
  },

  // ── Cross-tenant isolation (identical text, DIFFERENT tenant). ────────────
  {
    id: "B01",
    tenant: "tenant-B",
    category: "explicit_callback_other_tenant",
    comm: phone({
      interactionId: "B01",
      queue: "support",
      summary: "Please call me back about my quote for the new boiler.",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "queue", obligationId: "B01" },
    identity: { companyId: "coB1", companyConf: 0.95, personId: "peB1" },
  },
  {
    id: "B02",
    tenant: "tenant-B",
    category: "fallback_other_tenant",
    comm: phone({
      interactionId: "B02",
      summary: "Can you call me back about my recent service visit?",
    }),
    truth: { obligation: "exists", expectedOwnerSource: "fallback_role", obligationId: "B02" },
    identity: { companyId: "coB2", companyConf: 0.9, personId: "peB2" },
  },
];
