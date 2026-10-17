/** Verify LIVE v112 source is pinned v111 plus one committed identity handler. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const recRoot = ".verification-results/build01-rec-sweep-live-OhSoce";
const identityRoot = ".verification-results/build01-identity-diagnostic-live-emYAlt";
const prior = JSON.parse(readFileSync(
  "docs/operations/evidence/learn-build01-current-processing-overlay-2026-10-17-1707.json"));
const recBuild = JSON.parse(readFileSync(join(recRoot, "compile-manifest-network.json")));
const stage = JSON.parse(readFileSync(join(identityRoot, "manifest.json")));
const build = JSON.parse(readFileSync(join(identityRoot, "compile-manifest-network.json")));
const release = JSON.parse(readFileSync(join(identityRoot, "deploy-journal.json")));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
if (prior.platformWorker.version !== 111 ||
  prior.platformWorker.sourceFilesReconstructed !== 119 ||
  prior.platformWorker.pinnedBuildMatchesServingExecutable !== true ||
  stage.version !== "learn-build01-identity-diagnostic-stage/1" ||
  stage.project !== project || stage.label !== "live" || stage.results.length !== 1 ||
  stage.results[0].slug !== "platform-worker" || stage.results[0].version !== 111 ||
  stage.results[0].sourceFiles !== 119 ||
  stage.results[0].beforeBodySha256 !== recBuild.results[0].sha256 ||
  build.results[0].sha256 !== release.completed[0]?.bodySha256 ||
  release.state !== "exact_candidates_deployed" ||
  release.completed[0]?.version !== 112)
  throw Error("Pinned v111-to-v112 source chain changed");
const candidate = readFileSync("supabase/functions/_shared/worker_handlers/identity_resolve.ts");
if (sha(candidate) !== stage.results[0].candidateHandlerSha256)
  throw Error("Git identity handler differs from staged candidate");
const sourceRoot = join(identityRoot, "platform-worker/supabase/functions/platform-worker");
const stageRoot = join(identityRoot, "platform-worker/stage/supabase/functions");
function walk(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const files = walk(sourceRoot);
if (files.length !== 119) throw Error("Current worker source file count changed");
const target = "_shared/worker_handlers/identity_resolve.ts";
let changed = 0;
const manifest = [];
for (const path of files) {
  const fromSlug = relative(sourceRoot, path).replaceAll("\\", "/");
  const mapped = fromSlug.startsWith("functions/")
    ? fromSlug.slice("functions/".length) : `platform-worker/${fromSlug}`;
  const staged = readFileSync(join(stageRoot, mapped));
  if (sha(readFileSync(path)) !== sha(staged)) {
    if (mapped !== target || sha(staged) !== sha(candidate))
      throw Error("Staged closure changed outside identity handler");
    changed++;
  }
  manifest.push({ path: mapped, sha256: sha(staged) });
}
if (changed !== 1 || sha(JSON.stringify(manifest.sort((a, b) =>
  a.path.localeCompare(b.path)))) !== stage.results[0].closureSha256)
  throw Error("Exact staged source closure unconfirmed");
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
  headers: { Authorization: `Bearer ${savedCliToken()}` }, redirect: "error",
  signal: AbortSignal.timeout(45000),
});
if (!response.ok) throw Error(`LIVE Edge inventory HTTP ${response.status}`);
const worker = (await response.json()).find(item => item.slug === "platform-worker");
if (worker?.version !== 112 || worker.status !== "ACTIVE" ||
  worker.ezbr_sha256 !== release.completed[0].wireSha256)
  throw Error("LIVE worker version or executable changed");
const body = await fetch(`https://api.supabase.com/v1/projects/${project}/functions/platform-worker/body`, {
  headers: { Authorization: `Bearer ${savedCliToken()}` }, redirect: "error",
  signal: AbortSignal.timeout(45000),
});
if (!body.ok || sha(Buffer.from(await body.arrayBuffer())) !== build.results[0].sha256)
  throw Error("LIVE serving worker body differs from staged build");
console.log(JSON.stringify({ version: "learn-build01-identity-diagnostic-source-overlay/1",
  observedAtUtc: new Date().toISOString(), project, priorWorkerVersion: 111,
  currentWorkerVersion: 112, sourceFiles: files.length,
  changedSourceFiles: changed, changedPath: target,
  currentBodySha256: build.results[0].sha256,
  offsiteBaseAndGitChainVerified: true, sourceContentReturned: false,
  credentialsRecovered: false, providerRestartProven: false,
  productionDataWrites: false }));
