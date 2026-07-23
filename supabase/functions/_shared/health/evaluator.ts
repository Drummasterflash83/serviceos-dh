// ServiceOS — Customer Health: pure evaluator, resolution matching, subject resolution.
//
// PURE and deterministic (like objectives.ts evaluateObjectiveHealth). Given the same
// obligation state, policy and injected clock, it always returns the same reading.
// No DB, no events, no wall-clock (nowMs is injected), no tenant literals.
//
// Scope (Track A, v1): callback obligations only. NO margin, contract, ARR, job,
// site or finance drivers — those are explicitly out of scope.

import {
  type CallbackPolicyConfig,
  type CommunicationInput,
  DEFAULT_CALLBACK_POLICY,
  type Driver,
  type EvidenceItem,
  type HealthReading,
  type HealthState,
  type HealthTrend,
  type ObligationState,
  type ResolutionMatch,
  type SubjectResolution,
} from "./types.ts";

const HOUR_MS = 3_600_000;

/** Lower is better. Used for trend and for "never let stale/unknown read healthy". */
const CONCERN: Record<HealthState, number> = {
  healthy: 0,
  recovering: 1,
  watch: 2,
  at_risk: 3,
  critical: 4,
  unknown: -1, // handled specially
};

function trendFrom(prev: HealthState | null, next: HealthState): HealthTrend {
  if (!prev || prev === "unknown" || next === "unknown") return "unknown";
  const a = CONCERN[prev];
  const b = CONCERN[next];
  if (b < a) return "improving";
  if (b > a) return "worsening";
  return "stable";
}

function freshnessOf(newestEvidenceAt: string | null, nowMs: number, staleAfterHours: number) {
  if (!newestEvidenceAt) return { label: "unknown" as const, ageHours: null as number | null };
  const ageHours = (nowMs - Date.parse(newestEvidenceAt)) / HOUR_MS;
  if (!Number.isFinite(ageHours)) return { label: "unknown" as const, ageHours: null };
  if (ageHours <= staleAfterHours / 4) return { label: "fresh" as const, ageHours };
  if (ageHours <= staleAfterHours) return { label: "aging" as const, ageHours };
  return { label: "stale" as const, ageHours };
}

/**
 * Evaluate Customer Health for one callback obligation. Every reading explains which
 * drivers fired, its evidence, confidence, freshness and what changed vs the prior.
 */
export function evaluateCallbackHealth(input: {
  obligation: ObligationState;
  policy?: Partial<CallbackPolicyConfig>;
  priorState?: HealthState | null;
  nowMs: number;
  extraEvidence?: EvidenceItem[];
}): HealthReading {
  const cfg: CallbackPolicyConfig = { ...DEFAULT_CALLBACK_POLICY, ...(input.policy ?? {}) };
  const o = input.obligation;
  const now = input.nowMs;
  const drivers: Driver[] = [];
  const risks: string[] = [];
  const opportunities: string[] = [];
  const evidence: EvidenceItem[] = [...(input.extraEvidence ?? [])];

  const fresh = freshnessOf(o.newestEvidenceAt, now, cfg.staleAfterHours);

  let state: HealthState;
  let confidence = 0.8;

  if (!o.hasOpenCallback) {
    // No open obligation. Verified resolution ⇒ recovering; otherwise healthy, unless
    // we have no/stale evidence (then unknown — stale data never reads healthy).
    if (o.resolution === "verified") {
      state = "recovering";
      drivers.push({
        code: "resolution_evidence_verified",
        detail: "A verified callback was observed.",
      });
      opportunities.push("Confirm the customer is satisfied and close the loop.");
    } else if (!o.newestEvidenceAt || fresh.label === "stale") {
      state = "unknown";
      drivers.push({
        code: "evidence_stale",
        detail: "No fresh evidence of an open or resolved callback.",
      });
      confidence = 0.4;
    } else if (o.ambiguity > 0.4) {
      // Uncertain evidence establishes NOTHING about this customer's health. Absence
      // of an established obligation is never positive evidence — 'healthy' requires
      // evidence that no relevant open risk exists, and this communication could not
      // be established either way.
      state = "unknown";
      drivers.push({
        code: "uncertainty",
        detail:
          "The communication's intent could not be established — health is unknown, not healthy.",
      });
      confidence = 0.35;
    } else {
      state = "healthy";
      drivers.push({ code: "no_open_callback", detail: "No open callback obligation." });
    }
  } else {
    // Open obligation.
    drivers.push({
      code: "explicit_callback_open",
      detail: "An explicit callback obligation is open.",
    });
    const dueMs = o.dueAt ? Date.parse(o.dueAt) : null;
    const overdue = dueMs != null && Number.isFinite(dueMs) && now > dueMs;

    if (o.resolution === "verified") {
      state = "recovering";
      drivers.push({
        code: "resolution_evidence_verified",
        detail: "A verified callback was observed.",
      });
    } else if (o.resolution === "possible") {
      // Possible resolution evidence ⇒ remain 'watch' pending verification.
      state = "watch";
      drivers.push({
        code: "resolution_evidence_possible",
        detail: "Possible resolution evidence — not yet verified.",
      });
      risks.push("Resolution is unverified — confirm the callback actually happened.");
    } else if (!overdue) {
      state = "watch";
      drivers.push({
        code: "callback_due_soon",
        detail: "Callback is open and within the due window.",
      });
    } else {
      // Overdue.
      const repeated = o.repeatContactCount >= cfg.criticalOnRepeatCount;
      if (repeated) {
        state = "critical";
        drivers.push({ code: "callback_overdue", detail: "Callback is overdue." });
        drivers.push({
          code: "repeated_contact_same_obligation",
          detail: `Customer has made contact ${o.repeatContactCount} times about this obligation.`,
        });
        risks.push("Overdue and repeated contact — high risk of complaint or churn.");
      } else {
        state = "at_risk";
        drivers.push({ code: "callback_overdue", detail: "Callback is overdue." });
        risks.push("Callback is overdue.");
      }
    }
  }

  // Freshness + ambiguity temper confidence; stale never inflates it.
  if (fresh.label === "stale") confidence = Math.min(confidence, 0.5);
  if (fresh.label === "aging") confidence = Math.min(confidence, 0.7);
  if (o.ambiguity > 0.4) {
    confidence = Math.min(confidence, 0.6);
    if (!drivers.some((d) => d.code === "uncertainty")) {
      drivers.push({ code: "uncertainty", detail: "Ambiguous evidence lowers confidence." });
    }
  }
  confidence = Math.max(0.2, Math.min(0.95, confidence));

  const prev = input.priorState ?? null;
  const trend = trendFrom(prev, state);
  const changed: Record<string, unknown> =
    prev && prev !== state ? { state: { from: prev, to: state } } : {};

  return {
    state,
    trend,
    drivers,
    risks,
    opportunities,
    confidence,
    freshness: fresh.label,
    evidence,
    changed,
  };
}

// ── Aggregate Customer Health (across ALL live obligations for one subject). ─
// The single-obligation evaluator above answers "how is THIS callback?"; the live
// Command Centre needs "how is this CUSTOMER?" — which must consider every open
// callback proposal, never let the last-processed obligation overwrite the truth of
// older open ones, and never mark a customer recovering while another callback is
// still open. Pure and deterministic (injected clock, no DB).
export interface AggregateObligation {
  /** Stable id (proposal id / group_key) — used only for per-obligation driver detail. */
  ref: string;
  /** true while the callback is still owed (not resolved, not rejected/superseded). */
  open: boolean;
  resolution: "none" | "possible" | "verified";
  candidateAt: string | null;
  dueAt: string | null;
  repeatContactCount: number;
  newestEvidenceAt: string | null;
  ambiguity: number;
}

export function evaluateAggregateCustomerHealth(input: {
  obligations: AggregateObligation[];
  policy?: Partial<CallbackPolicyConfig>;
  priorState?: HealthState | null;
  nowMs: number;
  /** Hours a customer stays 'recovering' after the last resolution before reading 'healthy'. */
  recoveryStableHours?: number;
  extraEvidence?: EvidenceItem[];
}): HealthReading {
  const cfg: CallbackPolicyConfig = { ...DEFAULT_CALLBACK_POLICY, ...(input.policy ?? {}) };
  const now = input.nowMs;
  const recoveryStableHours = input.recoveryStableHours ?? 24;
  const obligations = input.obligations ?? [];

  const drivers: Driver[] = [];
  const risks: string[] = [];
  const opportunities: string[] = [];
  const evidence: EvidenceItem[] = [...(input.extraEvidence ?? [])];

  const openObligs = obligations.filter((o) => o.open && o.resolution !== "verified");
  const resolvedObligs = obligations.filter((o) => o.resolution === "verified" || !o.open);

  // Freshest evidence across ALL obligations drives freshness/confidence.
  const newestAll =
    obligations
      .map((o) => o.newestEvidenceAt)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1) ?? null;
  const fresh = freshnessOf(newestAll, now, cfg.staleAfterHours);

  let state: HealthState;
  let confidence: number;

  if (openObligs.length > 0) {
    // Any open callback ⇒ the customer's health is driven by the WORST open obligation.
    // Resolving one obligation never hides another that is still open.
    let worst: HealthReading | null = null;
    for (const o of openObligs) {
      const reading = evaluateCallbackHealth({
        obligation: {
          hasOpenCallback: true,
          candidateAt: o.candidateAt,
          dueAt: o.dueAt,
          repeatContactCount: o.repeatContactCount,
          resolution: o.resolution,
          newestEvidenceAt: o.newestEvidenceAt,
          ambiguity: o.ambiguity,
        },
        policy: cfg,
        nowMs: now,
      });
      // Fold this obligation's drivers/risks in, tagged by ref.
      for (const d of reading.drivers)
        drivers.push({ code: d.code, detail: `[${o.ref}] ${d.detail}` });
      for (const r of reading.risks) risks.push(r);
      if (!worst || CONCERN[reading.state] > CONCERN[worst.state]) worst = reading;
    }
    state = worst!.state;
    confidence = worst!.confidence;
    if (openObligs.length > 1) {
      drivers.unshift({
        code: "multiple_open_obligations",
        detail: `${openObligs.length} open callback obligations — health reflects the most at-risk.`,
      });
    }
  } else if (resolvedObligs.length > 0) {
    // Every obligation resolved. Recovering until a stable window passes, then healthy.
    const newestResolution =
      resolvedObligs
        .map((o) => o.newestEvidenceAt)
        .filter((x): x is string => !!x)
        .sort()
        .at(-1) ?? null;
    const ageH = newestResolution ? (now - Date.parse(newestResolution)) / HOUR_MS : null;
    if (ageH != null && Number.isFinite(ageH) && ageH >= recoveryStableHours) {
      state = "healthy";
      drivers.push({
        code: "no_open_callback",
        detail: "All callbacks resolved and stable — no open obligation.",
      });
    } else {
      state = "recovering";
      drivers.push({
        code: "resolution_evidence_verified",
        detail: `${resolvedObligs.length} callback${resolvedObligs.length > 1 ? "s" : ""} resolved — confirming recovery.`,
      });
      opportunities.push("Confirm the customer is satisfied and close the loop.");
    }
    confidence = 0.85;
  } else {
    // No obligations at all. Absence of evidence is UNKNOWN, never assumed healthy.
    state = "unknown";
    drivers.push({
      code: "no_open_callback",
      detail: "No callback obligations on record for this customer.",
    });
    confidence = 0.4;
  }

  // Freshness tempers confidence; stale never inflates it.
  if (fresh.label === "stale") confidence = Math.min(confidence, 0.5);
  if (fresh.label === "aging") confidence = Math.min(confidence, 0.7);
  confidence = Math.max(0.2, Math.min(0.95, confidence));

  const prev = input.priorState ?? null;
  const trend = trendFrom(prev, state);
  const changed: Record<string, unknown> =
    prev && prev !== state ? { state: { from: prev, to: state } } : {};

  return {
    state,
    trend,
    drivers,
    risks,
    opportunities,
    confidence,
    freshness: fresh.label,
    evidence,
    changed,
  };
}

// ── Resolution-evidence matching. ───────────────────────────────────────────
// A later interaction is POSSIBLE resolution evidence only when it plausibly matches
// the obligation; it is VERIFIED only when content/authority establishes the callback
// occurred. An outbound interaction happening later is NEVER, by itself, "resolved".
export function matchResolutionEvidence(input: {
  obligation: {
    candidateAt: string | null;
    endpoint: string | null; // the customer's phone/email the obligation concerns
    threadId?: string | null;
    subjectRef?: string | null; // person/company the obligation concerns
  };
  later: CommunicationInput & {
    threadId?: string | null;
    endpoint?: string | null;
    contentSaysCalled?: boolean;
  };
  windowHours?: number;
  nowMs: number;
}): ResolutionMatch {
  const windowHours = input.windowHours ?? 72;
  const reasons: string[] = [];
  const matchedOn: string[] = [];
  const l = input.later;

  const laterAt = l.occurredAt ? Date.parse(l.occurredAt) : NaN;
  const candAt = input.obligation.candidateAt ? Date.parse(input.obligation.candidateAt) : NaN;

  // Must be AFTER the obligation and within the window.
  if (!Number.isFinite(laterAt) || !Number.isFinite(candAt) || laterAt < candAt) {
    return {
      verdict: "none",
      reasons: ["Later interaction is not after the obligation."],
      matchedOn,
    };
  }
  const withinWindow = laterAt - candAt <= windowHours * HOUR_MS;
  if (withinWindow) matchedOn.push("within_window");
  else reasons.push("Outside the resolution time window.");

  // Must be OUTBOUND (a return call/contact from the business).
  const outbound = (l.direction ?? "").toLowerCase() === "outbound";
  if (outbound) matchedOn.push("outbound");
  else reasons.push("Not an outbound contact.");

  // Endpoint or thread must match.
  const endpointMatch =
    !!input.obligation.endpoint &&
    !!(l.endpoint ?? l.phoneTo ?? l.fromAddress) &&
    (l.endpoint ?? l.phoneTo ?? l.fromAddress) === input.obligation.endpoint;
  const threadMatch =
    !!input.obligation.threadId && !!l.threadId && l.threadId === input.obligation.threadId;
  const subjectMatch =
    !!input.obligation.subjectRef &&
    (l.relatedPersonId === input.obligation.subjectRef ||
      l.relatedCompanyId === input.obligation.subjectRef);
  if (endpointMatch) matchedOn.push("same_endpoint");
  if (threadMatch) matchedOn.push("same_thread");
  if (subjectMatch) matchedOn.push("same_subject");

  const contextMatch = endpointMatch || threadMatch || subjectMatch;
  if (!contextMatch) reasons.push("No shared endpoint, thread or subject.");

  // Verdict.
  if (!withinWindow || !outbound || !contextMatch) {
    return { verdict: "none", reasons, matchedOn };
  }
  // Content or an explicit outcome event establishes VERIFIED; otherwise POSSIBLE.
  if (l.contentSaysCalled === true) {
    reasons.push("Content indicates the callback was made.");
    return { verdict: "verified", reasons, matchedOn };
  }
  reasons.push(
    "Outbound contact matched the obligation — possible resolution, pending verification.",
  );
  return { verdict: "possible", reasons, matchedOn };
}

// ── Subject resolution. ─────────────────────────────────────────────────────
// For the first slice: prefer a confidently-linked company, else the linked person,
// else route to needs_context. Never fabricates or duplicates a person/company; the
// caller supplies already-resolved identity refs (from the interaction / graph).
export function resolveHealthSubject(input: {
  companyId: string | null;
  companyConfidence?: number | null; // 0..1 (from identity resolution)
  personId: string | null;
  minCompanyConfidence?: number;
}): SubjectResolution {
  const minCo = input.minCompanyConfidence ?? 0.7;
  if (input.companyId && (input.companyConfidence ?? 1) >= minCo) {
    return {
      resolved: true,
      subjectType: "company",
      subjectId: input.companyId,
      reason: "Confidently linked company.",
    };
  }
  if (input.personId) {
    return {
      resolved: true,
      subjectType: "person",
      subjectId: input.personId,
      reason: input.companyId
        ? "Company link not confident enough — using the linked person."
        : "Linked person record.",
    };
  }
  return {
    resolved: false,
    subjectType: null,
    subjectId: null,
    reason: "Subject is ambiguous or absent — no Health Object created (needs_context).",
  };
}
