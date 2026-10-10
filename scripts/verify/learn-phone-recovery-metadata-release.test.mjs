import test from "node:test";
import assert from "node:assert/strict";
import {
  releaseRecoveryMetadata,
  recoveryMetadataPackage,
  RECOVERY_METADATA_SHA,
} from "./learn-phone-recovery-metadata-release.mjs";
import { PHONE_PRESERVED } from "./learn-phone-publication-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40),
  manifest = recoveryMetadataPackage().manifest;
const prior = manifest.priorFingerprint,
  expected = "1".repeat(32);
const preserved = PHONE_PRESERVED.map((name) => ({ name, count: 0, fingerprint: "0".repeat(32) }));
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
                marker: "learn-phone-recovery-metadata/1",
                fingerprint: expected,
                catalog: {
                  phone: { tables: Array(8).fill({}), functions: Array(5).fill({}) },
                  base: {
                    base: { delivery: { health: { runtime: { ledger: Array(41).fill({}) } } } },
                  },
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
test("recovery grants expose status fields only, with no source writes or browser grants", () => {
  const p = recoveryMetadataPackage();
  assert.match(
    p.sql,
    /grant select \(tenant_id,recording_id,status\) on public.phone_transcripts to service_role/,
  );
  assert.match(
    p.sql,
    /grant select \(tenant_id,recording_id\) on public.phone_ai_insights to service_role/,
  );
  assert.doesNotMatch(
    p.sql,
    /grant select on public.phone_|grant .* to authenticated|grant .* to anon|grant insert|grant update/,
  );
  assert.match(p.sql, /Retained sources changed/);
});
test("rehearsal sends once after journal, verifies rollback and retains expected fingerprint", async () => {
  const f = fixture();
  const r = await releaseRecoveryMetadata({ ...args, ...f });
  assert.equal(f.sent, 1);
  assert.equal(r.state, "rehearsed_rolled_back");
  assert.equal(r.expectedFingerprint, expected);
  assert.equal(r.preservedDataSets, 74);
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
    await assert.rejects(releaseRecoveryMetadata({ ...args, ...f, ...override }));
    assert.equal(f.sent, 0);
  }
});
test("missing response or changed sources never report a verified rehearsal or retry", async () => {
  for (const config of [{ missingReceipt: true }, { changedSources: true }]) {
    const f = fixture(config);
    const r = await releaseRecoveryMetadata({ ...args, ...f });
    assert.equal(f.sent, 1);
    assert.equal(r.state, "requires_inspection");
  }
});
test("apply requires the exact rehearsed fingerprint and confirms committed state", async () => {
  let sent = 0,
    journal = false;
  const r = await releaseRecoveryMetadata({
    mode: "apply",
    allowProjectRef: TEST_PROJECT,
    token,
    rehearsal: {
      state: "rehearsed_rolled_back",
      sourceSha256: RECOVERY_METADATA_SHA,
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
