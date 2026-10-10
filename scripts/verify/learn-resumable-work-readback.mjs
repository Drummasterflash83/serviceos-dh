import assert from "node:assert/strict";
import {
  parseWorkCollectionProgress,
  readWorkCollectionEvidence,
} from "../../src/lib/learn-resumable-work.ts";
let text = "";
for await (const chunk of process.stdin) text += chunk;
const data = JSON.parse(text);
const progress = parseWorkCollectionProgress(data.progress, data.request);
assert.equal(progress.state, "completed");
assert.equal(progress.population, 14500);
const db = {
  rpc: async (name, args) => {
    assert.equal(name, "learn_work_collection_evidence");
    assert.equal(args.p_tenant, data.request.tenantId);
    assert.equal(args.p_request, data.request.requestId);
    return { data: data[args.p_part], error: null };
  },
};
for (const part of ["overview", "membership", "teams", "items"])
  await readWorkCollectionEvidence(db, data.request.tenantId, data.request.requestId, part);
assert.equal(data.items.items.length, 100);
assert.equal(data.items.next, 100);
assert.equal(typeof data.items.items[0].head_sequence, "string");
console.log("Actual resumable SQL progress, overview, identity and item-page client parsing: PASS");

const { parseMeasurementSnapshot } =
  await import("../../src/lib/learn-performance-measurements.ts");
const { evaluateScorecard } = await import("../../src/lib/learn-scorecards.ts");
const policy = data.overview.policy,
  subject = { ...data.overview.subject, groupIds: data.measurement.group_ids },
  period = data.overview.period;
const rows = parseMeasurementSnapshot(
  policy,
  subject,
  period,
  [data.measurement],
  data.reviews,
  [],
);
assert.equal(rows[0].evidence[0].table, "learn_work_collection_runs");
assert.equal(typeof evaluateScorecard(policy, subject, period, rows).previewScore, "number");
const unreviewed = parseMeasurementSnapshot(policy, subject, period, [data.measurement], [], []);
assert.equal(evaluateScorecard(policy, subject, period, unreviewed).previewScore, null);
console.log("Actual resumable measurement, separate review and card/scorer parsing: PASS");
