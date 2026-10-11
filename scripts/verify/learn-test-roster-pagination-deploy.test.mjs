import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deployRosterPagination,
  ROSTER_RUNTIME_SHA,
} from "./learn-test-roster-pagination-deploy.mjs";
import { controlPlaneBundle } from "./learn-test-controlplane-deploy.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";

test("historical roster installer retains its deployed source pin and refuses newer health source", async () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/operations/evidence/learn-roster-pagination-test-2026-10-11.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(ROSTER_RUNTIME_SHA, evidence.backend.sourceBundleSha256);
  assert.notEqual(controlPlaneBundle().sha256, ROSTER_RUNTIME_SHA);
  let sideEffects = 0;
  await assert.rejects(
    deployRosterPagination({
      allowProjectRef: TEST_PROJECT,
      persistJournal: async () => {
        sideEffects++;
      },
      fetcher: async () => {
        sideEffects++;
        throw Error("unexpected fetch");
      },
      runCli: () => {
        sideEffects++;
      },
    }),
    /Reviewed roster runtime changed/,
  );
  assert.equal(sideEffects, 0);
});
