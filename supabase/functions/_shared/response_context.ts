// ServiceOS — Response Context assembler (PURE).
//
// Normalises the business context that informs a proposed customer response, from the
// EXISTING surfaces (customer_cards + its context projection, business_graph via the
// projection, and interaction history). It fabricates nothing and carries PROVENANCE
// refs so a draft can declare exactly which context informed it. Pure + deterministic:
// no DB, no network (the impure loader lives in response_assistant.ts).

/** A pointer to the piece of context that informed part of a draft. */
export interface ContextRef {
  kind: string; // customer_card | interaction | graph | …
  ref: string; // row id
  note?: string; // why it was used (human-readable)
}

export interface PriorInteraction {
  id: string;
  subject: string | null;
  occurred_at: string | null;
  direction: string | null;
}

export interface ResponseContextInput {
  current: {
    id: string;
    subject: string | null;
    summary: string | null;
    from_name: string | null;
  };
  /** The resolved customer card (with its context projection), or null when unresolved. */
  card: {
    id: string | null;
    title: string | null;
    status: string | null;
    priority: string | null;
    summary: string | null;
    relationshipCount?: number | null;
  } | null;
  /** Prior interactions for this customer (most-recent first). */
  history: PriorInteraction[];
}

export interface ResponseContext {
  customerName: string | null;
  status: string | null;
  priority: string | null;
  cardSummary: string | null;
  currentSubject: string | null;
  currentSummary: string | null;
  isRepeatCustomer: boolean;
  historyCount: number;
  relationshipCount: number | null;
  /** Available provenance refs, by role. */
  refs: {
    card: ContextRef | null;
    current: ContextRef;
    history: ContextRef[];
  };
}

/**
 * Assemble a normalised response context from already-fetched facts. Customer name
 * prefers the card, then the message sender; history excludes the current message and
 * is bounded. Deterministic: same inputs → same context. No channel/customer-specific
 * branching — every field is generic business context.
 */
export function buildResponseContext(input: ResponseContextInput): ResponseContext {
  const history = (input.history ?? []).filter((h) => h.id !== input.current.id).slice(0, 5);
  const customerName = input.card?.title || input.current.from_name || null;
  return {
    customerName,
    status: input.card?.status ?? null,
    priority: input.card?.priority ?? null,
    cardSummary: input.card?.summary ?? null,
    currentSubject: input.current.subject,
    currentSummary: input.current.summary,
    isRepeatCustomer: history.length > 0,
    historyCount: history.length,
    relationshipCount: input.card?.relationshipCount ?? null,
    refs: {
      card: input.card?.id
        ? { kind: "customer_card", ref: input.card.id, note: "customer identity + status" }
        : null,
      current: { kind: "interaction", ref: input.current.id, note: "current inbound message" },
      history: history.map((h) => ({ kind: "interaction", ref: h.id, note: "prior contact" })),
    },
  };
}
