/** Release reviewed Email worker changes onto the exact downloaded runtime. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { patchDeployedWorker, patchDeployedScheduler, sha256 } from
  "./learn-build01-current-email-deployed-overlay.mjs";
import { patchDeployedEmailRetry } from "./learn-build01-email-retry-deployed-overlay.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const mode = process.argv.slice(2).join(" ");
const configs = {
  "--test-worker": { project: TEST_PROJECT, label: "test-worker", endpoint: "platform-worker",
    priorVersion: 42, priorWire: "109d068add6e6fe053f2385dcf3193338261b83f8839a7fd37b3bef9eaf1444d",
    target: "_shared/worker_handlers/interactions_sync.ts", patch: patchDeployedWorker },
  "--test-scheduler": { project: TEST_PROJECT, label: "test-scheduler", endpoint: "interactions-scheduled-sync",
    priorVersion: 5, priorWire: "5390cc34dfa7231217e7ab5f082d4dfa8622afdc5816bd95310f7f5c5d67d042",
    target: "_shared/interactions_schedule_plan.ts", patch: patchDeployedScheduler },
  "--live-worker": { project: LIVE_PROJECT, label: "live-worker", endpoint: "platform-worker",
    priorVersion: 93, priorWire: "109d068add6e6fe053f2385dcf3193338261b83f8839a7fd37b3bef9eaf1444d",
    target: "_shared/worker_handlers/interactions_sync.ts", patch: patchDeployedWorker },
  "--live-scheduler": { project: LIVE_PROJECT, label: "live-scheduler", endpoint: "interactions-scheduled-sync",
    priorVersion: 50, priorWire: "5390cc34dfa7231217e7ab5f082d4dfa8622afdc5816bd95310f7f5c5d67d042",
    target: "_shared/interactions_schedule_plan.ts", patch: patchDeployedScheduler },
  "--test-retry-worker": { project: TEST_PROJECT, label: "test-retry-worker", endpoint: "platform-worker",
    priorVersion: 58, priorWire: "6646ccadfec21aff2145284761af6bed0a53f7c5570c4f8188a74b246fe727e4",
    target: "_shared/worker_handlers/interactions_sync.ts", patch: patchDeployedEmailRetry },
  "--live-retry-worker": { project: LIVE_PROJECT, label: "live-retry-worker", endpoint: "platform-worker",
    priorVersion: 99, priorWire: "6646ccadfec21aff2145284761af6bed0a53f7c5570c4f8188a74b246fe727e4",
    target: "_shared/worker_handlers/interactions_sync.ts", patch: patchDeployedEmailRetry },
};
const config = configs[mode];
if (!config || (config.project === TEST_PROJECT
    ? process.env.LEARN_TEST_ALLOW_PROJECT_REF : process.env.LEARN_LIVE_ALLOW_PROJECT_REF)
      !== config.project) throw Error("Explicit project and endpoint release mode required");
const token = savedCliToken();
const prefix = `.verification-results/build01-current-email-targeted-${config.label}`;
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior targeted deployment needs inspection");

async function inventory() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${config.project}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Runtime inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map(r => r.slug)).size !== rows.length)
    throw Error("Runtime inventory invalid");
  return rows;
}
const other = rows => rows.filter(r => r.slug !== config.endpoint)
  .map(r => ({ slug: r.slug, version: r.version, wire: r.ezbr_sha256,
    verifyJwt: r.verify_jwt })).sort((a,b) => a.slug.localeCompare(b.slug));
const before = await inventory();
const prior = before.find(r => r.slug === config.endpoint);
if (!prior || prior.version !== config.priorVersion ||
    prior.ezbr_sha256 !== config.priorWire || prior.status !== "ACTIVE" ||
    prior.verify_jwt !== false) throw Error("Targeted runtime baseline changed");

if (mode.startsWith("--live-")) {
  const tested = JSON.parse(readFileSync(prefix.replace("live-", "test-") + "-result.json", "utf8"));
  const currentTest = (await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  }).then(r => { if (!r.ok) throw Error("TEST inventory unconfirmed"); return r.json(); }))
    .find(r => r.slug === config.endpoint);
  if (tested.state !== "deployed_needs_acceptance" || tested.project !== TEST_PROJECT ||
      currentTest?.version !== tested.afterVersion ||
      currentTest?.ezbr_sha256 !== tested.afterWireSha ||
      currentTest?.status !== "ACTIVE") throw Error("Exact TEST release changed");
}

const sourceReady = await fetch(`https://api.supabase.com/v1/projects/${config.project}/database/query/read-only`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  redirect: "error", signal: AbortSignal.timeout(30000),
  body: JSON.stringify({ query: `select to_regprocedure('public.learn_projection_pending_current_email(uuid,integer)') is not null installed,
      has_function_privilege('service_role','public.learn_projection_pending_current_email(uuid,integer)'::regprocedure,'EXECUTE') service_execute` }),
});
if (!sourceReady.ok) throw Error("Email selector preflight unconfirmed");
const schema = await sourceReady.json();
if (!Array.isArray(schema) || schema[0]?.installed !== true || schema[0]?.service_execute !== true)
  throw Error("Current Email selector missing");

const body = await fetch(`https://api.supabase.com/v1/projects/${config.project}/functions/${config.endpoint}/body`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000),
});
if (!body.ok) throw Error("Rollback executable unconfirmed");
const rollback = Buffer.from(await body.arrayBuffer());
if (!rollback.subarray(0,5).equals(Buffer.from("ESZIP"))) throw Error("Rollback executable invalid");
writeFileSync(prefix + "-rollback.eszip", rollback, { flag: "wx", mode: 0o600 });

const work = mkdtempSync(join(tmpdir(), "build01-current-email-targeted-"));
let candidateSha = null, cliStatus = null, sourceFiles = 0;
try {
  const downloaded = join(work, "download");
  mkdirSync(downloaded, { mode: 0o700 });
  const fetchSource = spawnSync(cli, ["functions", "download", config.endpoint,
    "--project-ref", config.project, "--workdir", downloaded], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (fetchSource.status !== 0) throw Error("Deployed source download unconfirmed");
  const sourceRoot = join(downloaded, "supabase/functions", config.endpoint);
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
  if (files.length < 2 || files.length > 200 ||
      !files.some(f => f.rel === "index.ts")) throw Error("Downloaded closure invalid");
  const staged = [];
  let targetCount = 0;
  for (const file of files) {
    if (!/\.(ts|js|json)$/.test(file.rel)) throw Error("Downloaded source extension changed");
    const rel = file.rel.startsWith("functions/")
      ? file.rel.slice("functions/".length) : `${config.endpoint}/${file.rel}`;
    const dest = join(stage, "supabase/functions", rel);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    let source = readFileSync(file.path, "utf8");
    if (rel === config.target) { source = config.patch(source); targetCount++; }
    writeFileSync(dest, source, { mode: 0o600 });
    staged.push({ path: rel, sha256: sha256(source) });
  }
  if (targetCount !== 1 || new Set(staged.map(f => f.path)).size !== staged.length)
    throw Error("Targeted runtime source mapping changed");
  sourceFiles = staged.length;
  candidateSha = sha256(JSON.stringify(staged.sort((a,b) => a.path.localeCompare(b.path))));
  if (mode.startsWith("--live-")) {
    const tested = JSON.parse(readFileSync(prefix.replace("live-", "test-") + "-result.json", "utf8"));
    if (candidateSha !== tested.candidateSha256) throw Error("LIVE closure differs from TEST");
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${config.project}"\n[functions.${config.endpoint}]\nverify_jwt = false\n`, { mode: 0o600 });
  const journal = { state: "targeted_release_prepared", project: config.project,
    endpoint: config.endpoint, beforeVersion: prior.version, beforeWireSha: prior.ezbr_sha256,
    rollbackSha256: sha256(rollback), candidateSha256: candidateSha, sourceFiles,
    changedSourcePaths: [config.target], otherEndpoints: other(before) };
  writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  const deployed = spawnSync(cli, ["functions", "deploy", config.endpoint,
    "--project-ref", config.project, "--use-api", "--workdir", stage], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 2 * 1024 * 1024,
  });
  cliStatus = deployed.status;
} finally {
  rmSync(work, { recursive: true, force: true });
}
const after = await inventory();
const current = after.find(r => r.slug === config.endpoint);
const unchanged = JSON.stringify(other(before)) === JSON.stringify(other(after));
const state = cliStatus === 0 && current?.version === prior.version + 1 &&
  current?.status === "ACTIVE" && current?.verify_jwt === false &&
  current?.ezbr_sha256 !== prior.ezbr_sha256 && unchanged
  ? "deployed_needs_acceptance" : "requires_inspection";
const result = { state, project: config.project, endpoint: config.endpoint,
  beforeVersion: prior.version, afterVersion: current?.version ?? null,
  afterWireSha: current?.ezbr_sha256 ?? null, candidateSha256: candidateSha,
  sourceFiles, changedSourcePaths: [config.target], otherEndpointsUnchanged: unchanged,
  rollbackSha256: sha256(rollback), cliStatus, providerRequests: 0 };
writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
if (state !== "deployed_needs_acceptance") process.exitCode = 1;
