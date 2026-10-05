// ServiceOS — Reply Draft (PURE model of a customer-response artifact).
//
// The first-class object the Customer Response Assistant produces: a structured,
// channel-agnostic reply DRAFT (recipient / subject / body + source-interaction
// provenance). It is the foundation for future channels (email → SMS → WhatsApp →
// letter → portal) — the intelligence layer decides an action; the capability layer
// produces this artifact. v1 records it IMMUTABLY via the Automation Engine's execution
// attempt with NO transmission (external_side_effect = false). Pure + testable: no DB,
// no network, no side effect.

/** A pointer to a piece of business context that informed the drafted body. */
export interface ReplyProvenanceRef {
  kind: string;
  ref: string;
  note?: string;
}

export interface ReplyDraft {
  channel: string; // email (SMS/WhatsApp/… reuse the same shape later)
  recipient: string;
  subject: string;
  body: string;
  source_interaction: string;
  /** Which business context informed the drafted body (empty for a generic draft). */
  provenance: ReplyProvenanceRef[];
}

/** Normalise a reply subject: "Re: <original>" (idempotent — never "Re: Re: …"). */
export function replySubject(original: string | null | undefined): string {
  const s = (original ?? "").trim();
  if (!s) return "Re: (no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export type BuildReplyResult = { ok: true; draft: ReplyDraft } | { ok: false; error: string };

/**
 * Build a channel-agnostic reply draft from resolved facts. Fabricates nothing: a
 * missing recipient / body / source interaction is an explicit error (the capability
 * refuses to draft an unaddressed or empty reply). Body is bounded. Deterministic.
 */
export function buildReplyDraft(input: {
  channel?: string;
  recipient: string | null | undefined;
  originalSubject: string | null | undefined;
  body: string | null | undefined;
  sourceInteraction: string | null | undefined;
  provenance?: ReplyProvenanceRef[];
}): BuildReplyResult {
  if (!input.recipient || !input.recipient.trim()) return { ok: false, error: "no_recipient" };
  if (!input.body || !input.body.trim()) return { ok: false, error: "empty_body" };
  if (!input.sourceInteraction) return { ok: false, error: "no_source_interaction" };
  return {
    ok: true,
    draft: {
      channel: input.channel ?? "email",
      recipient: input.recipient,
      subject: replySubject(input.originalSubject),
      body: input.body.slice(0, 4000), // bounded; no unbounded content in the audit record
      source_interaction: input.sourceInteraction,
      provenance: Array.isArray(input.provenance) ? input.provenance : [],
    },
  };
}
