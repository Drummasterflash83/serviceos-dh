// Reference proof of the provider adapter + pure orchestration core. Run:
//   node supabase/functions/_shared/phone_intelligence/persist.verify.ts
//
// Uses a realistic Sipcentric/Birchills-shaped payload. No DB, no network.

import assert from "node:assert/strict";
import { canonicaliseCall } from "./provider_adapter.ts";
import { computeCallIntelligence, type ComputeInput, type DirectoryRow } from "./persist.ts";
import type { VocabularyEntry } from "./vocabulary.ts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

// A Sipcentric-shaped OUTBOUND payload: endpoints are opaque URIs; parent≠id.
const OUT_PAYLOAD = {
  direction: "OUT",
  srcEndpoint: "https://pbx.sipcentric.com/api/v1/customers/123/endpoints/456",
  dstEndpoint: "",
  outcome: "ANSWERED",
  id: "leg-2",
  parent: "leg-1",
  uri: "https://pbx.sipcentric.com/api/v1/customers/123/calls/789",
};

const VOCAB: VocabularyEntry[] = [
  {
    term: "Drummond Heating",
    category: "org",
    aliases: ["Drummonds"],
    phoneticVariants: ["John and Teething"],
    confidence: 0.92,
    active: true,
  },
];

// 1) Provider adapter: opaque endpoint URIs are refs, NOT extensions; parent≠id ignored.
ok("adapter: Sipcentric endpoints are opaque refs, not extensions", () => {
  const c = canonicaliseCall({
    rawPayload: OUT_PAYLOAD,
    fromNumber: "01902000000",
    toNumber: "+447700900123",
  });
  assert.equal(c.provider, "sipcentric");
  assert.equal(c.providerDirection, "OUT");
  assert.ok(c.originatingEndpointRef?.startsWith("https://"), "endpoint kept as ref");
  assert.equal(c.originatingExtension, null, "URI must NOT be read as an extension");
  assert.equal(c.externalNumber, "+447700900123", "external = canonical to_number for OUT");
  assert.equal(c.transfer, "unknown", "transfer never inferred");
  assert.equal(c.providerOutcome, "answered");
});

// 2) Orchestration with a CONFIGURED endpoint→person mapping + noisy transcript.
ok("compute: configured endpoint → Liz; 'John and Teething' normalised; raw preserved", () => {
  const directory: DirectoryRow[] = [
    {
      extension: "103",
      e164Number: null,
      endpointRef: "https://pbx.sipcentric.com/api/v1/customers/123/endpoints/456",
      personId: "person-liz",
      displayName: "Liz",
      role: "Finance",
      isSharedDevice: false,
      confidence: 0.95,
      source: "configured",
    },
  ];
  const input: ComputeInput = {
    rawPayload: OUT_PAYLOAD,
    fromNumber: "01902000000",
    toNumber: "+447700900123",
    transcriptText: "hi it's Liz from John and Teething about the payment",
    transcriptQuality: 0.85,
    directory,
    vocabulary: VOCAB,
    knownPeople: [{ id: "person-liz", name: "Liz" }],
    externalMatch: {
      entityId: "person-helen",
      displayName: "Helen",
      kind: "person",
      confidence: 0.9,
      source: "interaction_linkage",
    },
    companyName: "Drummond Heating",
  };
  const r = computeCallIntelligence(input);
  assert.equal(r.direction.direction, "outbound");
  assert.equal(r.internal.resolvedEntityId, "person-liz");
  assert.ok(r.internal.confidence >= 0.95);
  assert.equal(r.external.resolvedEntityId, "person-helen");
  // normalisation applied but RAW preserved
  assert.equal(r.normalisation!.raw, input.transcriptText);
  assert.ok(r.normalisation!.normalised.includes("Drummond Heating"));
  assert.ok(!r.normalisation!.normalised.includes("John and Teething"));
  assert.equal(r.identitySummary.has_conflict, false);
});

// 3) Real current state: NO directory → internal unknown, but external + normalisation still work.
ok("compute: no directory → internal unknown (honest), external still resolves", () => {
  const input: ComputeInput = {
    rawPayload: OUT_PAYLOAD,
    fromNumber: "01902000000",
    toNumber: "+447700900123",
    transcriptText: "calling from Drummonds about a boiler",
    directory: [], // unconfigured — the real current state
    vocabulary: VOCAB,
    knownPeople: [],
    externalMatch: {
      entityId: "person-helen",
      displayName: "Helen",
      kind: "person",
      confidence: 0.85,
      source: "interaction_linkage",
    },
    companyName: "Drummond Heating",
  };
  const r = computeCallIntelligence(input);
  assert.equal(r.internal.resolvedEntityId, null, "no fabricated internal identity");
  assert.equal(r.external.resolvedEntityId, "person-helen");
  assert.ok(r.normalisation!.normalised.includes("Drummond Heating")); // "Drummonds" alias
  assert.ok(r.identity.unresolved.includes("internal_participant"));
});

// 4) Determinism / idempotency — identical output for identical input.
ok("compute is deterministic (safe re-processing)", () => {
  const input: ComputeInput = {
    rawPayload: OUT_PAYLOAD,
    fromNumber: "01902000000",
    toNumber: "+447700900123",
    transcriptText: "it's Liz from John and Teething",
    directory: [],
    vocabulary: VOCAB,
    knownPeople: [],
    externalMatch: null,
    companyName: "Drummond Heating",
  };
  assert.deepEqual(computeCallIntelligence(input), computeCallIntelligence(input));
});

console.log(`\n${passed} adapter/orchestration assertions passed ✓`);
