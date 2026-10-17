/** Exact-baseline, one-file platform-worker release for card freshness. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { BASELINE_SHA256, patchDeployedCardFreshness, sha256 }
  from "./learn-build01-card-freshness-deployed-overlay.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const mode = process.argv.slice(2).join(" ");
const config = mode === "--test --existing-cli-login"
  ? { project: TEST_PROJECT, label: "test", version: 68 }
  : mode === "--live --existing-cli-login"
  ? { project: LIVE_PROJECT, label: "live", version: 109 } : null;
if (!config || (config.label === "test" ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== config.project)
  throw Error("Exact TEST or LIVE worker deployment allowlist required");
const CLI = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const ENDPOINT = "platform-worker";
const EXPECTED_WIRE = "cc502eabcfb071cb0c3338af66ca5431731f5c8f67dcbc85635fe7870995f1d8";
const TARGET = "_shared/worker_handlers/customer_card_sync.ts";
const prefix = `.verification-results/build01-card-freshness-worker-${config.label}`;
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior card freshness release requires inspection");
const token = savedCliToken();

async function inventory(project) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Worker inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map((row) => row.slug)).size !== rows.length)
    throw Error("Worker inventory invalid");
  return rows;
}
const otherFunctions = (rows) => rows.filter((row) => row.slug !== ENDPOINT)
  .map((row) => [row.slug, row.version, row.ezbr_sha256, row.verify_jwt])
  .sort((a, b) => a[0].localeCompare(b[0]));
const before = await inventory(config.project);
const prior = before.find((row) => row.slug === ENDPOINT);
if (prior?.version !== config.version || prior?.ezbr_sha256 !== EXPECTED_WIRE ||
    prior.status !== "ACTIVE" || prior.verify_jwt !== false)
  throw Error("Exact current worker baseline changed");
if (config.label === "live") {
  const tested = JSON.parse(readFileSync(
    ".verification-results/build01-card-freshness-hosted-test-result.json", "utf8"));
  const testWorker = (await inventory(TEST_PROJECT)).find((row) => row.slug === ENDPOINT);
  if (tested.state !== "accepted" || tested.workerVersion !== testWorker?.version ||
      tested.workerWireSha256 !== testWorker?.ezbr_sha256 ||
      testWorker?.status !== "ACTIVE")
    throw Error("Exact TEST hosted card freshness acceptance missing");
}

const body = await fetch(`https://api.supabase.com/v1/projects/${config.project}/functions/${ENDPOINT}/body`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!body.ok) throw Error("Rollback worker executable unavailable");
const rollback = Buffer.from(await body.arrayBuffer());
if (!rollback.subarray(0, 5).equals(Buffer.from("ESZIP")))
  throw Error("Rollback worker executable invalid");
writeFileSync(prefix + "-rollback.eszip", rollback, { flag: "wx", mode: 0o600 });
const work = mkdtempSync(join(tmpdir(), "build01-card-freshness-worker-"));
let candidateSha256 = null, candidateClosureSha256 = null;
let sourceFiles = 0, cliStatus = null;
try {
  const download = join(work, "download");
  mkdirSync(download, { mode: 0o700 });
  const fetched = spawnSync(CLI, ["functions", "download", ENDPOINT,
    "--project-ref", config.project, "--workdir", download], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (fetched.status !== 0) throw Error("Current worker source download unavailable");
  const sourceRoot = join(download, "supabase/functions", ENDPOINT);
  const stage = join(work, "stage"), files = [];
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error("Downloaded worker source symlink");
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push({ path, rel: relative(sourceRoot, path) });
      else throw Error("Downloaded worker source nonfile");
    }
  }
  collect(sourceRoot);
  if (files.length < 100 || files.length > 200 ||
      !files.some((file) => file.rel === "index.ts"))
    throw Error("Downloaded worker closure changed");
  let patched = 0;
  const manifest = [];
  for (const file of files) {
    if (!/\.(ts|js|json)$/.test(file.rel) || file.rel.includes(".."))
      throw Error("Unexpected worker source path");
    const rel = file.rel.startsWith("functions/")
      ? file.rel.slice("functions/".length) : `${ENDPOINT}/${file.rel}`;
    const targetPath = join(stage, "supabase/functions", rel);
    mkdirSync(dirname(targetPath), { recursive: true, mode: 0o700 });
    let source = readFileSync(file.path, "utf8");
    if (rel === TARGET) {
      if (sha256(source) !== BASELINE_SHA256)
        throw Error("Exact card handler baseline changed");
      source = patchDeployedCardFreshness(source);
      candidateSha256 = sha256(source);
      patched++;
    }
    writeFileSync(targetPath, source, { mode: 0o600 });
    manifest.push({ path: rel, sha256: sha256(source) });
  }
  if (patched !== 1 || new Set(manifest.map((entry) => entry.path)).size !== manifest.length)
    throw Error("Targeted worker mapping changed");
  sourceFiles = manifest.length;
  candidateClosureSha256 = sha256(JSON.stringify(
    manifest.sort((a, b) => a.path.localeCompare(b.path))));
  if (config.label === "live") {
    const tested = JSON.parse(readFileSync(
      ".verification-results/build01-card-freshness-hosted-test-result.json", "utf8"));
    if (candidateClosureSha256 !== tested.candidateClosureSha256 ||
        candidateSha256 !== tested.candidateHandlerSha256)
      throw Error("LIVE worker candidate differs from TEST acceptance");
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${config.project}"\n[functions.${ENDPOINT}]\nverify_jwt = false\n`,
    { mode: 0o600 });
  writeFileSync(prefix + "-journal.json", JSON.stringify({ state: "prepared",
    project: config.project, beforeVersion: prior.version,
    beforeWireSha256: prior.ezbr_sha256, rollbackSha256: sha256(rollback),
    baselineHandlerSha256: BASELINE_SHA256, candidateHandlerSha256: candidateSha256,
    candidateClosureSha256, sourceFiles, changedSourcePaths: [TARGET],
    otherFunctions: otherFunctions(before) }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  const deployed = spawnSync(CLI, ["functions", "deploy", ENDPOINT,
    "--project-ref", config.project, "--use-api", "--workdir", stage], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 120000, maxBuffer: 2 * 1024 * 1024,
  });
  cliStatus = deployed.status;
} finally {
  rmSync(work, { recursive: true, force: true });
}
const after = await inventory(config.project);
const current = after.find((row) => row.slug === ENDPOINT);
const unchangedOthers = JSON.stringify(otherFunctions(before)) === JSON.stringify(otherFunctions(after));
const passed = cliStatus === 0 && current?.version === config.version + 1 &&
  current?.status === "ACTIVE" && current?.verify_jwt === false &&
  current?.ezbr_sha256 !== EXPECTED_WIRE && unchangedOthers;
const result = { state: passed ? "deployed_needs_hosted_acceptance" : "requires_inspection",
  project: config.project, beforeVersion: config.version,
  afterVersion: current?.version ?? null, beforeWireSha256: EXPECTED_WIRE,
  afterWireSha256: current?.ezbr_sha256 ?? null,
  candidateHandlerSha256: candidateSha256, candidateClosureSha256, sourceFiles,
  changedSourcePaths: [TARGET], otherFunctionsUnchanged: unchangedOthers,
  cliStatus, productionChanged: config.label === "live", providerRequests: 0 };
writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
if (!passed) process.exitCode = 1;
