import test from "node:test";
import assert from "node:assert/strict";
import { releaseMapping, mappingPackage, MAPPING_SHA } from "./learn-commusoft-mapping-release.mjs";
import { MAPPING_PRESERVED } from "./learn-commusoft-mapping-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40),
  manifest = mappingPackage().manifest;
const prior = manifest.priorFingerprint,
  expected = "1".repeat(32);
const preserved = MAPPING_PRESERVED.map((name) => ({
  name,
  count: 0,
  fingerprint: "0".repeat(32),
}));
function fixture({ missingReceipt = false, changedSources = false } = {}) {
  let sent = 0,
    journal = false;
  return {
    get sent() {
      return sent;
    },
    persistJournal: async () => {
      journal = true;
    },
    catalog: async () => ({ fingerprint: prior }),
    query: async (_token, sql, options) => {
      if (options?.readOnly === false) {
        assert.ok(journal);
        sent++;
        assert.match(sql, /rollback;\n$/);
        assert.ok(!sql.endsWith("commit;\n"));
        return missingReceipt
          ? []
          : [
              {
                marker: "learn-commusoft-mapping/1",
                fingerprint: expected,
                catalog: {
                  mapping: Array(3).fill({}),
                  base: { contacts: { ledger: Array(44).fill({}) } },
                },
                preserved,
              },
            ];
      }
      return changedSources && sent
        ? preserved.map((r, i) => ({ ...r, count: i === 0 ? 1 : 0 }))
        : preserved;
    },
  };
}
const args = { mode: "rehearse", allowProjectRef: TEST_PROJECT, token };
test("mapping package pins two review functions without new access or source mutation", () => {
  const p = mappingPackage();
  assert.equal(p.manifest.sources.length, 2);
  assert.match(p.sql, /create or replace function public.learn_commusoft_customer_candidates/);
  assert.match(p.sql, /create or replace function public.learn_commusoft_confirm_work_record/);
  assert.match(p.sql, /savepoint mapping_probe;/);
  assert.match(p.sql, /rollback to savepoint mapping_probe;/);
  assert.match(p.sql, /Mapping grants or ownership changed/);
  assert.match(p.sql, /Retained sources changed/);
  assert.doesNotMatch(p.sql, /grant .* to authenticated|grant .* to anon/);
  assert.equal(preserved.length, 78);
});

test("rehearsal sends once after journal, verifies rollback and retains expected fingerprint", async () => {
  const f = fixture();
  const r = await releaseMapping({ ...args, ...f });
  assert.equal(f.sent, 1);
  assert.equal(r.state, "rehearsed_rolled_back");
  assert.equal(r.expectedFingerprint, expected);
  assert.equal(r.preservedDataSets, 78);
});
test("wrong target, missing rehearsal, schema drift and failed journaling prevent SQL submission", async () => {
  for (const override of [
    { allowProjectRef: "production" },
    { mode: "apply" },
    { catalog: async () => ({ fingerprint: "0".repeat(32) }) },
    {
      persistJournal: async () => {
        throw Error("disk unavailable");
      },
    },
  ]) {
    const f = fixture();
    await assert.rejects(releaseMapping({ ...args, ...f, ...override }));
    assert.equal(f.sent, 0);
  }
});
test("missing response or changed sources never report a verified rehearsal or retry", async () => {
  for (const config of [{ missingReceipt: true }, { changedSources: true }]) {
    const f = fixture(config);
    const r = await releaseMapping({ ...args, ...f });
    assert.equal(f.sent, 1);
    assert.equal(r.state, "requires_inspection");
  }
});
test("apply requires the exact rehearsed fingerprint and confirms committed state", async () => {
  let sent = 0,
    journal = false;
  const r = await releaseMapping({
    mode: "apply",
    allowProjectRef: TEST_PROJECT,
    token,
    rehearsal: {
      state: "rehearsed_rolled_back",
      sourceSha256: MAPPING_SHA,
      projectRef: TEST_PROJECT,
      expectedFingerprint: expected,
    },
    persistJournal: async () => {
      journal = true;
    },
    catalog: async () => ({ fingerprint: sent ? expected : prior }),
    query: async (_token, sql, options) => {
      if (options?.readOnly === false) {
        assert.ok(journal);
        assert.match(sql, /commit;\n$/);
        sent++;
        return [];
      }
      return preserved;
    },
  });
  assert.equal(sent, 1);
  assert.equal(r.state, "installed_needs_hosted_acceptance");
});
