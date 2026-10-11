import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  normalizeDelayPayload,
  parseDelayPage,
  parseDelaySnapshot,
  readDelayEvidence,
  resolveWorkDelay,
} from "../../src/lib/learn-work-delays.ts";
import { measureDeskTime } from "../../src/lib/learn-scorecards.ts";
const d = JSON.parse(
  readFileSync(0, "utf8")
    .split("\n")
    .find((s) => s.startsWith("{")),
);
const tenant = "aaa40000-0000-0000-0000-000000000004",
  object = "de1a0000-0000-4000-8000-000000000001",
  actor = "bbb40000-0000-0000-0000-000000000004",
  approval = "de1a0000-0000-4000-8000-000000000011";
const request = normalizeDelayPayload(d.request);
const page = parseDelayPage(d.page, tenant, object, 0, null);
assert.deepEqual(
  page.entries.map((e) => e.decision),
  ["approve", "approve", "reverse", "reverse"],
);
const snapshot = parseDelaySnapshot(
  d.snapshot,
  tenant,
  object,
  request.period,
  d.snapshot.observedAt,
);
assert.equal(snapshot.approvals.length, 2);
assert.equal(snapshot.windows.length, 1);
const current = parseDelaySnapshot(d.current, tenant, object, request.period, d.current.observedAt);
assert.equal(current.windows.length, 0);
const evidence = await readDelayEvidence(
  { rpc: async () => ({ data: d.evidence, error: null }) },
  tenant,
  object,
  approval,
);
assert.equal(evidence.capture.events.length, 2);
assert.equal(evidence.approval.period.start, request.period.start);
const resolved = await resolveWorkDelay(
  { rpc: async () => ({ data: d.resolution, error: null }) },
  tenant,
  actor,
  approval,
  request,
  false,
);
assert.equal(resolved.state, "recorded");
const before = measureDeskTime({
  period: request.period,
  ownership: [request.period],
  businessHours: [request.period],
  approvedExclusions: snapshot.windows,
});
assert.equal(before.assessedMinutes, 0);
assert.equal(before.excludedMinutes, before.businessMinutes);
const after = measureDeskTime({
  period: request.period,
  ownership: [request.period],
  businessHours: [request.period],
  approvedExclusions: current.windows,
});
assert.equal(after.excludedMinutes, 0);
assert.equal(after.assessedMinutes, after.businessMinutes);
const union = parseDelaySnapshot(
  d.union,
  tenant,
  "de1a0000-0000-4000-8000-000000000003",
  request.period,
  d.union.observedAt,
);
assert.equal(union.windows.length, 2);
console.log(
  "Actual SQL delay pages, precise snapshots, retained proof, recovery and desk-time exclusion/reversal integration: PASS",
);
