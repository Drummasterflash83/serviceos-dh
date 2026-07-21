// Reference proof of the pure deterministic call-direction classifier. Run:
//   node supabase/functions/_shared/phone_intelligence/direction.verify.ts
//
// Fixtures mirror the audited Simwood shape. No network, no DB, no transcript — the
// classifier must decide direction from provider metadata ALONE.

import assert from "node:assert/strict";
import { classifyCallDirection } from "./direction.ts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

// 1) Outbound from extension 103 to an external number → outbound, ext=103, high conf.
ok("outbound: ext 103 → external, high confidence", () => {
  const r = classifyCallDirection({
    rawPayload: {
      direction: "OUT",
      srcEndpoint: "103",
      to: "+441902000000",
      outcome: "ANSWERED",
      id: "call-1",
      parent: "call-1",
      scope: "EXTERNAL",
    },
    internalExtensions: ["103"],
  });
  assert.equal(r.direction, "outbound");
  assert.equal(r.originatingExtension, "103");
  assert.equal(r.externalPartyNumber, "+441902000000");
  assert.ok(r.confidence >= 0.9, `confidence ${r.confidence}`);
  assert.equal(r.providerDirection, "OUT");
});

// 2) Inbound answered → inbound, answering extension resolved.
ok("inbound: external → ext 200 answered", () => {
  const r = classifyCallDirection({
    rawPayload: {
      direction: "IN",
      from: "+447700900123",
      dstEndpoint: "200",
      outcome: "ANSWERED",
      id: "c2",
      parent: "c2",
    },
    internalExtensions: ["200"],
  });
  assert.equal(r.direction, "inbound");
  assert.equal(r.answeringExtension, "200");
  assert.equal(r.externalPartyNumber, "+447700900123");
  assert.ok(r.confidence >= 0.9);
});

// 3) Inbound unanswered → missed.
ok("inbound NO_ANSWER → missed", () => {
  const r = classifyCallDirection({
    rawPayload: {
      direction: "IN",
      from: "+447700900123",
      dstEndpoint: "200",
      outcome: "NO_ANSWER",
    },
    internalExtensions: ["200"],
  });
  assert.equal(r.direction, "missed");
});

// 4) Transfer leg (parent ≠ id) → transferred.
ok("transferred leg → transferred", () => {
  const r = classifyCallDirection({
    rawPayload: {
      direction: "IN",
      srcEndpoint: "200",
      dstEndpoint: "103",
      id: "leg-2",
      parent: "leg-1",
      outcome: "ANSWERED",
    },
    internalExtensions: ["200", "103"],
  });
  assert.equal(r.direction, "transferred");
  assert.equal(r.transferredFromExtension, "200");
  assert.equal(r.transferredToExtension, "103");
});

// 5) No metadata → unknown with zero confidence (never a guess).
ok("empty payload → unknown, confidence 0", () => {
  const r = classifyCallDirection({ rawPayload: {} });
  assert.equal(r.direction, "unknown");
  assert.equal(r.confidence, 0);
});

// 6) Direction is NEVER taken from transcript text.
ok("transcript text is ignored for direction", () => {
  const r = classifyCallDirection({
    // no provider direction; a transcript-like field must not sway it
    rawPayload: { transcript: "I am calling you back", srcEndpoint: "+441902111222" } as Record<
      string,
      unknown
    >,
  });
  assert.equal(r.direction, "unknown");
});

console.log(`\n${passed} direction-classifier assertions passed ✓`);
