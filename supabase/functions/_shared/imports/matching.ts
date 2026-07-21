// ServiceOS — Deterministic, explainable import matching (PURE).
//
// Match priority is fixed and evidence-bearing. The Edge Function runs the DB lookups for each
// strategy (in priority order) and passes the hits here; this module decides the outcome without
// I/O. Two records are NEVER merged silently on an uncertain match — a strategy that returns
// multiple candidates yields a `probable` outcome routed to the review/conflict queue.

export type MatchAction = "matched" | "probable" | "new";

export interface StrategyHit {
  strategy: string; // external_id | phone | email | name_postcode | job_number | …
  entityIds: string[]; // candidate canonical ids found by this strategy
  confidence: number; // strategy-level confidence when a single hit
}

export interface MatchResult {
  action: MatchAction;
  entityId: string | null;
  strategy: string; // winning strategy, or "new"
  confidence: number;
  evidence: string[];
  conflicts: string[]; // candidate ids when ambiguous
}

// Priority orders (highest first). The Edge Function must evaluate strategies in these orders.
export const CUSTOMER_MATCH_PRIORITY = ["external_id", "phone", "email", "name_postcode"] as const;
export const JOB_MATCH_PRIORITY = ["external_id", "job_number", "customer_date_desc"] as const;
export const STAFF_MATCH_PRIORITY = ["external_id", "email", "phone", "name"] as const;

const STRATEGY_CONFIDENCE: Record<string, number> = {
  external_id: 1.0,
  job_number: 0.98,
  email: 0.95,
  phone: 0.92,
  name_postcode: 0.85,
  customer_date_desc: 0.8,
  name: 0.6,
};

/**
 * Decide the match outcome from ordered strategy hits. Walk in priority order:
 *  - first strategy with EXACTLY ONE candidate → matched (that entity, strategy confidence);
 *  - a strategy with >1 candidates → probable (ambiguous → review), stop;
 *  - none hit → new.
 * `order` is the priority list for the entity type.
 */
export function decideMatch(order: readonly string[], hits: StrategyHit[]): MatchResult {
  const byStrategy = new Map(hits.map((h) => [h.strategy, h]));
  for (const strategy of order) {
    const hit = byStrategy.get(strategy);
    if (!hit || hit.entityIds.length === 0) continue;
    const conf = hit.confidence || STRATEGY_CONFIDENCE[strategy] || 0.5;
    if (hit.entityIds.length === 1) {
      return {
        action: "matched",
        entityId: hit.entityIds[0],
        strategy,
        confidence: conf,
        evidence: [`Matched existing record by ${strategy.replace(/_/g, " ")}`],
        conflicts: [],
      };
    }
    // Multiple candidates for the strongest strategy that hit → ambiguous, do not merge.
    return {
      action: "probable",
      entityId: null,
      strategy,
      confidence: Math.min(0.5, conf),
      evidence: [
        `Ambiguous ${strategy.replace(/_/g, " ")} match — ${hit.entityIds.length} candidates`,
      ],
      conflicts: hit.entityIds,
    };
  }
  return {
    action: "new",
    entityId: null,
    strategy: "new",
    confidence: 1.0,
    evidence: ["No existing match — new record"],
    conflicts: [],
  };
}

/**
 * Guard: never overwrite a stronger canonical value with a weaker imported one. Returns the
 * fields the import is ALLOWED to write on an update. `existingVerified` marks canonical fields
 * that are human-verified (protected). Imported values only fill blanks or unverified fields.
 */
export function writableFields(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
  existingVerified: boolean,
): { fields: Record<string, unknown>; conflicts: string[] } {
  const fields: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (v == null || v === "") continue;
    const cur = existing[k];
    if (cur == null || cur === "") {
      fields[k] = v; // fill a blank
    } else if (String(cur) === String(v)) {
      // same value → no-op
    } else if (existingVerified) {
      conflicts.push(k); // verified canonical wins; record the conflict, don't overwrite
    } else {
      // differing but unverified → still record a conflict rather than silently clobber
      conflicts.push(k);
    }
  }
  return { fields, conflicts };
}
