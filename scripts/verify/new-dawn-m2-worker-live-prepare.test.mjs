import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ENDPOINTS, PROJECT } from "./new-dawn-m2-live-preflight.mjs";
import { assessWorkerFirstCandidate, reviewedWorkerBundle,
  WORKER_SOURCE_SHA256 } from "./new-dawn-m2-worker-live-prepare.mjs";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const config = `project_id = "${PROJECT}"\n[functions.learn-commusoft-worker]\nverify_jwt = true\n`;
function compiled() {
  const bundle = reviewedWorkerBundle();
  return { stageConfig: config,
    sourceFiles: bundle.files.map(file => ({ path: file.path, sha256: sha(file.source) })),
    manifest: { project: PROJECT, endpoint: "learn-commusoft-worker",
      sourceClosureSha256: WORKER_SOURCE_SHA256, baseline: {
        id: ENDPOINTS[0].id, version: ENDPOINTS[0].version,
        hash: ENDPOINTS[0].hash, verifyJwt: true },
      image: "public.ecr.aws/supabase/edge-runtime:v1.74.3",
      imageId: "sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c",
      productionChanged: false, providerRequests: 0, state: "compiled_local_candidate",
      eszipSha256: "a".repeat(64) } };
}

test("worker-first candidate binds complete source, LIVE baseline and JWT", () => {
  const candidate = compiled();
  assert.equal(candidate.sourceFiles.length, 9);
  assert.equal(assessWorkerFirstCandidate(candidate), true);
  candidate.stageConfig = candidate.stageConfig.replace("true", "false");
  assert.throws(() => assessWorkerFirstCandidate(candidate), /worker_jwt_or_project_unverified/);
});

test("candidate rejects changed source, baseline or claimed production write", () => {
  const source = compiled(); source.sourceFiles[0].sha256 = "0".repeat(64);
  assert.throws(() => assessWorkerFirstCandidate(source), /worker_candidate_source_unverified/);
  const baseline = compiled(); baseline.manifest.baseline.version++;
  assert.throws(() => assessWorkerFirstCandidate(baseline), /worker_candidate_unverified/);
  const write = compiled(); write.manifest.productionChanged = true;
  assert.throws(() => assessWorkerFirstCandidate(write), /worker_candidate_unverified/);
});
