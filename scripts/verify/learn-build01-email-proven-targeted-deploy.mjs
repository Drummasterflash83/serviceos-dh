/** Release only the proven-delegation scheduling fix onto its deployed source. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { patchProvenSchedulerModule, sha256 } from "./learn-build01-email-proven-deployed-overlay.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const ENDPOINT = "email-workspace-scheduled-sync";
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const targets = [
  `${ENDPOINT}/index.ts`,
  "_shared/workspace_scheduler_selection.ts",
];
const mode = process.argv[2];
const config = mode === "--test"
  ? { project: TEST_PROJECT, label: "test", version: 16 }
  : mode === "--live"
  ? { project: LIVE_PROJECT, label: "live", version: 56 }
  : null;
if (!config || (config.label === "test"
    ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
    : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== config.project)
  throw Error("Explicit project and scheduler release mode required");
const priorWire = "080fd1515e0f51a7ccbbb6bbcc41b2e6f7da45de8a4065ddf87bdf2fb6db4bd5";
const prefix = `.verification-results/build01-email-proven-${config.label}`;
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior release needs inspection");
const token = savedCliToken();

async function inventory(project) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Runtime inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map(r => r.slug)).size !== rows.length)
    throw Error("Runtime inventory invalid");
  return rows;
}
const others = rows => rows.filter(r => r.slug !== ENDPOINT)
  .map(r => ({ slug: r.slug, version: r.version, wire: r.ezbr_sha256,
    verifyJwt: r.verify_jwt })).sort((a,b) => a.slug.localeCompare(b.slug));
const before = await inventory(config.project);
const prior = before.find(r => r.slug === ENDPOINT);
if (!prior || prior.version !== config.version || prior.ezbr_sha256 !== priorWire ||
    prior.status !== "ACTIVE" || prior.verify_jwt !== false)
  throw Error("Targeted scheduler baseline changed");
if (mode === "--live") {
  const tested = JSON.parse(readFileSync(
    `.verification-results/build01-email-proven-test-result.json`, "utf8"));
  const currentTest = (await inventory(TEST_PROJECT)).find(r => r.slug === ENDPOINT);
  if (tested.state !== "deployed_needs_acceptance" ||
      tested.project !== TEST_PROJECT ||
      // Hosted positive acceptance uses then removes a TEST-only schedule
      // secret; these two configuration revisions leave the wire unchanged.
      currentTest?.version !== tested.afterVersion + 2 ||
      currentTest?.ezbr_sha256 !== tested.afterWireSha ||
      currentTest?.status !== "ACTIVE") throw Error("Exact TEST release changed");
}

const body = await fetch(
  `https://api.supabase.com/v1/projects/${config.project}/functions/${ENDPOINT}/body`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
if (!body.ok) throw Error("Rollback executable unconfirmed");
const rollback = Buffer.from(await body.arrayBuffer());
if (!rollback.subarray(0, 5).equals(Buffer.from("ESZIP")))
  throw Error("Rollback executable invalid");
writeFileSync(prefix + "-rollback.eszip", rollback, { flag: "wx", mode: 0o600 });

const work = mkdtempSync(join(tmpdir(), "build01-email-proven-"));
let candidateSha = null, cliStatus = null, sourceFiles = 0;
try {
  const downloaded = join(work, "download");
  mkdirSync(downloaded, { mode: 0o700 });
  const fetched = spawnSync(cli, ["functions", "download", ENDPOINT,
    "--project-ref", config.project, "--workdir", downloaded], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (fetched.status !== 0) throw Error("Deployed source download unconfirmed");
  const sourceRoot = join(downloaded, "supabase/functions", ENDPOINT);
  const stage = join(work, "stage");
  const files = [];
  function collect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error("Downloaded source symlink");
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push({ path, rel: relative(sourceRoot, path) });
      else throw Error("Downloaded source nonfile");
    }
  }
  collect(sourceRoot);
  if (files.length < targets.length || files.length > 200 ||
      !files.some(f => f.rel === "index.ts")) throw Error("Downloaded closure invalid");
  const staged = [];
  const seenTargets = new Set();
  for (const file of files) {
    if (!/\.(ts|js|json)$/.test(file.rel)) throw Error("Downloaded extension changed");
    const rel = file.rel.startsWith("functions/")
      ? file.rel.slice("functions/".length) : `${ENDPOINT}/${file.rel}`;
    const dest = join(stage, "supabase/functions", rel);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    let source = readFileSync(file.path, "utf8");
    if (targets.includes(rel)) {
      source = patchProvenSchedulerModule(rel, source);
      seenTargets.add(rel);
    }
    writeFileSync(dest, source, { mode: 0o600 });
    staged.push({ path: rel, sha256: sha256(source) });
  }
  if (seenTargets.size !== targets.length ||
      new Set(staged.map(f => f.path)).size !== staged.length)
    throw Error("Targeted source mapping changed");
  sourceFiles = staged.length;
  candidateSha = sha256(JSON.stringify(staged.sort((a,b) => a.path.localeCompare(b.path))));
  if (mode === "--live") {
    const tested = JSON.parse(readFileSync(
      `.verification-results/build01-email-proven-test-result.json`, "utf8"));
    if (candidateSha !== tested.candidateSha256) throw Error("LIVE closure differs from TEST");
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${config.project}"\n[functions.${ENDPOINT}]\nverify_jwt = false\n`,
    { mode: 0o600 });
  const journal = { state: "targeted_release_prepared", project: config.project,
    endpoint: ENDPOINT, beforeVersion: prior.version, beforeWireSha: prior.ezbr_sha256,
    rollbackSha256: sha256(rollback), candidateSha256: candidateSha, sourceFiles,
    changedSourcePaths: targets, otherEndpoints: others(before) };
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  const deployed = spawnSync(cli, ["functions", "deploy", ENDPOINT,
    "--project-ref", config.project, "--use-api", "--workdir", stage], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 2 * 1024 * 1024,
  });
  cliStatus = deployed.status;
} finally {
  rmSync(work, { recursive: true, force: true });
}
const after = await inventory(config.project);
const current = after.find(r => r.slug === ENDPOINT);
const unchanged = JSON.stringify(others(before)) === JSON.stringify(others(after));
const state = cliStatus === 0 && current?.version === prior.version + 1 &&
  current?.status === "ACTIVE" && current?.verify_jwt === false &&
  current?.ezbr_sha256 !== prior.ezbr_sha256 && unchanged
  ? "deployed_needs_acceptance" : "requires_inspection";
const result = { state, project: config.project, endpoint: ENDPOINT,
  beforeVersion: prior.version, afterVersion: current?.version ?? null,
  afterWireSha: current?.ezbr_sha256 ?? null, candidateSha256: candidateSha,
  sourceFiles, changedSourcePaths: targets, otherEndpointsUnchanged: unchanged,
  rollbackSha256: sha256(rollback), cliStatus, providerRequests: 0 };
writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
if (state !== "deployed_needs_acceptance") process.exitCode = 1;
