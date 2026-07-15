// ServiceOS — Response drafting intelligence (PURE).
//
// Turns a normalised ResponseContext into a business-AWARE proposed reply body, and
// records the PROVENANCE (which context informed each part). Deterministic templating —
// no LLM, no customer-specific hard-coding: it composes generic context fields (customer
// name, the message subject, prior-contact history, priority) into a professional draft.
// A future model-based drafter can replace this module without changing anything else —
// same input, same {body, provenance} contract.

import type { ContextRef, ResponseContext } from "./response_context.ts";

export const RESPONSE_DRAFT_VERSION = "response-draft/1";

export interface DraftedResponse {
  body: string;
  provenance: ContextRef[];
  version: string;
}

function pushUnique(list: ContextRef[], ref: ContextRef | null): void {
  if (ref && !list.some((r) => r.kind === ref.kind && r.ref === ref.ref)) list.push(ref);
}

/**
 * Draft a business-aware response from context. Every sentence that uses a piece of
 * context records its provenance ref, so the immutable artifact shows exactly what
 * informed the draft. Missing context degrades gracefully (a still-valid generic reply).
 */
export function draftResponse(ctx: ResponseContext): DraftedResponse {
  const used: ContextRef[] = [];
  const lines: string[] = [];

  // Greeting — uses the resolved customer name when known (card provenance).
  const greetingName = ctx.customerName ?? "there";
  if (ctx.customerName && ctx.refs.card) pushUnique(used, ctx.refs.card);
  lines.push(`Hi ${greetingName},`, "");

  // Acknowledge the current message + its subject (current-interaction provenance).
  const about = ctx.currentSubject ? ` about "${ctx.currentSubject}"` : "";
  lines.push(`Thank you for getting in touch${about}.`);
  pushUnique(used, ctx.refs.current);

  // Acknowledge prior contact for a repeat customer (history provenance).
  if (ctx.isRepeatCustomer) {
    lines.push(
      "",
      "We can see you've been in contact with us recently, and we appreciate your continued patience.",
    );
    for (const h of ctx.refs.history) pushUnique(used, h);
  }

  // Reflect priority when the customer context marks it (card provenance).
  if (ctx.priority === "high" || ctx.priority === "critical") {
    lines.push(
      "",
      `We've flagged your message as ${ctx.priority} priority so the right person can help quickly.`,
    );
    pushUnique(used, ctx.refs.card);
  }

  lines.push(
    "",
    "A member of the team will review the details and follow up with you shortly.",
    "",
    "Best regards,",
    "The team",
  );

  return { body: lines.join("\n"), provenance: used, version: RESPONSE_DRAFT_VERSION };
}
