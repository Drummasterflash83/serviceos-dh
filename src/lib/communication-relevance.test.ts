import test from "node:test";
import assert from "node:assert/strict";
import { communicationRelevanceForTenant } from "./communication-relevance.ts";
const report = {
  tenantId: "a",
  classificationScope: "historical_eligibility_consensus",
  generatedAt: "2026-10-13T00:00:00Z",
  totalCommunications: 3,
  ledgerRecords: 4,
  reprocessedCommunications: 1,
  conflictingCommunications: 1,
  byClass: { unknown: 1, operational_customer: 1, marketing_newsletter: 1 },
  byRelevance: { relevant: 1, not_relevant: 1, uncertain: 1 },
  exclusion: {
    noiseInteractions: 1,
    intelligenceObjectsExcluded: 0,
    recommendationsExcluded: 1,
    recommendationsOpenExcluded: 0,
  },
  caveat: "Historical decisions only.",
};
test("accepts complete tenant-bound report, rejecting other tenant and old counting semantics", () => {
  assert.equal(communicationRelevanceForTenant(report, "a"), report);
  assert.equal(communicationRelevanceForTenant(report, "b"), null);
  assert.equal(
    communicationRelevanceForTenant({ ...report, classificationScope: undefined }, "a"),
    null,
  );
});
test("rejects missing or contradictory counts rather than displaying false zeros", () => {
  for (const patch of [
    { totalCommunications: 4 },
    { ledgerRecords: 2 },
    { reprocessedCommunications: 0 },
    { byClass: null },
    { exclusion: {} },
    { byRelevance: { relevant: 3 } },
    { conflictingCommunications: -1 },
  ]) {
    assert.equal(communicationRelevanceForTenant({ ...report, ...patch }, "a"), null);
  }
});
