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
