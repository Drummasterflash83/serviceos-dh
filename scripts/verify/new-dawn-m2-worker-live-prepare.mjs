/** Prepare the reviewed LIVE worker-first candidate locally. No deploy or provider call. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { PROJECT, ENDPOINTS } from "./new-dawn-m2-live-preflight.mjs";

const IMAGE = "public.ecr.aws/supabase/edge-runtime:v1.74.3";
const IMAGE_ID = "sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c";
const DOCKER = "/usr/local/bin/docker";
const WORKER = "learn-commusoft-worker";
export const WORKER_SOURCE_SHA256 = "695a53138ced96cc341c2811d27a5fd0d000a144caaf39e142f758f725865429";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export function reviewedWorkerBundle() {
  const bundle = edgeRuntimeBundle([{ name: WORKER, verifyJwt: true }]);
  if (bundle.sha256 !== WORKER_SOURCE_SHA256 || bundle.files.length !== 9 ||
    bundle.external.length !== 1 || bundle.external[0] !== "https://esm.sh/@supabase/supabase-js@2.45.4")
    throw Error("worker_source_closure_changed");
  return bundle;
}

export function assessWorkerFirstCandidate({ manifest, stageConfig, sourceFiles }) {
  if (manifest?.project !== PROJECT || manifest?.endpoint !== WORKER ||
    manifest?.sourceClosureSha256 !== WORKER_SOURCE_SHA256 ||
    manifest?.baseline?.id !== ENDPOINTS[0].id ||
    manifest?.baseline?.version !== ENDPOINTS[0].version ||
    manifest?.baseline?.hash !== ENDPOINTS[0].hash ||
    manifest?.baseline?.verifyJwt !== true ||
    manifest?.image !== IMAGE || manifest?.imageId !== IMAGE_ID ||
    manifest?.productionChanged !== false || manifest?.providerRequests !== 0 ||
    manifest?.state !== "compiled_local_candidate" ||
    !/^[a-f\d]{64}$/.test(manifest?.eszipSha256 ?? ""))
    throw Error("worker_candidate_unverified");
  if (stageConfig !== `project_id = "${PROJECT}"\n[functions.${WORKER}]\nverify_jwt = true\n`)
    throw Error("worker_jwt_or_project_unverified");
  const bundle = reviewedWorkerBundle();
  if (!Array.isArray(sourceFiles) || sourceFiles.length !== bundle.files.length ||
    sourceFiles.some((file, i) => file.path !== bundle.files[i].path ||
      file.sha256 !== sha(bundle.files[i].source)))
    throw Error("worker_candidate_source_unverified");
  return true;
}

export function prepareWorkerCandidate(out, { runDocker = spawnSync } = {}) {
  const root = resolve(".verification-results"), target = resolve(out);
  if (!target.startsWith(root + "/") || existsSync(target))
    throw Error("fresh_private_output_required");
  const bundle = reviewedWorkerBundle();
  const inspected = runDocker(DOCKER, ["image", "inspect", IMAGE, "--format", "{{.Id}}"],
    { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  if (inspected.status !== 0 || inspected.stdout.trim() !== IMAGE_ID)
    throw Error("pinned_edge_runtime_unavailable");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(target, { mode: 0o700 });
  const stage = join(target, "stage"), artifacts = join(target, "artifacts"), cache = join(target, "cache");
  for (const dir of [stage, artifacts, cache]) mkdirSync(dir, { mode: 0o700 });
  for (const file of bundle.files) {
    const path = join(stage, "supabase/functions", file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.source, { mode: 0o600 });
  }
  const config = `project_id = "${PROJECT}"\n[functions.${WORKER}]\nverify_jwt = true\n`;
  writeFileSync(join(stage, "supabase/config.toml"), config, { mode: 0o600 });
  writeFileSync(join(stage, "deno.json"), JSON.stringify({ nodeModulesDir: "auto" }), { mode: 0o600 });
  const report = { version: "new-dawn-m2-worker-live-prepare/1", state: "building",
    project: PROJECT, endpoint: WORKER, image: IMAGE, imageId: IMAGE_ID,
    baseline: { id: ENDPOINTS[0].id, version: ENDPOINTS[0].version,
      hash: ENDPOINTS[0].hash, verifyJwt: true },
    sourceClosureSha256: bundle.sha256,
    sourceFiles: bundle.files.map(file => ({ path: file.path, sha256: sha(file.source) })),
    external: bundle.external, productionChanged: false, providerRequests: 0,
    limitations: ["Local compilation is not a deployed-runtime or provider acceptance check.",
      "The release owner must rerun the LIVE read-only preflight immediately before deployment."],
    preparedAt: new Date().toISOString() };
  const save = () => writeFileSync(join(target, "candidate.private.json"),
    JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  save();
  const built = runDocker(DOCKER, ["run", "--rm", "--pull=never", "--network", "bridge",
    "--memory", "768m", "--cpus", "2", "--env", "DENO_DIR=/cache",
    "--mount", `type=bind,source=${stage},target=/work`,
    "--mount", `type=bind,source=${artifacts},target=/artifacts`,
    "--mount", `type=bind,source=${cache},target=/cache`, "--workdir", "/work", IMAGE,
    "bundle", "--entrypoint", `/work/supabase/functions/${WORKER}/index.ts`,
    "--output", `/artifacts/${WORKER}.eszip`, "--checksum", "sha256", "--timeout", "55"],
  { encoding: "utf8", timeout: 65000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(target, "compile.log"), (built.stdout ?? "") + (built.stderr ?? ""), { mode: 0o600 });
  if (built.status !== 0) {
    report.state = "compile_unconfirmed";
    save();
    throw Error("worker_candidate_compile_unconfirmed");
  }
  if (bundle.files.some(file =>
    readFileSync(join(stage, "supabase/functions", file.path), "utf8") !== file.source))
    throw Error("worker_stage_changed_during_compile");
  const artifact = join(artifacts, `${WORKER}.eszip`);
  const bytes = readFileSync(artifact);
  if (bytes.length < 1000 || bytes.length > 20 * 1024 * 1024)
    throw Error("worker_eszip_size_unverified");
  report.eszipSha256 = sha(bytes);
  report.eszipBytes = bytes.length;
  report.state = "compiled_local_candidate";
  report.completedAt = new Date().toISOString();
  save();
  assessWorkerFirstCandidate({ manifest: report, stageConfig: readFileSync(join(stage,
    "supabase/config.toml"), "utf8"), sourceFiles: report.sourceFiles });
  return { state: report.state, output: target, sourceClosureSha256: bundle.sha256,
    eszipSha256: report.eszipSha256, eszipBytes: bytes.length,
    productionChanged: false, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== "--prepare-only" ||
      process.argv[3] !== "--out" || process.env.NEW_DAWN_M2_ALLOW_PROJECT !== PROJECT)
      throw Error("explicit_prepare_only_scope_required");
    console.log(JSON.stringify(prepareWorkerCandidate(process.argv[4])));
  } catch (error) {
    console.error(JSON.stringify({ state: "worker_candidate_unverified",
      code: error instanceof Error ? error.message : "unknown", productionChanged: false }));
    process.exitCode = 1;
  }
}
