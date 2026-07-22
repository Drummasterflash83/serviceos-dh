// Run: node supabase/functions/_shared/health/pipeline.verify.ts
// Pure shadow pipeline + shadow-safety invariants. No DB.
import assert from "node:assert/strict";
import { runShadowPipeline, topicToken, type ShadowContext } from "./pipeline.ts";
import { SHADOW_WRITE_ALLOWLIST } from "./shadow_safety.ts";
import type { CommunicationInput } from "./types.ts";

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
function comm(over: Partial<CommunicationInput>): CommunicationInput {
  return {
    interactionId: "i1",
    interactionType: "phone_call",
    direction: "inbound",
    occurredAt: "2026-07-22T09:00:00Z",
    fromName: "Cust",
    fromAddress: null,
    phoneFrom: "+440000000001",
    phoneTo: "+441111110000",
    subject: null,
    summary: "Please call me back about the boiler service.",
    bodyPreview: null,
    ...over,
  };
}
function ctx(over: Partial<ShadowContext> = {}): ShadowContext {
  return {
    tenantId: "tenant-A",
    policyVersionId: "pv1",
    policyPublished: true,
    sourceAllowlistEnabled: true,
    allowedSources: ["phone_call", "email_message"],
    policy: {},
    ownershipMaps: {
      queue: {},
      fallback_role: { responsibility: "role:coordinator", label: "Coordinator" },
    },
    companyId: null,
    companyConfidence: null,
    personId: "p1",
    priorState: null,
    nowMs: NOW,
    ...over,
  };
}
const allow = new Set<string>(SHADOW_WRITE_ALLOWLIST);
const withinAllow = (tables: string[]) => tables.every((t) => allow.has(t));

// ── SHADOW SAFETY: every outcome writes only allowlisted tables. ────────────
ok("candidate: writes only health_* tables, shadow-safe", () => {
  const r = runShadowPipeline({ communication: comm({}), ctx: ctx() });
  assert.equal(r.outcome, "candidate_proposed");
  assert.ok(r.shadowSafety.safe, `offending: ${r.shadowSafety.offending}`);
  assert.ok(withinAllow(r.writeTables));
  // No forbidden table ever appears.
  assert.ok(!r.writeTables.includes("intelligence_objects"));
  assert.ok(!r.writeTables.includes("automation_intents"));
  assert.ok(!r.writeTables.includes("outcomes"));
  assert.ok(!r.writeTables.includes("review_tasks"));
  assert.ok(r.proposal && r.proposal.mode === "shadow");
  assert.ok(r.assessment && r.assessment.mode === "shadow");
});

ok("excluded: NO writes at all", () => {
  const r = runShadowPipeline({
    communication: comm({ summary: "Missed call, line dropped.", disposition: "missed" }),
    ctx: ctx(),
  });
  assert.equal(r.outcome, "excluded");
  assert.deepEqual(r.writeTables, []);
  assert.equal(r.healthObject, null);
  assert.equal(r.proposal, null);
  assert.ok(r.shadowSafety.safe);
});

ok("unpublished policy: skipped, NO writes", () => {
  const r = runShadowPipeline({ communication: comm({}), ctx: ctx({ policyPublished: false }) });
  assert.equal(r.outcome, "skipped_unpublished");
  assert.deepEqual(r.writeTables, []);
});

// ── Source boundary: DEFAULT DENY. ──────────────────────────────────────────
ok("source allowlist disabled: skipped, NO writes", () => {
  const r = runShadowPipeline({
    communication: comm({}),
    ctx: ctx({ sourceAllowlistEnabled: false }),
  });
  assert.equal(r.outcome, "skipped_source_boundary_disabled");
  assert.deepEqual(r.writeTables, []);
  assert.equal(r.healthObject, null);
  assert.equal(r.proposal, null);
});

ok("source not in allowlist: skipped, NO writes", () => {
  const r = runShadowPipeline({
    communication: comm({}),
    ctx: ctx({ allowedSources: ["email_message"] }),
  });
  assert.equal(r.outcome, "skipped_source_not_allowed");
  assert.deepEqual(r.writeTables, []);
});

ok("EMPTY allowed-sources list fails closed (missing config is never permissive)", () => {
  const r = runShadowPipeline({
    communication: comm({}),
    ctx: ctx({ allowedSources: [] }),
  });
  assert.equal(r.outcome, "skipped_source_not_allowed");
  assert.deepEqual(r.writeTables, []);
});

ok("unknown channel fails closed", () => {
  const r = runShadowPipeline({
    communication: comm({ interactionType: null }),
    ctx: ctx(),
  });
  assert.equal(r.outcome, "skipped_source_not_allowed");
  assert.deepEqual(r.writeTables, []);
});

ok("ambiguous subject: needs_context, NO Health Object, NO proposal", () => {
  const r = runShadowPipeline({
    communication: comm({}),
    ctx: ctx({ personId: null, companyId: null }),
  });
  assert.equal(r.outcome, "needs_context");
  assert.equal(r.healthObject, null);
  assert.equal(r.proposal, null);
  assert.deepEqual(r.writeTables, []);
});

ok("uncertain intent: subject + UNKNOWN assessment, NO proposal, plan == exact writes", () => {
  const r = runShadowPipeline({
    communication: comm({ summary: "left message", disposition: "voicemail" }),
    ctx: ctx(),
  });
  assert.equal(r.outcome, "needs_context");
  assert.ok(r.healthObject);
  assert.ok(r.assessment);
  // Uncertain evidence must NEVER read as healthy — absence of evidence is unknown.
  assert.equal(r.assessment!.state, "unknown");
  assert.ok(r.assessment!.drivers.some((d) => d.code === "uncertainty"));
  assert.ok(r.assessment!.confidence < 0.5, "reduced confidence");
  // The assessment's own evidence explains what could not be established.
  assert.ok(r.assessment!.evidence.some((e) => e.source === "classifier"));
  assert.equal(r.proposal, null);
  // Declared write plan is EXACTLY what the store executes: no proposal, no sources.
  assert.deepEqual(r.writeTables, ["health_objects", "health_assessments"]);
  assert.deepEqual(r.sources, []);
  assert.ok(r.shadowSafety.safe);
});

// ── Grouping / dedup identity. ──────────────────────────────────────────────
ok("same subject + same topic → same group_key (folds)", () => {
  const a = runShadowPipeline({
    communication: comm({ interactionId: "iA", summary: "call me back about the quote" }),
    ctx: ctx(),
  });
  const b = runShadowPipeline({
    communication: comm({ interactionId: "iB", summary: "chasing a callback on my quote" }),
    ctx: ctx(),
  });
  assert.equal(a.groupKey, b.groupKey);
});

ok("same subject + different obligation → different group_key (stays separate)", () => {
  const a = runShadowPipeline({
    communication: comm({ summary: "call me back about the quote" }),
    ctx: ctx(),
  });
  const b = runShadowPipeline({
    communication: comm({ summary: "please call me back to book an appointment" }),
    ctx: ctx(),
  });
  assert.notEqual(a.groupKey, b.groupKey);
});

ok("different subject → different group_key", () => {
  const a = runShadowPipeline({ communication: comm({}), ctx: ctx({ personId: "p1" }) });
  const b = runShadowPipeline({ communication: comm({}), ctx: ctx({ personId: "p2" }) });
  assert.notEqual(a.groupKey, b.groupKey);
});

ok("assessment input_hash is deterministic + present", () => {
  const a = runShadowPipeline({ communication: comm({}), ctx: ctx() });
  const b = runShadowPipeline({ communication: comm({}), ctx: ctx() });
  assert.ok(a.assessment?.input_hash);
  assert.equal(a.assessment?.input_hash, b.assessment?.input_hash);
});

ok("topicToken deterministic + separable", () => {
  assert.equal(topicToken("about the quote"), "quote");
  assert.equal(topicToken("book an appointment"), "booking");
  assert.notEqual(topicToken("about the quote"), topicToken("book an appointment"));
});

console.log(failed === 0 ? "\npipeline.verify: ALL PASSED" : `\npipeline.verify: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
