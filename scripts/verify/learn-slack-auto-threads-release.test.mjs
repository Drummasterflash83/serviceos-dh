import test from "node:test";
import assert from "node:assert/strict";
import { releaseAuto, autoPackage, AUTO_RELEASE_SHA } from "./learn-slack-auto-threads-release.mjs";
import { AUTO_PRESERVED } from "./learn-slack-auto-threads-catalog.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const token = "sbp_" + "0".repeat(40),
  manifest = autoPackage().manifest;
const prior = manifest.priorFingerprint,
  expected = "1".repeat(32);
const preserved = AUTO_PRESERVED.map((name) => ({ name, count: 0, fingerprint: "0".repeat(32) }));
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
                marker: "learn-slack-auto-threads/1",
                fingerprint: expected,
                catalog: {
                  slack: { tables: Array(14).fill({}), functions: Array(17).fill({}) },
                  base: { delivery: { health: { runtime: { ledger: Array(39).fill({}) } } } },
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
test("package is opt-in, bounded, and preserves original subscriptions and thread sources", () => {
  const p = autoPackage();
  assert.equal(p.manifest.sources.length, 1);
  assert.match(p.sql, /include_threads boolean not null default false/);
  assert.match(p.sql, /limit 20/);
  assert.match(p.sql, /pg_try_advisory_xact_lock/);
  assert.match(p.sql, /recurring_thread_allowed/);
  assert.match(p.sql, /slack_recurring_thread_windows/);
  assert.doesNotMatch(p.sql, /insert into auth.users|insert into public.platform_authority_grants/);
  assert.match(p.sql, /Retained sources changed/);
});
test("rehearsal sends once after journal, verifies rollback and retains expected fingerprint", async () => {
  const f = fixture();
  const r = await releaseAuto({ ...args, ...f });
  assert.equal(f.sent, 1);
  assert.equal(r.state, "rehearsed_rolled_back");
  assert.equal(r.expectedFingerprint, expected);
  assert.equal(r.preservedDataSets, 70);
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
    await assert.rejects(releaseAuto({ ...args, ...f, ...override }));
    assert.equal(f.sent, 0);
  }
});
test("missing response or changed sources never report a verified rehearsal or retry", async () => {
  for (const config of [{ missingReceipt: true }, { changedSources: true }]) {
    const f = fixture(config);
    const r = await releaseAuto({ ...args, ...f });
    assert.equal(f.sent, 1);
    assert.equal(r.state, "requires_inspection");
  }
});
test("apply requires the exact rehearsed fingerprint and confirms committed state", async () => {
  let sent = 0,
    journal = false;
  const r = await releaseAuto({
    mode: "apply",
    allowProjectRef: TEST_PROJECT,
    token,
    rehearsal: {
      state: "rehearsed_rolled_back",
      sourceSha256: AUTO_RELEASE_SHA,
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
  assert.equal(r.state, "installed_needs_signed_in_acceptance");
});
