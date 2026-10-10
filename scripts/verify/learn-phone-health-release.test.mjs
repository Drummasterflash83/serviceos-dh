import test from "node:test";
import assert from "node:assert/strict";
import {
  releasePhoneHealth,
  phoneHealthPackage,
  PHONE_HEALTH_SHA,
} from "./learn-phone-health-release.mjs";
import { PHONE_HEALTH_PRESERVED } from "./learn-phone-health-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40),
  manifest = phoneHealthPackage().manifest;
const prior = manifest.priorFingerprint,
  expected = "1".repeat(32);
const preserved = PHONE_HEALTH_PRESERVED.map((name) => ({
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
                marker: "learn-phone-health/1",
                fingerprint: expected,
                catalog: {
                  phoneEvidence: { functions: Array(4).fill({}), indexes: [{}] },
                  base: { base: { contacts: { ledger: Array(45).fill({}) } } },
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
test("Phone package pins private evidence helpers and rollback of the actual settlement probe", () => {
  const p = phoneHealthPackage();
  assert.equal(p.manifest.sources.length, 1);
  assert.match(p.sql, /create function public.learn_phone_account_evidence/);
  assert.match(p.sql, /create function public.learn_phone_processing_evidence/);
  assert.match(p.sql, /create index learn_phone_schedule_health_lookup/);
  assert.match(p.sql, /savepoint phone_health_probe;/);
  assert.match(p.sql, /rollback to savepoint phone_health_probe;/);
  assert.match(p.sql, /Existing Phone grants or ownership changed/);
  assert.match(p.sql, /Retained sources changed/);
  assert.match(p.sql, /receipt:=public.learn_phone_settle_schedule/);
  assert.doesNotMatch(
    p.sql,
    /insert into (public\.)?(profiles|platform_authority_grants)|insert into auth\./,
  );
  assert.equal(preserved.length, 78);
});

test("rehearsal sends once after journal, verifies rollback and retains expected fingerprint", async () => {
  const f = fixture();
  const r = await releasePhoneHealth({ ...args, ...f });
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
    await assert.rejects(releasePhoneHealth({ ...args, ...f, ...override }));
    assert.equal(f.sent, 0);
  }
});
test("missing response or changed sources never report a verified rehearsal or retry", async () => {
  for (const config of [{ missingReceipt: true }, { changedSources: true }]) {
    const f = fixture(config);
    const r = await releasePhoneHealth({ ...args, ...f });
    assert.equal(f.sent, 1);
    assert.equal(r.state, "requires_inspection");
  }
});
test("apply requires the exact rehearsed fingerprint and confirms committed state", async () => {
  let sent = 0,
    journal = false;
  const r = await releasePhoneHealth({
    mode: "apply",
    allowProjectRef: TEST_PROJECT,
    token,
    rehearsal: {
      state: "rehearsed_rolled_back",
      sourceSha256: PHONE_HEALTH_SHA,
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
