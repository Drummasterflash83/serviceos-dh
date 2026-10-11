import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deployOwnershipEvidence,
  OWNERSHIP_RUNTIME_SHA,
} from "./learn-test-ownership-evidence-deploy.mjs";
import { controlPlaneBundle } from "./learn-test-controlplane-deploy.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";

test("historical ownership installer retains its deployed source pin and refuses newer Phone readiness source", async () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/operations/evidence/learn-ownership-evidence-test-2026-10-11.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(OWNERSHIP_RUNTIME_SHA, evidence.backend.sourceBundleSha256);
  assert.notEqual(controlPlaneBundle().sha256, OWNERSHIP_RUNTIME_SHA);
  let sideEffects = 0;
  await assert.rejects(
    deployOwnershipEvidence({
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
    /Reviewed ownership evidence runtime changed/,
  );
  assert.equal(sideEffects, 0);
});
