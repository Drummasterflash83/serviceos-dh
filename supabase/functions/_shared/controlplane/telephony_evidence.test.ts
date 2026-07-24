// Run: node --test supabase/functions/_shared/controlplane/telephony_evidence.test.ts
// End-to-end (pure): raw provider caller-IDs → adapter parse → provider-neutral aggregate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCallerIdLabel } from "../telephony/caller_id_labels.ts";
import { aggregateExtensionEvidence, type CallLegEvidence } from "./telephony_identity.ts";

// A tiny slice of realistic Drummonds CDR "from_number" values with timestamps.
const CDR: { from: string; at: string }[] = [
  { from: "Mary - Clients <103>", at: "2026-07-24T16:17:30Z" },
  { from: "Mary - Clients <103>", at: "2026-07-24T16:00:21Z" },
  { from: "Clients - Mary <103>", at: "2026-07-10T09:00:00Z" },
  { from: "Rudi - Operations <106>", at: "2026-07-24T16:00:36Z" },
  { from: "Julie - Sandy <101>", at: "2026-07-01T09:00:00Z" },
  { from: "Heidi <101>", at: "2026-07-20T09:00:00Z" }, // ext 101 reassigned
  { from: "07700900123", at: "2026-07-24T15:00:00Z" }, // external — dropped
  { from: "anonymous", at: "2026-07-24T14:00:00Z" }, // external — dropped
];

function toLegs(rows: { from: string; at: string }[]): CallLegEvidence[] {
  const legs: CallLegEvidence[] = [];
  for (const r of rows) {
    const p = parseCallerIdLabel(r.from);
    if (p.extension) legs.push({ extension: p.extension, label: p.label, at: r.at });
  }
  return legs;
}

test("external legs are dropped; only internal seats aggregate", () => {
  const ev = aggregateExtensionEvidence(toLegs(CDR));
  const exts = ev.map((e) => e.extension).sort();
  assert.deepEqual(exts, ["101", "103", "106"]);
});

test("Mary/103 aggregates both labels, most-recent-first, with volume + last activity", () => {
  const ev = aggregateExtensionEvidence(toLegs(CDR));
  const mary = ev.find((e) => e.extension === "103");
  assert.ok(mary);
  assert.equal(mary.call_count, 3);
  assert.equal(mary.observed_labels[0], "Mary - Clients"); // most recent label leads
  assert.ok(mary.observed_labels.includes("Clients - Mary"));
  assert.equal(mary.last_activity, "2026-07-24T16:17:30Z");
});

test("ext 101 preserves both reassigned labels for the operator to see the conflict", () => {
  const ev = aggregateExtensionEvidence(toLegs(CDR));
  const x = ev.find((e) => e.extension === "101");
  assert.ok(x);
  assert.deepEqual(new Set(x.observed_labels), new Set(["Julie - Sandy", "Heidi"]));
  assert.equal(x.observed_labels[0], "Heidi"); // 2026-07-20 more recent than 2026-07-01
});

test("results are sorted by call volume descending", () => {
  const ev = aggregateExtensionEvidence(toLegs(CDR));
  const counts = ev.map((e) => e.call_count ?? 0);
  assert.deepEqual(
    counts,
    [...counts].sort((a, b) => b - a),
  );
});
