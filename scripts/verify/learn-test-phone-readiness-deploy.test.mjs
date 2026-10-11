import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  deployPhoneReadiness,
  PHONE_READINESS_RUNTIME_SHA,
} from "./learn-test-phone-readiness-deploy.mjs";
import { controlPlaneBundle } from "./learn-test-controlplane-deploy.mjs";
import { TEST_PROJECT } from "./learn-test-readiness.mjs";

test("historical Phone readiness installer retains its deployed source pin and refuses newer connection source", async () => {
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/operations/evidence/learn-phone-readiness-test-2026-10-11.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(PHONE_READINESS_RUNTIME_SHA, evidence.backend.sourceBundleSha256);
  assert.notEqual(controlPlaneBundle().sha256, PHONE_READINESS_RUNTIME_SHA);
  let sideEffects = 0;
  await assert.rejects(
    deployPhoneReadiness({
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
    /Reviewed Phone readiness runtime changed/,
  );
  assert.equal(sideEffects, 0);
});
