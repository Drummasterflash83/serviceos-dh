// ServiceOS — shared Recommendation Engine (Deno, service-role).
//
// Deterministic, rule-based v1 — NO AI. Turns real customer-card projections +
// interaction state into specific, EXPLAINABLE next-actions. Every recommendation
// answers: what happened (title), why it matters (detail), what to do
// (recommended_action), what happens if ignored (impact), and on what evidence.
// Rules are pure functions; the DB helpers are idempotent and tenant-bound.
//
// Idempotency: the DB enforces at most one OPEN recommendation of a `type` per
// card (unique index recommendations_open_uk), so re-running upserts/enriches
// instead of duplicating — and naturally merges with the Identity Engine's rows
// of the same type. Nothing here sends messages or executes actions.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// The recommendation types this engine OWNS (may create, enrich, and auto-close).
export const ENGINE_TYPES = [
  "repeat_contact_today",
  "customer_needs_attention",
  "respond_to_customer",
  "review_new_contact",
  "check_unhappy_customer",
  "card_needs_review",
] as const;

const STALE_DAYS = 14;

export type Severity = "critical" | "high" | "medium";

export interface DesiredRec {
  type: string;
  source_rule: string;
  severity: Severity;
  title: string;
  detail: string; // why it matters (explanation)
  recommended_action: string; // what to do next
  impact: string; // what happens if ignored
  confidence: number;
  due_at: string | null;
  interaction_id: string | null;
  evidence: Array<{ source: string; detail: string }>;
}

export interface CardInput {
  id: string;
  confidence: number | null;
  latest_activity_at: string | null;
}

export interface ProjectionLite {
  business?: { health?: string | null; sentiment?: string | null };
  operations?: { open_recommendations?: number };
  communication?: { channels?: string[] };
}

export interface InteractionLite {
  id: string;
  direction: string | null;
  occurred_at: string | null;
  interaction_type: string | null;
  sentiment: string | null;
}

function hhmm(iso: string | null): string {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : "";
}
function ymd(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}
function startOfTodayMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Deterministic priority for a rule. Kept separate so it is explainable and
 * testable in isolation.
 */
export function priorityForRecommendation(
  rule: string,
  inputs: { count?: number; health?: string | null; ageHours?: number; confidence?: number | null },
): Severity {
  switch (rule) {
    case "repeated_contact_today":
      return (inputs.count ?? 0) >= 3 ? "critical" : "high";
    case "card_health":
      return inputs.health === "critical" ? "critical" : "high";
    case "unanswered_inbound":
      return (inputs.ageHours ?? 0) >= 24
        ? "critical"
        : (inputs.ageHours ?? 0) >= 4
          ? "high"
          : "medium";
    case "negative_sentiment":
      return (inputs.confidence ?? 0.6) >= 0.7 ? "critical" : "high";
    case "new_customer_review":
    case "stale_card":
    default:
      return "medium";
  }
}

/** Sanitise evidence: small structured hints only, never transcript/audio/PII. */
export function recommendationEvidence(
  items: Array<{ source: string; detail: string }>,
): Array<{ source: string; detail: string }> {
  return items.slice(0, 8).map((i) => ({
    source: String(i.source).slice(0, 60),
    detail: String(i.detail).slice(0, 200),
  }));
}

/**
 * Apply the v1 rules to ONE card. Pure and deterministic — takes already-read
 * data, returns the recommendations that SHOULD be open for this card right now.
 * The caller upserts these and closes any engine-owned type not returned here.
 */
export function buildRecommendationsForCard(input: {
  card: CardInput;
  projection: ProjectionLite | null;
  interactions: InteractionLite[]; // newest first
  personVerified: boolean | null;
  nowMs: number;
}): DesiredRec[] {
  const { card, projection, interactions, personVerified, nowMs } = input;
  const out: DesiredRec[] = [];
  const health = projection?.business?.health ?? null;
  const sentiment = projection?.business?.sentiment ?? null;
  const openRecs = projection?.operations?.open_recommendations ?? 0;

  // Rule 1 — Repeated contact today.
  const startToday = startOfTodayMs(nowMs);
  const today = interactions.filter(
    (i) => i.occurred_at && Date.parse(i.occurred_at) >= startToday,
  );
  if (today.length >= 2) {
    out.push({
      type: "repeat_contact_today",
      source_rule: "repeated_contact_today",
      severity: priorityForRecommendation("repeated_contact_today", { count: today.length }),
      title: "Review repeated contact",
      detail: `This customer has ${today.length} interactions today — likely an unresolved issue.`,
      recommended_action: "Review today's contacts and respond before they reach out again.",
      impact: "Repeated unanswered contact drives frustration and complaints.",
      confidence: 0.9,
      due_at: null,
      interaction_id: today[0].id,
      evidence: recommendationEvidence(
        today.slice(0, 5).map((i) => ({
          source: "interaction",
          detail: `${i.interaction_type ?? "interaction"} at ${hhmm(i.occurred_at)}`,
        })),
      ),
    });
  }

  // Rule 2 — Waiting customer (card health attention/critical).
  if (health === "attention" || health === "critical") {
    out.push({
      type: "customer_needs_attention",
      source_rule: "card_health",
      severity: priorityForRecommendation("card_health", { health }),
      title: "Customer needs attention",
      detail: `Customer health is ${health} — review and take the next best action.`,
      recommended_action: "Open the card and action the highest-priority item.",
      impact: "At-risk customers left unattended churn or escalate.",
      confidence: card.confidence ?? 0.7,
      due_at: null,
      interaction_id: null,
      evidence: recommendationEvidence([{ source: "card", detail: `projected health: ${health}` }]),
    });
  }

  // Rule 3 — Unanswered inbound (the latest interaction is inbound).
  const latest = interactions[0];
  if (latest && latest.direction === "inbound" && latest.occurred_at) {
    const ageHours = (nowMs - Date.parse(latest.occurred_at)) / 3_600_000;
    out.push({
      type: "respond_to_customer",
      source_rule: "unanswered_inbound",
      severity: priorityForRecommendation("unanswered_inbound", { ageHours }),
      title: "Respond to customer",
      detail: `An inbound ${latest.interaction_type ?? "message"} has had no reply for ${Math.round(ageHours)}h.`,
      recommended_action: "Reply to the customer's most recent message.",
      impact: "Slow responses lower satisfaction and win-rates.",
      confidence: 0.9,
      due_at: new Date(Date.parse(latest.occurred_at) + 24 * 3_600_000).toISOString(),
      interaction_id: latest.id,
      evidence: recommendationEvidence([
        {
          source: "interaction",
          detail: `inbound ${latest.interaction_type ?? "message"} at ${hhmm(latest.occurred_at)}, unanswered`,
        },
      ]),
    });
  }

  // Rule 4 — New customer review (provisional, unverified contact).
  if (personVerified === false) {
    out.push({
      type: "review_new_contact",
      source_rule: "new_customer_review",
      severity: priorityForRecommendation("new_customer_review", {}),
      title: "Review new customer",
      detail: "This contact was auto-created from an interaction and hasn't been confirmed.",
      recommended_action: "Confirm the customer's identity, or merge/link them.",
      impact: "Unverified contacts fragment history and can misroute work.",
      confidence: card.confidence ?? 0.5,
      due_at: null,
      interaction_id: null,
      evidence: recommendationEvidence([
        { source: "identity", detail: `auto-created; confidence ${card.confidence ?? "unknown"}` },
      ]),
    });
  }

  // Rule 5 — Negative sentiment.
  if (sentiment === "negative") {
    const negInter = interactions.find((i) => i.sentiment === "negative") ?? null;
    out.push({
      type: "check_unhappy_customer",
      source_rule: "negative_sentiment",
      severity: priorityForRecommendation("negative_sentiment", { confidence: card.confidence }),
      title: "Check unhappy customer",
      detail: "Recent sentiment is negative — the customer may be unhappy.",
      recommended_action: "Call the customer to understand and resolve the issue.",
      impact: "Unaddressed negative sentiment escalates to complaints and churn.",
      confidence: 0.8,
      due_at: null,
      interaction_id: negInter?.id ?? null,
      evidence: recommendationEvidence([
        negInter
          ? {
              source: "interaction",
              detail: `negative sentiment on ${negInter.interaction_type ?? "interaction"} at ${hhmm(negInter.occurred_at)}`,
            }
          : { source: "card", detail: "negative sentiment in latest activity" },
      ]),
    });
  }

  // Rule 6 — Stale card (no recent activity but open actions remain).
  if (openRecs > 0 && card.latest_activity_at) {
    const ageDays = (nowMs - Date.parse(card.latest_activity_at)) / 86_400_000;
    if (ageDays >= STALE_DAYS) {
      out.push({
        type: "card_needs_review",
        source_rule: "stale_card",
        severity: priorityForRecommendation("stale_card", {}),
        title: "Card needs review",
        detail: `No activity for ${Math.round(ageDays)} days but ${openRecs} open action(s) remain.`,
        recommended_action: "Review the card and close or progress its open actions.",
        impact: "Stale open actions clutter the queue and hide real work.",
        confidence: 0.7,
        due_at: null,
        interaction_id: null,
        evidence: recommendationEvidence([
          {
            source: "card",
            detail: `last activity ${ymd(card.latest_activity_at)}, ${openRecs} open action(s)`,
          },
        ]),
      });
    }
  }

  return out;
}

/**
 * Idempotent upsert of one recommendation for a card. Insert as OPEN; on the
 * open-per-(card,type) unique violation, enrich the existing open row instead of
 * duplicating. Never throws. Returns { id, created }.
 */
export async function upsertRecommendation(
  client: SupabaseClient,
  input: {
    tenantId: string;
    cardId: string;
    personId: string | null;
    companyId: string | null;
    rec: DesiredRec;
  },
): Promise<{ id: string | null; created: boolean }> {
  const { tenantId, cardId, personId, companyId, rec } = input;
  const shared = {
    title: rec.title,
    detail: rec.detail,
    severity: rec.severity,
    evidence: rec.evidence,
    recommended_action: rec.recommended_action,
    confidence: rec.confidence,
    source_rule: rec.source_rule,
    impact: rec.impact,
    due_at: rec.due_at,
    interaction_id: rec.interaction_id,
  };
  try {
    const { data, error } = await client
      .from("recommendations")
      .insert({
        tenant_id: tenantId,
        type: rec.type,
        status: "open",
        card_id: cardId,
        person_id: personId,
        company_id: companyId,
        created_by: "system",
        ...shared,
      })
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string, created: true };
    // Open rec of this type already exists → enrich it (adopts Identity's row too).
    if (error && (error as { code?: string }).code === "23505") {
      const { data: existing } = await client
        .from("recommendations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("card_id", cardId)
        .eq("type", rec.type)
        .eq("status", "open")
        .maybeSingle();
      const id = (existing?.id as string | undefined) ?? null;
      if (id) await client.from("recommendations").update(shared).eq("id", id);
      return { id, created: false };
    }
    return { id: null, created: false };
  } catch {
    return { id: null, created: false };
  }
}

/**
 * Close (status→resolved) engine-owned OPEN recommendations for a card whose rule
 * no longer fires — `keepTypes` are the types that fired this run. Only
 * system-created rows of an ENGINE_TYPE are touched (never human-authored ones).
 * Best-effort; returns the number closed.
 */
export async function closeResolvedRecommendations(
  client: SupabaseClient,
  input: { tenantId: string; cardId: string; keepTypes: string[]; nowIso: string },
): Promise<number> {
  const toClose = ENGINE_TYPES.filter((t) => !input.keepTypes.includes(t));
  if (toClose.length === 0) return 0;
  try {
    const { data } = await client
      .from("recommendations")
      .update({ status: "resolved", resolved_at: input.nowIso })
      .eq("tenant_id", input.tenantId)
      .eq("card_id", input.cardId)
      .eq("status", "open")
      .eq("created_by", "system")
      .in("type", toClose)
      .select("id");
    return (data ?? []).length;
  } catch {
    return 0;
  }
}
