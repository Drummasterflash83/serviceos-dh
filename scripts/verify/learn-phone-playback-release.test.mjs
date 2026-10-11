import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releasePhonePlayback, PHONE_PLAYBACK_SHA } from "./learn-phone-playback-release.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";
const prior = JSON.parse(
  readFileSync("supabase/release/learn-test/057_phone_playback.prerequisites.json"),
);
const expected = "e".repeat(32);
function fixture({
  mode = "apply",
  loseResponse = false,
  changedSource = false,
  installed = true,
} = {}) {
  let catalogs = 0,
    reads = 0,
    posts = 0,
    journaled = false;
  const rehearsal = {
    state: "rehearsed_rolled_back",
    sourceSha256: PHONE_PLAYBACK_SHA,
    projectRef: TEST_PROJECT,
    priorFingerprint: prior.fingerprint,
    expectedFingerprint: expected,
    observedAt: new Date().toISOString(),
  };
  const receipt = {
    marker: "learn-phone-playback/1",
    fingerprint: expected,
    preserved: prior.preserved,
    catalog: {
      phone: { tables: Array(12).fill({}), functions: Array(8).fill({}) },
      base: {
        ledger: [
          ...prior.catalog.base.ledger,
          { name: "learn_phone_playback_v1", sha256: PHONE_PLAYBACK_SHA, project: TEST_PROJECT },
        ],
      },
    },
  };
  const args = {
    mode,
    allowProjectRef: TEST_PROJECT,
    token: "sbp_" + "a".repeat(40),
    rehearsal,
    persistJournal: async () => {
      journaled = true;
    },
    catalog: async () =>
      ++catalogs === 1
        ? prior
        : { fingerprint: mode === "rehearse" || !installed ? prior.fingerprint : expected },
    query: async (_token, _sql, options) => {
      if (options?.readOnly === false) {
        assert.ok(journaled);
        posts++;
        if (loseResponse) throw new DOMException("Unknown acknowledgement", "TimeoutError");
        return [receipt];
      }
      reads++;
      const result = structuredClone(prior.preserved);
      if (changedSource && reads > 1) result[0].fingerprint = "f".repeat(32);
      return result;
    },
  };
  return { args, posts: () => posts };
}
test("full rehearsal needs receipt, rollback and all preserved data", async () => {
  const f = fixture({ mode: "rehearse" });
  const r = await releasePhonePlayback(f.args);
  assert.equal(r.state, "rehearsed_rolled_back");
  assert.equal(r.preservedDataSets, 112);
  assert.equal(f.posts(), 1);
});
test("lost apply acknowledgement reconciles exactly once from pinned post-state", async () => {
  const f = fixture({ loseResponse: true });
  const r = await releasePhonePlayback(f.args);
  assert.equal(r.state, "installed_needs_hosted_acceptance");
  assert.equal(r.submissionFailure, "request_timeout");
  assert.equal(f.posts(), 1);
});
test("uncertain uninstalled transaction is never resubmitted", async () => {
  const f = fixture({ loseResponse: true, installed: false });
  assert.equal((await releasePhonePlayback(f.args)).state, "requires_inspection");
  assert.equal(f.posts(), 1);
});
test("changed retained data prevents acceptance despite expected schema", async () => {
  const f = fixture({ changedSource: true });
  assert.equal((await releasePhonePlayback(f.args)).state, "requires_inspection");
});
test("wrong target, expired rehearsal and failed durable journal prevent submission", async () => {
  for (const failure of ["target", "rehearsal", "journal"]) {
    const f = fixture();
    if (failure === "target") f.args.allowProjectRef = "production";
    if (failure === "rehearsal")
      f.args.rehearsal.observedAt = new Date(Date.now() - 3600001).toISOString();
    if (failure === "journal")
      f.args.persistJournal = async () => {
        throw Error("Journal unavailable");
      };
    await assert.rejects(() => releasePhonePlayback(f.args));
    assert.equal(f.posts(), 0);
  }
});
