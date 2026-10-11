import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deployConnectionInventory,
  CONNECTION_INVENTORY_RUNTIME_SHA,
} from "./learn-test-connection-inventory-deploy.mjs";
import { controlPlaneBundle } from "./learn-test-controlplane-deploy.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";

test("historical Connection inventory installer retains its deployed source pin and refuses newer discovery-history source", async () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/operations/evidence/learn-connection-inventory-test-2026-10-11.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(CONNECTION_INVENTORY_RUNTIME_SHA, evidence.backend.sourceBundleSha256);
  assert.notEqual(controlPlaneBundle().sha256, CONNECTION_INVENTORY_RUNTIME_SHA);
  let sideEffects = 0;
  await assert.rejects(
    deployConnectionInventory({
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
    /Reviewed Connection inventory runtime changed/,
  );
  assert.equal(sideEffects, 0);
});
