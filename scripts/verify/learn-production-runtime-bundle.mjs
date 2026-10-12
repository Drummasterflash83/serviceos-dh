/** Build candidate eszips locally. No deploy, provider credentials or customer data. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { PRODUCTION_RUNTIME_ENDPOINTS } from "./learn-production-runtime-candidate.mjs";

const root = resolve("."), output = resolve(process.argv[2] ?? "");
if (!output.startsWith(join(root, ".verification-results") + "/"))
  throw Error("Provide a new private verification output directory");
const docker = "/usr/local/bin/docker";
const image = "public.ecr.aws/supabase/edge-runtime:v1.74.3";
const expectedImage = "sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c";
const sha = value => createHash("sha256").update(value).digest("hex");
const manifestPath = "supabase/release/learn-production/runtime-candidate.manifest.json";
const manifestText = readFileSync(manifestPath, "utf8"), manifest = JSON.parse(manifestText);
const bundle = edgeRuntimeBundle(PRODUCTION_RUNTIME_ENDPOINTS);
if (bundle.sha256 !== manifest.sourceClosureSha256 ||
    JSON.stringify(manifest.endpoints.map(({ name, verifyJwt }) => ({ name, verifyJwt }))) !== JSON.stringify(PRODUCTION_RUNTIME_ENDPOINTS) ||
    bundle.files.some(f => manifest.files.find(p => p.path === f.path)?.sha256 !== sha(f.source)))
  throw Error("Candidate source closure changed");
const inspected = spawnSync(docker, ["image", "inspect", image, "--format", "{{.Id}}"], { encoding: "utf8" });
if (inspected.status !== 0 || inspected.stdout.trim() !== expectedImage) throw Error("Pinned local Edge runtime required");
mkdirSync(output, { mode: 0o700 }); // Exclusive output: never overwrite an earlier run.
const stage = join(output, "stage"), artifacts = join(output, "artifacts"), cache = join(output, "cache");
for (const path of [stage, artifacts, cache]) mkdirSync(path, { mode: 0o700 });
for (const file of bundle.files) {
  const path = join(stage, "supabase/functions", file.path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, file.source, { mode: 0o600 });
}
// Resolve explicit runtime imports only. Copying the entire voicemail test npm
// tree also bundled its unused/dev packages into every endpoint's virtual FS.
writeFileSync(join(stage, "deno.json"), JSON.stringify({ nodeModulesDir: "auto" }));
const report = {
  version: "learn-production-runtime-bundle/1", state: "building", startedAt: new Date().toISOString(),
  image, imageId: expectedImage, manifestSha256: sha(manifestText), sourceClosureSha256: bundle.sha256,
  dependencyMode: "Managed runtime imports only; no test dependency tree or package manifest copied.",
  productionChanged: false, hostedTestChanged: false, credentialsMounted: false,
  customerDataMounted: false, portsPublished: false, runtimeCodeExecuted: false,
  network: "Public package resolution during bundling only; no application invocation or provider calls.",
  endpoints: [],
  limitations: ["Compilation is not gateway/auth, provider, database or signed-in acceptance.",
    "External dependency bytes are resolved during this run; retain eszip hashes for executable provenance.",
    "No hosted deployment, capture or schedule change occurs."],
};
function save() { writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); }
save();
for (const endpoint of PRODUCTION_RUNTIME_ENDPOINTS) {
  const result = spawnSync(docker, ["run", "--rm", "--pull=never", "--network", "bridge",
    "--memory", "768m", "--cpus", "2", "--env", "DENO_DIR=/cache",
    "--mount", `type=bind,source=${stage},target=/work`,
    "--mount", `type=bind,source=${artifacts},target=/artifacts`,
    "--mount", `type=bind,source=${cache},target=/cache`,
    "--workdir", "/work", image, "bundle", "--entrypoint", `/work/supabase/functions/${endpoint.name}/index.ts`,
    "--output", `/artifacts/${endpoint.name}.eszip`, "--checksum", "sha256", "--timeout", "55"],
  { encoding: "utf8", timeout: 65000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(output, endpoint.name + ".log"), (result.stdout ?? "") + (result.stderr ?? ""), { mode: 0o600 });
  if (result.status !== 0) {
    report.state = "bundle_failed";
    report.failure = { endpoint: endpoint.name, exitCode: result.status, signal: result.signal };
    save();
    console.log(JSON.stringify({ state: report.state, ...report.failure, completed: report.endpoints.length }));
    process.exitCode = 1;
    break;
  }
  const bytes = readFileSync(join(artifacts, endpoint.name + ".eszip"));
  if (bundle.files.some(f => readFileSync(join(stage,"supabase/functions",f.path),"utf8") !== f.source))
    throw Error("Staged source changed during dependency resolution");
  report.endpoints.push({ ...endpoint, bytes: bytes.length, eszipSha256: sha(bytes),
    withinConservativeLocalBundleLimit: bytes.length <= 20000000 });
  save();
  console.log(JSON.stringify({ bundled: endpoint.name, completed: report.endpoints.length, total: PRODUCTION_RUNTIME_ENDPOINTS.length }));
}
if (!report.failure) {
  report.state = "all_candidate_endpoints_bundled";
  report.withinConservativeLocalBundleLimit = report.endpoints.every(e=>e.withinConservativeLocalBundleLimit);
  if (existsSync(join(stage,"deno.lock"))) report.resolvedLockSha256 = sha(readFileSync(join(stage,"deno.lock")));
  report.completedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ state: report.state, endpoints: report.endpoints.length, sourceClosureSha256: bundle.sha256 }));
}
