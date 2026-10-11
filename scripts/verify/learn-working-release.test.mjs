import test from "node:test";
import assert from "node:assert/strict";
import {
  releaseWorkingRelease,
  workingReleasePackage,
  WORKING_RELEASE_SHA,
} from "./learn-working-release.mjs";
import {
  WORKING_RELEASE_PRESERVED,
  WORKING_RELEASE_TABLES,
} from "./learn-working-release-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40),
  manifest = workingReleasePackage().manifest;
const prior = manifest.priorFingerprint,
  expected = "1".repeat(32);
const preserved = WORKING_RELEASE_PRESERVED.map((name) => ({
  name,
  count: 0,
  fingerprint: "0".repeat(32),
}));
function fixture({
  missingReceipt = false,
  changedSources = false,
  changeReceipt = (r) => r,
} = {}) {
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
              changeReceipt({
                marker: "learn-working-release/1",
                fingerprint: expected,
                catalog: {
                  functions: Array(27).fill({}),
                  tables: WORKING_RELEASE_TABLES.map((name) => ({ name })),
                  base: {
                    base: {
                      base: {
                        base: {
                          ledger: [
                            ...Array(50).fill({ project: TEST_PROJECT }),
                            {
                              project: TEST_PROJECT,
                              name: "learn_working_time_v1",
                              sha256: WORKING_RELEASE_SHA,
                            },
                          ],
                        },
                      },
                    },
                  },
                },
                preserved,
              }),
            ];
      }
      return changedSources && sent
        ? preserved.map((r, i) => ({ ...r, count: i === 0 ? 1 : 0 }))
        : preserved;
    },
  };
}
const args = { mode: "rehearse", allowProjectRef: TEST_PROJECT, token };
test("Working-time package pins its access boundary, retained scoring inputs and exact rollback probe", () => {
  const p = workingReleasePackage();
  assert.equal(p.manifest.sources.length, 5);
  assert.match(p.sql, /create or replace function public.learn_work_collection_begin/);
  assert.match(p.sql, /create table public.learn_working_collection_runs/);
  assert.match(p.sql, /savepoint working_time_probe;/);
  assert.match(p.sql, /rollback to savepoint working_time_probe;/);
  assert.match(p.sql, /Existing catalog or authority changed/);
  assert.match(p.sql, /Retained sources changed/);
  assert.match(p.sql, /Unauthenticated working-time RPC admitted/);
  assert.doesNotMatch(
    p.sql,
    /insert into (public\.)?(profiles|platform_authority_grants)|insert into auth\./,
  );
  assert.equal(preserved.length, 94);
  for (const name of [
    "public.learn_assessments",
    "public.measurements",
    "public.learn_performance_reviews",
    "public.learn_performance_corrections",
    "public.learn_scorecard_publications",
    "public.config_versions",
    "public.operating_profile_entries",
    "public.learn_member_history",
    "public.intelligence_objects",
    "public.object_state_history",
    "public.learn_work_measurement_runs",
    "public.learn_team_work_measurement_runs",
  ])
    assert.ok(WORKING_RELEASE_PRESERVED.includes(name));
});

test("rehearsal sends once after journal, verifies rollback and retains expected fingerprint", async () => {
  const f = fixture();
  const r = await releaseWorkingRelease({ ...args, ...f });
  assert.equal(f.sent, 1);
  assert.equal(r.state, "rehearsed_rolled_back");
  assert.equal(r.expectedFingerprint, expected);
  assert.equal(r.preservedDataSets, 94);
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
    await assert.rejects(releaseWorkingRelease({ ...args, ...f, ...override }));
    assert.equal(f.sent, 0);
  }
});
test("missing response or changed sources never report a verified rehearsal or retry", async () => {
  for (const config of [{ missingReceipt: true }, { changedSources: true }]) {
    const f = fixture(config);
    const r = await releaseWorkingRelease({ ...args, ...f });
    assert.equal(f.sent, 1);
    assert.equal(r.state, "requires_inspection");
  }
});
test("malformed fingerprint or wrong release ledger never authorizes installation", async () => {
  for (const changeReceipt of [
    (r) => ({ ...r, fingerprint: undefined }),
    (r) => ({ ...r, fingerprint: "not-a-fingerprint" }),
    (r) => {
      r.catalog.base.base.base.base.ledger[50].project = "other-project";
      return r;
    },
    (r) => {
      r.catalog.base.base.base.base.ledger[50].sha256 = "0".repeat(64);
      return r;
    },
  ]) {
    const f = fixture({ changeReceipt });
    const r = await releaseWorkingRelease({ ...args, ...f });
    assert.equal(r.state, "requires_inspection");
    assert.equal(f.sent, 1);
  }
});
test("apply requires the exact rehearsed fingerprint and confirms committed state", async () => {
  let sent = 0,
    journal = false;
  const r = await releaseWorkingRelease({
    mode: "apply",
    allowProjectRef: TEST_PROJECT,
    token,
    rehearsal: {
      state: "rehearsed_rolled_back",
      sourceSha256: WORKING_RELEASE_SHA,
      projectRef: TEST_PROJECT,
      priorFingerprint: prior,
      observedAt: new Date().toISOString(),
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

test("expired, future or different-baseline rehearsals cannot submit an apply", async () => {
  for (const change of [
    { observedAt: new Date(Date.now() - 3600001).toISOString() },
    { observedAt: new Date(Date.now() + 60000).toISOString() },
    { priorFingerprint: "0".repeat(32) },
  ]) {
    const f = fixture();
    await assert.rejects(
      releaseWorkingRelease({
        ...args,
        ...f,
        mode: "apply",
        rehearsal: {
          state: "rehearsed_rolled_back",
          sourceSha256: WORKING_RELEASE_SHA,
          projectRef: TEST_PROJECT,
          priorFingerprint: prior,
          observedAt: new Date().toISOString(),
          expectedFingerprint: expected,
          ...change,
        },
      }),
    );
    assert.equal(f.sent, 0);
  }
});
