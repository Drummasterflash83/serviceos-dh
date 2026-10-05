// Regression proof: the tenant company mishearing ("German Teaching") is corrected before the
// summary, the raw transcript is preserved, and the summary context refuses to attribute the
// tenant company to the caller / to name an unresolved caller. Run:
//   node supabase/functions/_shared/phone_intelligence/company_correction.verify.ts
import assert from "node:assert/strict";
import { normaliseTranscript, type VocabularyEntry } from "./vocabulary.ts";
import { buildSummaryContext } from "./persist.ts";

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
    phoneticVariants: [
      "John and Teething",
      "Drummond eating",
      "German Heating",
      "German Teaching",
      "German Tutoring",
      "German Teating",
    ],
    confidence: 0.92,
    active: true,
  },
];

ok("'German Teaching' normalises to 'Drummond Heating' (applied, ≥0.6)", () => {
  const raw = "Good afternoon, you're through to German teaching. Mary speaking, how may I help?";
  const r = normaliseTranscript(raw, DRUMMOND_VOCAB, { contextTerms: ["Drummond Heating"] });
  assert.ok(r.normalised.includes("Drummond Heating"), "normalised has canonical company");
  assert.ok(!/german teaching/i.test(r.normalised), "normalised no longer contains the mishearing");
  const applied = r.corrections.find((c) => /german teaching/i.test(c.from));
  assert.ok(applied && applied.applied && applied.to === "Drummond Heating", "correction applied");
  assert.equal(r.raw, raw, "raw transcript preserved byte-for-byte");
});

ok("all German-family mishears map to the canonical company", () => {
  for (const v of ["German Heating", "German Tutoring", "German Teating"]) {
    const r = normaliseTranscript(`Hello, ${v}, good afternoon.`, DRUMMOND_VOCAB, {
      contextTerms: ["Drummond Heating"],
    });
    assert.ok(
      r.normalised.includes("Drummond Heating") && !new RegExp(v, "i").test(r.normalised),
      `${v} corrected`,
    );
  }
});

ok("legitimate speech is NOT corrupted (word-boundary, no bare 'German')", () => {
  const raw = "The customer is going to Germany next week and mentioned a German boiler brand.";
  const r = normaliseTranscript(raw, DRUMMOND_VOCAB, {});
  assert.equal(r.normalised, raw, "unrelated 'Germany'/'German' left untouched");
});

ok("summary context never attributes the tenant company to the caller", () => {
  const computed = {
    direction: { direction: "outbound", confidence: 0.9 },
    internal: { resolvedEntityId: null, displayName: null, staffRole: null, confidence: 0 },
    external: { resolvedEntityId: null, displayName: null, confidence: 0 },
    canonical: { externalNumber: "+44..." },
    identity: { hasConflict: false },
  } as never;
  const ctx = buildSummaryContext(computed, "Drummond Heating");
  assert.ok(/is OUR side/.test(ctx), "grounds tenant company as our side");
  assert.ok(/never attribute "Drummond Heating" to the person on the other end/i.test(ctx));
  assert.ok(/external party is NOT identified/i.test(ctx), "unresolved caller must not be named");
});

console.log(`\n${passed} company-correction regression assertions passed ✓`);
