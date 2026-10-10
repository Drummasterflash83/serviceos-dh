import test from "node:test";
import assert from "node:assert/strict";
import { transport } from "./learn-commusoft-setup-test-fixture.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
import { CONNECTION_TABLES } from "./learn-commusoft-setup-catalog.mjs";
import {
  CONNECTION_PRESERVED_TABLES,
  CONNECTION_SOURCE_SNAPSHOT,
  CONNECTION_NEW_COUNTS,
  normalizedSources,
  preserveConnectionRelease,
  confirmConnectionRelease,
} from "./learn-test-commusoft-setup-hosted.mjs";
const args = { allowProjectRef: TEST_PROJECT, token: "sbp_" + "a".repeat(40) };
const sourceRows = () =>
  CONNECTION_PRESERVED_TABLES.map((name) => ({ name, count: 3, fingerprint: "a".repeat(32) }));
function hosted(options = {}) {
  const base = transport(options);
  let journal;
  return {
    get writes() {
      return base.writes;
    },
    get journal() {
      return journal;
    },
    persistJournal: async (value) => {
      assert.equal(base.writes, 0);
      journal = value;
    },
    fetcher: async (url, o) => {
      const q = o?.body ? JSON.parse(o.body).query : null;
      if (q === CONNECTION_SOURCE_SNAPSHOT) {
        if (options.sourceUnavailable && base.writes) throw Error("Unavailable");
        const rows = sourceRows();
        if (options.sourceChanged && base.writes) rows[0].fingerprint = "b".repeat(32);
        return Response.json(rows);
      }
      if (q === CONNECTION_NEW_COUNTS)
        return Response.json(
          CONNECTION_TABLES.map((name) => ({ name, count: options.unexpectedRows ? 1 : 0 })),
        );
      return base.fetcher(url, o);
    },
  };
}
test("source evidence rejects duplicate/missing tables even when aggregate row count matches", () => {
  const rows = sourceRows();
  assert.equal(normalizedSources(rows).length, 28);
  rows[0] = rows[1];
  assert.throws(() => normalizedSources(rows));
  assert.throws(() => normalizedSources(sourceRows().slice(1)));
});
test("hosted wrapper journals before write, retains prior fixtures, and confirms unknown committed outcome read-only", async () => {
  const h = hosted({ rehearse: true });
  const rehearsal = await preserveConnectionRelease({ ...args, rehearse: true, ...h });
  assert.equal(rehearsal.state, "rehearsed_and_rolled_back");
  assert.ok(h.journal);
  assert.equal(h.writes, 1);
  const applied = hosted({ unknown: true, committed: true });
  const result = await preserveConnectionRelease({ ...args, rehearsal, ...applied });
  assert.equal(result.state, "requires_inspection");
  assert.equal(applied.writes, 1);
  const confirmation = await confirmConnectionRelease({
    ...args,
    journal: applied.journal,
    fetcher: applied.fetcher,
  });
  assert.equal(confirmation.report.state, "installed_needs_authenticated_acceptance");
  assert.equal(confirmation.report.preExistingSourcesPreserved, true);
  assert.equal(applied.writes, 1);
});
test("changed or unavailable source evidence and seeded new rows cannot report successful installation", async () => {
  const h = hosted({ rehearse: true });
  const rehearsal = await preserveConnectionRelease({ ...args, rehearse: true, ...h });
  for (const options of [
    { sourceChanged: true },
    { sourceUnavailable: true },
    { unexpectedRows: true },
  ]) {
    const n = hosted(options);
    const result = await preserveConnectionRelease({ ...args, rehearsal, ...n });
    assert.equal(result.state, "requires_inspection");
    assert.equal(n.writes, 1);
  }
  const n = hosted();
  await assert.rejects(
    preserveConnectionRelease({
      ...args,
      rehearsal: { ...rehearsal, preExistingSourcesPreserved: false },
      ...n,
    }),
  );
  assert.equal(n.writes, 0);
});
