import test from "node:test";
import assert from "node:assert/strict";
import {
  releaseAssessmentRecovery,
  assessmentRecoveryPackage,
  ASSESSMENT_RECOVERY_SHA,
} from "./learn-assessment-recovery-release.mjs";
import { ASSESSMENT_RECOVERY_PRESERVED } from "./learn-assessment-recovery-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40),
  manifest = assessmentRecoveryPackage().manifest;
const prior = manifest.priorFingerprint,
  expected = "1".repeat(32);
const preserved = ASSESSMENT_RECOVERY_PRESERVED.map((name) => ({
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
                marker: "learn-assessment-recovery/1",
                fingerprint: expected,
                catalog: {
                  functions: Array(3).fill({}),
                  cancelTable: { name: "learn_assessment_cancellations" },
                  ledger: Array(47).fill({}),
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
test("Recovery package pins its access boundary, retained scoring inputs and exact rollback probe", () => {
  const p = assessmentRecoveryPackage();
  assert.equal(p.manifest.sources.length, 1);
  assert.match(p.sql, /create function public.learn_assessment_resolve/);
  assert.match(p.sql, /create table public.learn_assessment_cancellations/);
  assert.match(p.sql, /savepoint assessment_recovery_probe;/);
  assert.match(p.sql, /rollback to savepoint assessment_recovery_probe;/);
  assert.match(p.sql, /Existing assessment table or function authority changed/);
  assert.match(p.sql, /Retained sources changed/);
  assert.match(p.sql, /Unauthenticated assessment recovery admitted/);
  assert.doesNotMatch(
    p.sql,
    /insert into (public\.)?(profiles|platform_authority_grants)|insert into auth\./,
  );
  assert.equal(preserved.length, 87);
  for (const name of [
    "public.learn_assessments",
    "public.measurements",
    "public.learn_performance_reviews",
    "public.learn_performance_corrections",
    "public.learn_scorecard_publications",
    "public.config_versions",
    "public.operating_profile_entries",
    "public.learn_member_history",
  ])
    assert.ok(ASSESSMENT_RECOVERY_PRESERVED.includes(name));
});

test("rehearsal sends once after journal, verifies rollback and retains expected fingerprint", async () => {
  const f = fixture();
  const r = await releaseAssessmentRecovery({ ...args, ...f });
  assert.equal(f.sent, 1);
  assert.equal(r.state, "rehearsed_rolled_back");
  assert.equal(r.expectedFingerprint, expected);
  assert.equal(r.preservedDataSets, 87);
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
    await assert.rejects(releaseAssessmentRecovery({ ...args, ...f, ...override }));
    assert.equal(f.sent, 0);
  }
});
test("missing response or changed sources never report a verified rehearsal or retry", async () => {
  for (const config of [{ missingReceipt: true }, { changedSources: true }]) {
    const f = fixture(config);
    const r = await releaseAssessmentRecovery({ ...args, ...f });
    assert.equal(f.sent, 1);
    assert.equal(r.state, "requires_inspection");
  }
});
test("apply requires the exact rehearsed fingerprint and confirms committed state", async () => {
  let sent = 0,
    journal = false;
  const r = await releaseAssessmentRecovery({
    mode: "apply",
    allowProjectRef: TEST_PROJECT,
    token,
    rehearsal: {
      state: "rehearsed_rolled_back",
      sourceSha256: ASSESSMENT_RECOVERY_SHA,
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
