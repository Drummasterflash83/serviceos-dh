/** Offline compile of exact staged recommendation-sweep Edge closures. No deploy. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

if (![4, 5].includes(process.argv.length) || process.argv[2] !== "--manifest" ||
    (process.argv.length === 5 && process.argv[4] !== "--with-pinned-dependencies"))
  throw Error("Exact private stage manifest required");
const dependencyNetwork = process.argv[4] === "--with-pinned-dependencies";
const manifestPath = resolve(process.argv[3]);
const privateRoot = resolve(".verification-results");
if (!manifestPath.startsWith(privateRoot + "/") || realpathSync(manifestPath) !== manifestPath)
  throw Error("Private stage path invalid");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== "learn-build01-recommendation-sweep-stage/1" ||
    !["test", "live"].includes(manifest.label) ||
    !isAbsolute(manifest.root) || !manifest.root.startsWith(privateRoot + "/") ||
    !Array.isArray(manifest.results) ||
    manifest.results.length !== (manifest.label === "test" ? 1 : 2))
  throw Error("Private stage manifest shape changed");
const image = "public.ecr.aws/supabase/edge-runtime:v1.74.3";
const imageId = "sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c";
const docker = "/usr/local/bin/docker";
const inspected = spawnSync(docker, ["image", "inspect", image, "--format", "{{.Id}}"],
  { encoding: "utf8", timeout: 15000 });
if (inspected.status !== 0 || inspected.stdout.trim() !== imageId)
  throw Error("Pinned Edge compiler image unavailable");
const cache = resolve(".verification-results/build01-slack-double-tick-test-baseline-20261015/rehearsal/cache");
if (realpathSync(cache) !== cache) throw Error("Pinned Deno cache unavailable");
const artifacts = join(manifest.root, "artifacts");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const results = [];
for (const target of manifest.results) {
  if (!["platform-worker", "recommendation-sync"].includes(target.slug) ||
      !target.stage.startsWith(manifest.root + "/") ||
      realpathSync(target.stage) !== target.stage ||
      !/^[a-f0-9]{64}$/.test(target.candidateHandlerSha256))
    throw Error("Candidate stage invalid");
  const slug = target.slug;
  const result = spawnSync(docker, ["run", "--rm", "--pull=never", "--network",
    dependencyNetwork ? "bridge" : "none",
    "--memory", "768m", "--cpus", "2", "--env", "DENO_DIR=/cache",
    "--mount", `type=bind,source=${target.stage},target=/work,readonly`,
    "--mount", `type=bind,source=${artifacts},target=/artifacts`,
    "--mount", `type=bind,source=${cache},target=/cache${dependencyNetwork ? "" : ",readonly"}`,
    "--workdir", "/work", image, "bundle", "--entrypoint",
    `/work/supabase/functions/${slug}/index.ts`, "--output", `/artifacts/${slug}.eszip`,
    "--checksum", "sha256", "--timeout", "55"],
    { encoding: "utf8", timeout: 65000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(artifacts, `${slug}.${dependencyNetwork ? "network" : "offline"}.compile.log`),
    `${result.stdout ?? ""}${result.stderr ?? ""}`, { mode: 0o600 });
  const output = { slug, status: result.status };
  if (result.status === 0) {
    const bytes = readFileSync(join(artifacts, `${slug}.eszip`));
    output.bytes = bytes.length;
    output.sha256 = sha(bytes);
    output.eszip = bytes.subarray(0, 5).equals(Buffer.from("ESZIP"));
  }
  results.push(output);
  if (result.status !== 0 || !output.eszip) break;
}
const report = { version: "learn-build01-recommendation-sweep-compile/1",
  compiledAtUtc: new Date().toISOString(), label: manifest.label, imageId,
  dependencyNetworkEnabled: dependencyNetwork,
  results, deployed: false };
writeFileSync(join(manifest.root,
  dependencyNetwork ? "compile-manifest-network.json" : "compile-manifest.json"),
  JSON.stringify(report, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
if (results.length !== manifest.results.length ||
    results.some(result => result.status !== 0 || !result.eszip)) process.exitCode = 1;
