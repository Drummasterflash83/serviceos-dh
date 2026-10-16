/** Add event handling to exact LIVE Slack worker source, preserving history code. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { savedCliToken } from "./learn-test-readiness.mjs";
import { patchLiveSlackEventWorker, sha256 } from "./learn-slack-event-live-worker-overlay.mjs";

const project = "tgbnakbxwcqjeimygroz", name = "learn-slack-worker";
if (process.argv.slice(2).join(" ") !== "--deploy-live-inactive" ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error("Exact LIVE inactive worker release required");
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const token = savedCliToken();
const prefix = ".verification-results/learn-slack-event-live-worker";
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior LIVE worker release requires inspection");
const baselineRoot = prefix + "-baseline/supabase/functions/" + name;
const priorManifestSha = "e82318f506116e603c03fede1c61b4921485f8b93d1ae251410d9a6b79dd83f6";
const newFiles = [
  ["_shared/slack/slack_event_reconcile.ts", "a2405b7a264ce025804e9c929cde0c3b2acf0b2408f36c54ec231fc60e18eb3b"],
  ["_shared/slack/slack_event_worker.ts", "bcd34491f2365f4c09664d642ed619eab0246476e54804eb68b1815c113dfce2"],
  ["_shared/worker_contract.ts", "89e929a994b698bc3f25b045b574aedebad6940a7aa36d0d1a6b7a07fdc1826b"],
];
function collect(root) {
  const files = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push({ path, rel: relative(root, path) });
      else throw Error("LIVE worker source contains unsupported entry");
    }
  }
  walk(root);
  return files.sort((a, b) => a.rel.localeCompare(b.rel));
}
const baseline = collect(baselineRoot);
const manifestSha = sha256(JSON.stringify(baseline.map(file =>
  ({ path: file.rel, sha256: sha256(readFileSync(file.path)) }))));
if (baseline.length !== 17 || manifestSha !== priorManifestSha)
  throw Error("Saved LIVE worker source closure changed");
for (const [path, expected] of newFiles) {
  if (sha256(readFileSync(join("supabase/functions", path))) !== expected)
    throw Error(`Event module changed: ${path}`);
}
async function inventory() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error("LIVE Edge inventory unavailable");
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map(row => row.slug)).size !== rows.length)
    throw Error("LIVE Edge inventory invalid");
  return rows;
}
const others = rows => rows.filter(row => row.slug !== name)
  .map(row => ({ slug: row.slug, version: row.version, wire: row.ezbr_sha256,
    verifyJwt: row.verify_jwt, status: row.status }))
  .sort((a, b) => a.slug.localeCompare(b.slug));
const before = await inventory();
const prior = before.find(row => row.slug === name);
if (prior?.version !== 16 || prior?.ezbr_sha256 !==
    "8ac9af8ac9dc155e63e96c9fbcd0c3f7f8e4383425e1193d445da3339a0e36c8" ||
    prior?.verify_jwt !== true || prior?.status !== "ACTIVE" ||
    before.find(row => row.slug === "learn-slack-events")?.ezbr_sha256 !==
      "ec5cbf11210183134805b377626d63d5defc00f9608850bd2062020024237fb2")
  throw Error("LIVE Slack worker/receiver baseline changed");
const body = await fetch(`https://api.supabase.com/v1/projects/${project}/functions/${name}/body`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!body.ok) throw Error("LIVE worker rollback executable unavailable");
const rollback = Buffer.from(await body.arrayBuffer());
if (!rollback.subarray(0, 5).equals(Buffer.from("ESZIP")))
  throw Error("LIVE worker rollback executable invalid");
writeFileSync(prefix + "-rollback.eszip", rollback, { flag: "wx", mode: 0o600 });
const stage = mkdtempSync(join(tmpdir(), "learn-slack-live-worker-"));
let cliStatus = null, candidateSha256 = null;
try {
  const staged = [];
  for (const file of baseline) {
    const target = file.rel.startsWith("functions/")
      ? file.rel.slice("functions/".length) : `${name}/${file.rel}`;
    const dest = join(stage, "supabase/functions", target);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    let source = readFileSync(file.path, "utf8");
    if (["index.ts", "functions/_shared/slack/slack_worker.ts"].includes(file.rel))
      source = patchLiveSlackEventWorker(file.rel, source);
    writeFileSync(dest, source, { mode: 0o600 });
    staged.push({ path: target, sha256: sha256(source) });
  }
  for (const [path] of newFiles) {
    const dest = join(stage, "supabase/functions", path);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    const source = readFileSync(join("supabase/functions", path), "utf8");
    writeFileSync(dest, source, { mode: 0o600 });
    staged.push({ path, sha256: sha256(source) });
  }
  if (staged.length !== 20 || new Set(staged.map(file => file.path)).size !== 20)
    throw Error("LIVE worker staged closure invalid");
  candidateSha256 = sha256(JSON.stringify(staged.sort((a, b) => a.path.localeCompare(b.path))));
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${project}"\n[functions.${name}]\nverify_jwt = true\n`, { mode: 0o600 });
  writeFileSync(prefix + "-journal.json", JSON.stringify({ state: "prepared",
    project, beforeVersion: prior.version, beforeWireSha: prior.ezbr_sha256,
    baselineManifestSha256: manifestSha, candidateSha256,
    rollbackSha256: sha256(rollback), changedModules: ["index.ts",
      "_shared/slack/slack_worker.ts", ...newFiles.map(file => file[0])],
    otherEndpoints: others(before) }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  const result = spawnSync(cli, ["functions", "deploy", name,
    "--project-ref", project, "--use-api", "--workdir", stage], {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
      timeout: 120000, maxBuffer: 2 * 1024 * 1024,
    });
  cliStatus = result.status;
} finally { rmSync(stage, { recursive: true, force: true }); }
const after = await inventory();
const current = after.find(row => row.slug === name);
const otherEndpointsUnchanged = JSON.stringify(others(before)) === JSON.stringify(others(after));
const state = cliStatus === 0 && current?.version === prior.version + 1 &&
  current?.ezbr_sha256 !== prior.ezbr_sha256 && current?.status === "ACTIVE" &&
  current?.verify_jwt === true && otherEndpointsUnchanged
  ? "deployed_inactive_needs_acceptance" : "requires_inspection";
const receipt = { state, project, endpoint: name, beforeVersion: prior.version,
  afterVersion: current?.version ?? null, beforeWireSha: prior.ezbr_sha256,
  afterWireSha: current?.ezbr_sha256 ?? null, candidateSha256,
  otherEndpointsUnchanged, cliStatus, receiverActive: false, slackAppChanged: false,
  providerRequestsByRelease: 0 };
writeFileSync(prefix + "-result.json", JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state !== "deployed_inactive_needs_acceptance") process.exitCode = 1;
