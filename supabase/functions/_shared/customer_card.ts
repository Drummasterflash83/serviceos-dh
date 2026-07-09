// ServiceOS — shared Customer Card projection calculators (Deno).
//
// PURE functions only (no DB, no side effects) so the Health Engine and Activity
// Score are reusable and unit-reasoned. The Customer Card is a PROJECTION of the
// Business Graph — these turn already-read facts into explainable operational
// summaries. Every score is deterministic and carries its inputs; nothing is
// random and nothing is fabricated.

export type Health = "excellent" | "good" | "attention" | "critical";

export interface HealthInputs {
  openRecs: number;
  urgentRecs: number; // severity high/critical/emergency
  negativeSentiment: boolean;
  unansweredInbound: number; // inbound calls/emails with no later outbound
  waitingActions: number;
  overdueActions: number;
}

export interface HealthResult {
  health: Health;
  reasons: string[];
}

/**
 * Explainable customer health. Order matters: the first matching tier wins, and
 * every contributing factor is listed in `reasons` so the UI can show WHY.
 */
export function computeHealth(i: HealthInputs): HealthResult {
  const reasons: string[] = [];
  if (i.urgentRecs > 0) reasons.push(`${i.urgentRecs} urgent recommendation(s)`);
  if (i.overdueActions > 0) reasons.push(`${i.overdueActions} overdue action(s)`);
  if (i.unansweredInbound > 0) reasons.push(`${i.unansweredInbound} unanswered inbound message(s)`);
  if (i.waitingActions > 0) reasons.push(`${i.waitingActions} waiting action(s)`);
  if (i.negativeSentiment) reasons.push("recent negative sentiment");
  if (i.openRecs > 0) reasons.push(`${i.openRecs} open recommendation(s)`);

  const critical =
    i.urgentRecs > 0 || i.overdueActions > 0 || (i.negativeSentiment && i.unansweredInbound > 0);
  if (critical) return { health: "critical", reasons };

  const attention =
    i.openRecs > 0 || i.unansweredInbound > 0 || i.waitingActions > 0 || i.negativeSentiment;
  if (attention) return { health: "attention", reasons };

  // Nothing outstanding — "excellent" only when there's evidence of a live,
  // healthy relationship, otherwise plain "good".
  return { health: "good", reasons: reasons.length ? reasons : ["no outstanding actions"] };
}

/** Map health → the existing traffic-light card status. */
export function healthToCardStatus(health: Health): "green" | "amber" | "red" | "grey" {
  switch (health) {
    case "excellent":
    case "good":
      return "green";
    case "attention":
      return "amber";
    case "critical":
      return "red";
    default:
      return "grey";
  }
}

export interface ActivityInputs {
  interactionsLast7: number;
  interactionsPrev7: number;
  totalInteractions: number;
  openRecs: number;
  lastInteractionAgeDays: number | null;
  avgResponseHours: number | null;
}

export interface ActivityResult {
  score: number; // 0..100
  inputs: Record<string, unknown>; // the exact contribution breakdown (explainable)
}

/**
 * Activity score 0–100 from REAL signals. Documented, deterministic weighting:
 *   recency (≤1d 30 · ≤7d 20 · ≤30d 10) + volume (min 20, 2/interaction)
 *   + velocity (accelerating 15 · steady 8 · slowing 3) + responsiveness
 *   (≤4h 20 · ≤24h 12 · ≤72h 6) + engagement (min 10, 3/open rec).
 */
export function computeActivityScore(i: ActivityInputs): ActivityResult {
  let recency = 0;
  if (i.lastInteractionAgeDays !== null) {
    if (i.lastInteractionAgeDays <= 1) recency = 30;
    else if (i.lastInteractionAgeDays <= 7) recency = 20;
    else if (i.lastInteractionAgeDays <= 30) recency = 10;
  }
  const volume = Math.min(20, i.totalInteractions * 2);
  let velocity = 0;
  if (i.interactionsLast7 > i.interactionsPrev7) velocity = 15;
  else if (i.interactionsLast7 === i.interactionsPrev7 && i.interactionsLast7 > 0) velocity = 8;
  else if (i.interactionsLast7 > 0) velocity = 3;
  let responsiveness = 0;
  if (i.avgResponseHours !== null) {
    if (i.avgResponseHours <= 4) responsiveness = 20;
    else if (i.avgResponseHours <= 24) responsiveness = 12;
    else if (i.avgResponseHours <= 72) responsiveness = 6;
  }
  const engagement = Math.min(10, i.openRecs * 3);
  const score = Math.max(
    0,
    Math.min(100, Math.round(recency + volume + velocity + responsiveness + engagement)),
  );
  return {
    score,
    inputs: { recency, volume, velocity, responsiveness, engagement, ...i },
  };
}

/** Interaction trend from two consecutive 7-day windows. */
export function interactionTrend(last7: number, prev7: number): "up" | "flat" | "down" {
  if (last7 > prev7) return "up";
  if (last7 < prev7) return "down";
  return "flat";
}

export interface TimelineInteraction {
  interaction_type: string | null;
  direction: string | null;
  occurred_at: string | null;
}

/** One human-readable timeline line for an interaction (never includes content). */
export function humanizeInteraction(i: TimelineInteraction): string {
  const dir = i.direction === "inbound" ? "received" : i.direction === "outbound" ? "sent" : "";
  const type = i.interaction_type ?? "interaction";
  if (type === "phone_call") return dir === "sent" ? "Phone call made" : "Phone call received";
  if (type === "email_message") return dir === "sent" ? "Email sent" : "Email received";
  return `${type.replace(/_/g, " ")}${dir ? ` ${dir}` : ""}`.trim();
}

/**
 * Average hours between an inbound message and the next outbound reply, over a
 * chronologically-ascending interaction list. null when there is no answered
 * inbound to measure. Also returns unanswered inbound count (still-open threads).
 */
export function responsiveness(
  ascending: Array<{ direction: string | null; occurred_at: string | null }>,
): { avgResponseHours: number | null; unansweredInbound: number } {
  let sumHours = 0;
  let pairs = 0;
  let unanswered = 0;
  let pendingInboundAt: number | null = null;
  for (const ev of ascending) {
    const t = ev.occurred_at ? Date.parse(ev.occurred_at) : NaN;
    if (Number.isNaN(t)) continue;
    if (ev.direction === "inbound") {
      // A new inbound before a reply → the previous one is still unanswered.
      if (pendingInboundAt !== null) unanswered += 1;
      pendingInboundAt = t;
    } else if (ev.direction === "outbound" && pendingInboundAt !== null) {
      sumHours += Math.max(0, (t - pendingInboundAt) / 3_600_000);
      pairs += 1;
      pendingInboundAt = null;
    }
  }
  if (pendingInboundAt !== null) unanswered += 1;
  return {
    avgResponseHours: pairs > 0 ? Math.round((sumHours / pairs) * 10) / 10 : null,
    unansweredInbound: unanswered,
  };
}
