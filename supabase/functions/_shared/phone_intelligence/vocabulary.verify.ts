// Reference proof of tenant transcript normalisation. Run:
//   node supabase/functions/_shared/phone_intelligence/vocabulary.verify.ts
//
// Pure, deterministic fixtures — the Drummond ASR scenarios. Raw is always preserved.

import assert from "node:assert/strict";
import { normaliseTranscript, type VocabularyEntry } from "./vocabulary.ts";

let passed = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

const DRUMMOND_VOCAB: VocabularyEntry[] = [
  {
    term: "Drummond Heating",
    category: "org",
    aliases: ["Drummonds"],
    phoneticVariants: ["John and Teething", "Drummond eating"],
    confidence: 0.92,
    active: true,
  },
  {
    term: "Commusoft",
    category: "service",
    aliases: [],
    phoneticVariants: ["Comue soft"],
    confidence: 0.85,
    active: true,
  },
];

// 1) Flagship ASR correction — raw preserved, evidenced, context-corroborated.
ok("'John and Teething' → 'Drummond Heating', raw preserved + evidenced", () => {
  const raw = "Liz from John and Teething discussed the payment";
  const res = normaliseTranscript(raw, DRUMMOND_VOCAB, { contextTerms: ["Drummond Heating"] });
  assert.equal(res.raw, raw, "raw must be unchanged");
  assert.equal(res.normalised, "Liz from Drummond Heating discussed the payment");
  const c = res.corrections.find((x) => x.to === "Drummond Heating");
  assert.ok(c && c.applied, "correction applied");
  assert.ok(c!.confidence >= 0.9, `confidence ${c!.confidence}`); // phonetic penalty + context
  assert.ok(c!.evidence.some((e) => e.includes("context_corroboration")));
});

// 2) Raw preservation — byte-for-byte unchanged across multiple corrections.
ok("raw transcript is byte-for-byte unchanged", () => {
  const raw = "hi it's Liz from Drummonds, using Comue soft today";
  const res = normaliseTranscript(raw, DRUMMOND_VOCAB);
  assert.equal(res.raw, raw);
  assert.ok(res.normalised.includes("Drummond Heating") && res.normalised.includes("Commusoft"));
});

// 3) Idempotency / determinism — safe re-processing.
ok("normalisation is idempotent/deterministic", () => {
  const raw = "Liz from John and Teething";
  assert.deepEqual(
    normaliseTranscript(raw, DRUMMOND_VOCAB),
    normaliseTranscript(raw, DRUMMOND_VOCAB),
  );
});

// 4) Low-confidence correction is a SUGGESTION, not a silent edit.
ok("low-confidence correction is suggested, not applied", () => {
  const vocab: VocabularyEntry[] = [
    {
      term: "Rheem",
      category: "equipment",
      aliases: [],
      phoneticVariants: ["ream"],
      confidence: 0.4,
      active: true,
    },
  ];
  const res = normaliseTranscript("we fitted a ream boiler", vocab, { minConfidence: 0.6 });
  const c = res.corrections.find((x) => x.to === "Rheem");
  assert.ok(c && !c.applied, "should be a suggestion");
  assert.equal(res.normalised, "we fitted a ream boiler", "raw text kept when not applied");
});

// 5) Tenant isolation — another tenant's (empty) vocabulary changes nothing.
ok("tenant isolation: no vocab → no corrections", () => {
  const raw = "Liz from John and Teething";
  const res = normaliseTranscript(raw, []);
  assert.equal(res.normalised, raw);
  assert.equal(res.corrections.length, 0);
});

console.log(`\n${passed} normalisation assertions passed ✓`);
