import test from "node:test";
import assert from "node:assert/strict";
import {
  deployCommusoftAuth,
  commusoftAuthBundle,
  COMMUSOFT_AUTH_SHA,
  COMMUSOFT_AUTH_PRESERVED,
  commusoftAuthSnapshot,
} from "./learn-test-commusoft-auth-deploy.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";

// Historical v2 -> v3 release stays pinned. Contacts now require a new SQL/runtime
// release; do not silently expand the already verified authentication patch.
test("historical authentication release refuses the new contacts source before any access", async () => {
  let calls = 0;
  assert.notEqual(commusoftAuthBundle().sha256, COMMUSOFT_AUTH_SHA);
  await assert.rejects(
    deployCommusoftAuth({
      allowProjectRef: TEST_PROJECT,
      token: "sbp_" + "0".repeat(40),
      persistJournal: async () => {
        calls++;
      },
      fetcher: async () => {
        calls++;
        throw Error("Unexpected network");
      },
      runCli: () => {
        calls++;
      },
    }),
    /bundle changed/,
  );
  assert.equal(calls, 0);
});
test("preservation requires all 77 distinct datasets with valid fingerprints", () => {
  const rows = COMMUSOFT_AUTH_PRESERVED.map((name) => ({
    name,
    count: 0,
    fingerprint: "0".repeat(32),
  }));
  assert.equal(commusoftAuthSnapshot(rows).length, 77);
  for (const invalid of [
    rows.slice(1),
    [...rows.slice(1), rows[1]],
    rows.map((r, i) => (i ? r : { ...r, count: -1 })),
    rows.map((r, i) => (i ? r : { ...r, fingerprint: "unconfirmed" })),
  ]) {
    assert.throws(() => commusoftAuthSnapshot(invalid));
  }
});
test("wrong project or replacement override is refused before any access", async () => {
  for (const change of [
    { allowProjectRef: "production" },
    { replaceVersions: { "learn-commusoft-worker": 3 } },
  ]) {
    let calls = 0;
    await assert.rejects(
      deployCommusoftAuth({
        allowProjectRef: TEST_PROJECT,
        ...change,
        fetcher: async () => {
          calls++;
          throw Error();
        },
      }),
      /Exact TEST replacement scope/,
    );
    assert.equal(calls, 0);
  }
});
