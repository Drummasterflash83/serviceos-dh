/** Compile the isolated users-page Edge route locally; never deploy. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { PROJECT } from "./new-dawn-m2-live-preflight.mjs";

const IMAGE = "public.ecr.aws/supabase/edge-runtime:v1.74.3";
const IMAGE_ID = "sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c";
const DOCKER = "/usr/local/bin/docker";
const ENDPOINT = "learn-commusoft-users-page";
export const SOURCE_CLOSURE_SHA256 = "367e6d167d638b0e4c8b853fe0d723accbd6c19f311f5d15dce8ac051962909c";
const sha = value => createHash("sha256").update(value).digest("hex");

export function reviewedEdgeBundle() {
  const bundle = edgeRuntimeBundle([{ name: ENDPOINT, verifyJwt: true }]);
  if (bundle.sha256 !== SOURCE_CLOSURE_SHA256 ||
    JSON.stringify(bundle.files.map(file => file.path)) !== JSON.stringify([
      "_shared/commusoft/isolated_users_page.ts",
      "_shared/commusoft/read_page.ts",
      "_shared/commusoft/update_window.ts",
      "learn-commusoft-users-page/index.ts",
    ]) ||
    JSON.stringify(bundle.external) !== JSON.stringify(["https://esm.sh/@supabase/supabase-js@2.45.4"]) ||
    !bundle.files.find(file => file.path === "_shared/commusoft/isolated_users_page.ts")
      ?.source.includes('"commusoft-isolated-users-page/1"') ||
    !bundle.files.find(file => file.path === "learn-commusoft-users-page/index.ts")
      ?.source.includes('from "../_shared/commusoft/isolated_users_page.ts"'))
    throw Error("reviewed_users_page_edge_source_closure_changed");
  return bundle;
}

export function prepareEdgeCandidate(out, { runDocker = spawnSync } = {}) {
  const root = resolve(".verification-results"), target = resolve(out);
  if (!target.startsWith(root + "/") || existsSync(target))
    throw Error("fresh_private_output_required");
  const bundle = reviewedEdgeBundle();
  const inspected = runDocker(DOCKER, ["image", "inspect", IMAGE, "--format", "{{.Id}}"],
    { encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 });
  if (inspected.status !== 0 || inspected.stdout.trim() !== IMAGE_ID)
    throw Error("pinned_edge_runtime_unavailable");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(target, { mode: 0o700 });
  const stage = join(target, "stage"), artifacts = join(target, "artifacts"),
    cache = join(target, "cache");
  for (const dir of [stage, artifacts, cache]) mkdirSync(dir, { mode: 0o700 });
  for (const file of bundle.files) {
    const path = join(stage, "supabase/functions", file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.source, { mode: 0o600 });
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${PROJECT}"\n[functions.${ENDPOINT}]\nverify_jwt = true\n`,
    { mode: 0o600 });
  writeFileSync(join(stage, "deno.json"), JSON.stringify({ nodeModulesDir: "auto" }),
    { mode: 0o600 });
  const report = {
    version: "new-dawn-m2-users-page-edge-prepare/1", state: "building",
    project: PROJECT, endpoint: ENDPOINT, verifyJwt: true, image: IMAGE,
    imageId: IMAGE_ID, sourceClosureSha256: bundle.sha256,
    sourceFiles: bundle.files.map(file => ({ path: file.path, sha256: sha(file.source) })),
    external: bundle.external, productionChanged: false, providerRequests: 0,
    limitations: ["Local compile only; LIVE deployment and source readback remain separate."],
    preparedAt: new Date().toISOString(),
  };
  const save = () => writeFileSync(join(target, "candidate.private.json"),
    JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  save();
  const built = runDocker(DOCKER, ["run", "--rm", "--pull=never", "--network", "bridge",
    "--memory", "768m", "--cpus", "2", "--env", "DENO_DIR=/cache",
    "--mount", `type=bind,source=${stage},target=/work`,
    "--mount", `type=bind,source=${artifacts},target=/artifacts`,
    "--mount", `type=bind,source=${cache},target=/cache`, "--workdir", "/work", IMAGE,
    "bundle", "--entrypoint", `/work/supabase/functions/${ENDPOINT}/index.ts`,
    "--output", `/artifacts/${ENDPOINT}.eszip`, "--checksum", "sha256", "--timeout", "55"],
  { encoding: "utf8", timeout: 65000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(target, "compile.log"), (built.stdout ?? "") + (built.stderr ?? ""),
    { mode: 0o600 });
  if (built.status !== 0) {
    report.state = "compile_unconfirmed"; save();
    throw Error("users_page_edge_candidate_compile_unconfirmed");
  }
  if (bundle.files.some(file => readFileSync(join(stage,
    "supabase/functions", file.path), "utf8") !== file.source))
    throw Error("users_page_edge_stage_changed_during_compile");
  const artifact = join(artifacts, `${ENDPOINT}.eszip`);
  const bytes = readFileSync(artifact);
  if (bytes.length < 1000 || bytes.length > 20 * 1024 * 1024)
    throw Error("users_page_edge_eszip_size_unverified");
  report.eszipSha256 = sha(bytes);
  report.eszipBytes = bytes.length;
  const ezbr = Buffer.concat([Buffer.from("EZBR"), brotliCompressSync(bytes,
    { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } })]);
  if (!brotliDecompressSync(ezbr.subarray(4)).equals(bytes))
    throw Error("users_page_edge_transport_roundtrip_changed");
  writeFileSync(join(artifacts, `${ENDPOINT}.ezbr`), ezbr,
    { mode: 0o600, flag: "wx" });
  report.ezbrSha256 = sha(ezbr);
  report.ezbrBytes = ezbr.length;
  report.state = "compiled_local_candidate";
  report.completedAt = new Date().toISOString();
  save();
  return { state: report.state, output: target, sourceClosureSha256: bundle.sha256,
    eszipSha256: report.eszipSha256, eszipBytes: bytes.length,
    ezbrSha256: report.ezbrSha256, ezbrBytes: ezbr.length,
    productionChanged: false, providerRequests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== "--prepare-only" ||
      process.argv[3] !== "--out" || process.env.NEW_DAWN_M2_ALLOW_PROJECT !== PROJECT)
      throw Error("explicit_prepare_only_scope_required");
    console.log(JSON.stringify(prepareEdgeCandidate(process.argv[4])));
  } catch (error) {
    console.error(JSON.stringify({ state: "users_page_edge_candidate_unverified",
      code: error instanceof Error ? error.message : "unknown", productionChanged: false }));
    process.exitCode = 1;
  }
}
