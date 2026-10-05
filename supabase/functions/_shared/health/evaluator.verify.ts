// Run: node supabase/functions/_shared/health/evaluator.verify.ts
import assert from "node:assert/strict";
import {
  type AggregateObligation,
  evaluateAggregateCustomerHealth,
  evaluateCallbackHealth,
  matchResolutionEvidence,
  resolveHealthSubject,
} from "./evaluator.ts";
import type { ObligationState } from "./types.ts";

let failed = 0;
function ok(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${(e as Error).message}`);
  }
}

const NOW = Date.parse("2026-07-22T12:00:00Z");
const HOUR = 3_600_000;
function obligation(over: Partial<ObligationState>): ObligationState {
  return {
    hasOpenCallback: true,
    candidateAt: new Date(NOW - HOUR).toISOString(),
    dueAt: new Date(NOW + HOUR).toISOString(),
    repeatContactCount: 1,
    resolution: "none",
    newestEvidenceAt: new Date(NOW - HOUR).toISOString(),
    ambiguity: 0.1,
    ...over,
  };
}
const hasDriver = (r: { drivers: { code: string }[] }, code: string) =>
  r.drivers.some((d) => d.code === code);

// ── Health policy behaviour (spec §7). ──────────────────────────────────────
ok("no open callback + fresh UNAMBIGUOUS evidence → healthy", () => {
  const r = evaluateCallbackHealth({
    obligation: obligation({ hasOpenCallback: false }),
    nowMs: NOW,
  });
  assert.equal(r.state, "healthy");
  assert.ok(hasDriver(r, "no_open_callback"));
});

ok("UNCERTAIN evidence → unknown, never healthy (absence of evidence is not health)", () => {
  const r = evaluateCallbackHealth({
    obligation: obligation({ hasOpenCallback: false, ambiguity: 0.8 }),
    nowMs: NOW,
  });
  assert.equal(r.state, "unknown");
  assert.ok(hasDriver(r, "uncertainty"));
  assert.ok(r.confidence < 0.5, `confidence ${r.confidence} should be reduced`);
  const uncertaintyDrivers = r.drivers.filter((d) => d.code === "uncertainty");
  assert.equal(uncertaintyDrivers.length, 1, "exactly one uncertainty driver");
});

ok("no open callback + no/stale evidence → unknown (stale never healthy)", () => {
  const r = evaluateCallbackHealth({
    obligation: obligation({
      hasOpenCallback: false,
      newestEvidenceAt: new Date(NOW - 400 * HOUR).toISOString(),
    }),
    nowMs: NOW,
  });
  assert.equal(r.state, "unknown");
});

ok("open within due → watch", () => {
  const r = evaluateCallbackHealth({ obligation: obligation({}), nowMs: NOW });
  assert.equal(r.state, "watch");
  assert.ok(hasDriver(r, "explicit_callback_open"));
  assert.ok(hasDriver(r, "callback_due_soon"));
});

ok("overdue → at_risk", () => {
  const r = evaluateCallbackHealth({
    obligation: obligation({ dueAt: new Date(NOW - HOUR).toISOString(), repeatContactCount: 1 }),
    nowMs: NOW,
  });
  assert.equal(r.state, "at_risk");
  assert.ok(hasDriver(r, "callback_overdue"));
});

ok("overdue + repeated → critical", () => {
  const r = evaluateCallbackHealth({
    obligation: obligation({ dueAt: new Date(NOW - HOUR).toISOString(), repeatContactCount: 3 }),
    policy: { criticalOnRepeatCount: 2 },
    nowMs: NOW,
  });
  assert.equal(r.state, "critical");
  assert.ok(hasDriver(r, "repeated_contact_same_obligation"));
});

ok("possible resolution → remains watch (pending verification)", () => {
  const r = evaluateCallbackHealth({
    obligation: obligation({ dueAt: new Date(NOW - HOUR).toISOString(), resolution: "possible" }),
    nowMs: NOW,
  });
  assert.equal(r.state, "watch");
  assert.ok(hasDriver(r, "resolution_evidence_possible"));
});

ok("verified resolution → recovering", () => {
  const r = evaluateCallbackHealth({
    obligation: obligation({ resolution: "verified" }),
    nowMs: NOW,
  });
  assert.equal(r.state, "recovering");
  assert.ok(hasDriver(r, "resolution_evidence_verified"));
});

ok("trend computed vs prior state", () => {
  const worse = evaluateCallbackHealth({
    obligation: obligation({ dueAt: new Date(NOW - HOUR).toISOString() }),
    priorState: "watch",
    nowMs: NOW,
  });
  assert.equal(worse.trend, "worsening");
  const better = evaluateCallbackHealth({
    obligation: obligation({ resolution: "verified" }),
    priorState: "at_risk",
    nowMs: NOW,
  });
  assert.equal(better.trend, "improving");
});

ok("ambiguity lowers confidence + adds uncertainty driver", () => {
  const r = evaluateCallbackHealth({ obligation: obligation({ ambiguity: 0.8 }), nowMs: NOW });
  assert.ok(r.confidence <= 0.6);
  assert.ok(hasDriver(r, "uncertainty"));
});

ok("deterministic", () => {
  const o = obligation({});
  assert.deepEqual(
    evaluateCallbackHealth({ obligation: o, nowMs: NOW }),
    evaluateCallbackHealth({ obligation: o, nowMs: NOW }),
  );
});

// ── Aggregate Customer Health (Phase 13 — across all obligations). ──────────
function oblig(over: Partial<AggregateObligation>): AggregateObligation {
  return {
    ref: "p1",
    open: true,
    resolution: "none",
    candidateAt: new Date(NOW - HOUR).toISOString(),
    dueAt: new Date(NOW + HOUR).toISOString(),
    repeatContactCount: 1,
    newestEvidenceAt: new Date(NOW - HOUR).toISOString(),
    ambiguity: 0.1,
    ...over,
  };
}

ok("AGG: no obligations → unknown (absence of evidence is not health)", () => {
  const r = evaluateAggregateCustomerHealth({ obligations: [], nowMs: NOW });
  assert.equal(r.state, "unknown");
});

ok("AGG: one open in-time callback → watch", () => {
  const r = evaluateAggregateCustomerHealth({ obligations: [oblig({})], nowMs: NOW });
  assert.equal(r.state, "watch");
});

ok("AGG: one overdue callback → at_risk", () => {
  const r = evaluateAggregateCustomerHealth({
    obligations: [oblig({ dueAt: new Date(NOW - HOUR).toISOString() })],
    nowMs: NOW,
  });
  assert.equal(r.state, "at_risk");
});

ok("AGG: overdue + repeated → critical", () => {
  const r = evaluateAggregateCustomerHealth({
    obligations: [oblig({ dueAt: new Date(NOW - HOUR).toISOString(), repeatContactCount: 3 })],
    policy: { criticalOnRepeatCount: 2 },
    nowMs: NOW,
  });
  assert.equal(r.state, "critical");
});

ok("AGG: one resolved + one OPEN overdue → driven by the remaining risk (NOT recovering)", () => {
  const r = evaluateAggregateCustomerHealth({
    obligations: [
      oblig({ ref: "resolved", open: false, resolution: "verified" }),
      oblig({ ref: "open", dueAt: new Date(NOW - HOUR).toISOString() }),
    ],
    nowMs: NOW,
  });
  assert.equal(r.state, "at_risk");
  assert.ok(!hasDriver(r, "resolution_evidence_verified"), "must not read as recovered");
});

ok("AGG: two open (watch + critical) → worst drives + multiple-obligations driver", () => {
  const r = evaluateAggregateCustomerHealth({
    obligations: [
      oblig({ ref: "a" }),
      oblig({
        ref: "b",
        dueAt: new Date(NOW - HOUR).toISOString(),
        repeatContactCount: 3,
      }),
    ],
    policy: { criticalOnRepeatCount: 2 },
    nowMs: NOW,
  });
  assert.equal(r.state, "critical");
  assert.ok(hasDriver(r, "multiple_open_obligations"));
});

ok("AGG: all resolved recently → recovering", () => {
  const r = evaluateAggregateCustomerHealth({
    obligations: [
      oblig({
        open: false,
        resolution: "verified",
        newestEvidenceAt: new Date(NOW - HOUR).toISOString(),
      }),
    ],
    nowMs: NOW,
  });
  assert.equal(r.state, "recovering");
});

ok("AGG: all resolved and stable (past window) → healthy", () => {
  const r = evaluateAggregateCustomerHealth({
    obligations: [
      oblig({
        open: false,
        resolution: "verified",
        newestEvidenceAt: new Date(NOW - 48 * HOUR).toISOString(),
      }),
    ],
    recoveryStableHours: 24,
    nowMs: NOW,
  });
  assert.equal(r.state, "healthy");
});

ok("AGG: trend improving when prior worse than aggregate", () => {
  const r = evaluateAggregateCustomerHealth({
    obligations: [oblig({ open: false, resolution: "verified" })],
    priorState: "at_risk",
    nowMs: NOW,
  });
  assert.equal(r.trend, "improving");
});

ok("AGG: deterministic", () => {
  const os = [oblig({}), oblig({ ref: "b", dueAt: new Date(NOW - HOUR).toISOString() })];
  assert.deepEqual(
    evaluateAggregateCustomerHealth({ obligations: os, nowMs: NOW }),
    evaluateAggregateCustomerHealth({ obligations: os, nowMs: NOW }),
  );
});

// ── Resolution matching. ────────────────────────────────────────────────────
ok("later outbound to same endpoint in window → possible (NOT verified)", () => {
  const m = matchResolutionEvidence({
    obligation: {
      candidateAt: new Date(NOW - 2 * HOUR).toISOString(),
      endpoint: "+440000000001",
      subjectRef: "p1",
    },
    later: {
      interactionId: "i2",
      interactionType: "phone_call",
      direction: "outbound",
      occurredAt: new Date(NOW - HOUR).toISOString(),
      fromName: null,
      fromAddress: null,
      phoneFrom: null,
      phoneTo: "+440000000001",
      subject: null,
      summary: "called back",
      bodyPreview: null,
    },
    nowMs: NOW,
  });
  assert.equal(m.verdict, "possible");
});

ok("content saying called → verified", () => {
  const m = matchResolutionEvidence({
    obligation: { candidateAt: new Date(NOW - 2 * HOUR).toISOString(), endpoint: "+440000000001" },
    later: {
      interactionId: "i2",
      interactionType: "phone_call",
      direction: "outbound",
      occurredAt: new Date(NOW - HOUR).toISOString(),
      fromName: null,
      fromAddress: null,
      phoneFrom: null,
      phoneTo: "+440000000001",
      subject: null,
      summary: "spoke to customer, resolved",
      bodyPreview: null,
      contentSaysCalled: true,
    } as never,
    nowMs: NOW,
  });
  assert.equal(m.verdict, "verified");
});

ok("mere later inbound (not outbound) → none", () => {
  const m = matchResolutionEvidence({
    obligation: { candidateAt: new Date(NOW - 2 * HOUR).toISOString(), endpoint: "+440000000001" },
    later: {
      interactionId: "i2",
      interactionType: "phone_call",
      direction: "inbound",
      occurredAt: new Date(NOW - HOUR).toISOString(),
      fromName: null,
      fromAddress: null,
      phoneFrom: "+440000000001",
      phoneTo: null,
      subject: null,
      summary: "called again",
      bodyPreview: null,
    },
    nowMs: NOW,
  });
  assert.equal(m.verdict, "none");
});

// ── Subject resolution. ─────────────────────────────────────────────────────
ok("confident company preferred", () => {
  const s = resolveHealthSubject({ companyId: "c1", companyConfidence: 0.9, personId: "p1" });
  assert.equal(s.subjectType, "company");
});
ok("low-confidence company falls back to person", () => {
  const s = resolveHealthSubject({ companyId: "c1", companyConfidence: 0.4, personId: "p1" });
  assert.equal(s.subjectType, "person");
});
ok("no ids → unresolved (needs_context)", () => {
  const s = resolveHealthSubject({ companyId: null, personId: null });
  assert.equal(s.resolved, false);
});

console.log(
  failed === 0 ? "\nevaluator.verify: ALL PASSED" : `\nevaluator.verify: ${failed} FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
