import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deployIdentityInventory,
  IDENTITY_RUNTIME_SHA,
} from "./learn-test-identity-inventory-deploy.mjs";
import { controlPlaneBundle } from "./learn-test-controlplane-deploy.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";

test("historical identity installer retains its deployed source pin and refuses newer ownership source", async () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/operations/evidence/learn-identity-inventory-test-2026-10-11.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(IDENTITY_RUNTIME_SHA, evidence.backend.sourceBundleSha256);
  assert.notEqual(controlPlaneBundle().sha256, IDENTITY_RUNTIME_SHA);
  let sideEffects = 0;
  await assert.rejects(
    deployIdentityInventory({
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
    /Reviewed identity inventory runtime changed/,
  );
  assert.equal(sideEffects, 0);
});
