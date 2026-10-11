import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  readWorkCollectionEvidence,
  readWorkingCollectionItem,
} from "../../src/lib/learn-resumable-work.ts";
import { workingMinutes } from "../../src/lib/learn-working-time.ts";
const rows = JSON.parse(
  readFileSync(0, "utf8")
    .split("\n")
    .find((s) => s.startsWith("[")),
);
assert.equal(rows.length, 2);
for (const row of rows) {
  const { overview, calendar, pages, inputs } = row;
  const responses = [overview, calendar, ...pages, ...inputs];
  const db = {
    rpc: async (name, args) => {
      assert.equal(name, "learn_work_collection_evidence");
      assert.equal(args.p_tenant, overview.tenantId);
      assert.equal(args.p_request, overview.runId);
      return {
        data: responses.find(
          (d) =>
            d.part === args.p_part &&
            (d.part === "items"
              ? d.after === args.p_after
              : d.part === "workingItem"
                ? d.data.ordinal === args.p_after
                : args.p_after === 0),
        ),
        error: null,
      };
    },
  };
  await readWorkCollectionEvidence(db, overview.tenantId, overview.runId, "overview");
  for (const page of pages)
    await readWorkCollectionEvidence(db, overview.tenantId, overview.runId, "items", page.after);
  const items = pages.flatMap((p) => p.items);
  assert.equal(items.length, 205);
  const exact = items.reduce((sum, i) => sum + BigInt(i.result.assessedMicros), 0n);
  assert.equal(overview.proof.assessedMicros, String(exact));
  assert.equal(overview.proof.value, workingMinutes(exact));
  for (const input of inputs) {
    const item = items.find((i) => i.ordinal === input.data.ordinal);
    const verified = await readWorkingCollectionItem(
      db,
      overview.tenantId,
      overview.runId,
      overview,
      item,
    );
    assert.equal(verified.result.complete, true);
    for (const patch of [
      { assessedMicros: "999" },
      { delayThrough: 999 },
      { states: ["invented"] },
      { knownValue: 999 },
    ])
      await assert.rejects(
        readWorkingCollectionItem(db, overview.tenantId, overview.runId, overview, {
          ...item,
          result: { ...item.result, ...patch },
        }),
      );
  }
  const original = calendar.data.assessedMicros;
  calendar.data.assessedMicros = "999";
  await assert.rejects(
    readWorkingCollectionItem(db, overview.tenantId, overview.runId, overview, items[0]),
  );
  calendar.data.assessedMicros = original;
}
console.log(
  "Actual member/team SQL receipts: 410 paged results, exact aggregate reconciliation, six full input checks and corrupted-result denials PASS",
);
