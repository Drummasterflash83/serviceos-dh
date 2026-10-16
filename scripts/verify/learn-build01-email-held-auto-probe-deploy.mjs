/** One-function, version-pinned TEST/LIVE release of bounded held-mailbox rechecks. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const ENDPOINT = "email-workspace-scheduled-sync";
const CLI = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const PRIOR_WIRE = "a69275002fea0dc569571db172c663f3f65c06545950c4b4f3ba79ffc968e235";
const CANDIDATE_SOURCE = "cee02409fd9cd4075e5220be1939cdaba4482e798bd713e6071916c157ff6e6d";
const mode = process.argv.slice(2).join(" ");
const config = mode === "--test" ? { project: TEST_PROJECT, version: 22, label: "test" } :
  mode === "--live" ? { project: LIVE_PROJECT, version: 62, label: "live" } : null;
if (!config || process.env[config.label === "test" ? "LEARN_TEST_ALLOW_PROJECT_REF" :
  "LEARN_LIVE_ALLOW_PROJECT_REF"] !== config.project)
  throw Error("Exact reviewed TEST or LIVE project required");
const prefix = `.verification-results/build01-email-held-auto-probe-${config.label}`;
if (existsSync(`${prefix}-journal.json`) || existsSync(`${prefix}-result.json`))
  throw Error("Previous attempt needs inspection");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const bundle = edgeRuntimeBundle([{ name: ENDPOINT, verifyJwt: false }]);
if (bundle.sha256 !== CANDIDATE_SOURCE || bundle.files.length !== 6 ||
  !bundle.files.some((file) => file.path === "_shared/workspace_held_probe.ts"))
  throw Error("Reviewed source closure changed");
const token = savedCliToken();
async function inventory(project) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Function inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map((row) => row.slug)).size !== rows.length)
    throw Error("Function inventory changed");
  return rows;
}
const others = (rows) => rows.filter((row) => row.slug !== ENDPOINT)
  .map((row) => ({ slug: row.slug, version: row.version,
    wire: row.ezbr_sha256, verifyJwt: row.verify_jwt }))
  .sort((a, b) => a.slug.localeCompare(b.slug));
const before = await inventory(config.project);
const prior = before.find((row) => row.slug === ENDPOINT);
if (!prior || prior.version !== config.version || prior.ezbr_sha256 !== PRIOR_WIRE ||
  prior.status !== "ACTIVE" || prior.verify_jwt !== false)
  throw Error("Exact scheduler baseline changed");
if (config.label === "live") {
  const test = JSON.parse(readFileSync(
    ".verification-results/build01-email-held-auto-probe-test-result.json", "utf8"));
  const acceptance = JSON.parse(readFileSync(
    ".verification-results/build01-email-held-auto-probe-test-acceptance.json", "utf8"));
  const currentTest = (await inventory(TEST_PROJECT)).find((row) => row.slug === ENDPOINT);
  if (test.state !== "deployed_needs_acceptance" ||
    test.sourceClosureSha !== CANDIDATE_SOURCE ||
    acceptance.negativeBoundaryPassed !== true ||
    currentTest?.version !== test.afterVersion ||
    currentTest?.ezbr_sha256 !== test.afterWire || currentTest?.status !== "ACTIVE")
    throw Error("TEST acceptance or exact candidate changed");
}
const body = await fetch(`https://api.supabase.com/v1/projects/${config.project}/functions/${ENDPOINT}/body`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!body.ok) throw Error("Rollback executable unavailable");
const rollback = Buffer.from(await body.arrayBuffer());
if (!rollback.subarray(0, 5).equals(Buffer.from("ESZIP")))
  throw Error("Rollback executable invalid");
writeFileSync(`${prefix}-rollback.eszip`, rollback, { flag: "wx", mode: 0o600 });
const journal = { version: "learn-build01-email-held-auto-probe/1", project: config.project,
  endpoint: ENDPOINT, observedAt: new Date().toISOString(),
  before: { version: prior.version, wire: prior.ezbr_sha256,
    verifyJwt: prior.verify_jwt, rollbackSha: sha(rollback) },
  sourceClosureSha: bundle.sha256,
  sourceFiles: bundle.files.map((file) => ({ path: file.path, sha: sha(file.source) })),
  otherEndpoints: others(before) };
writeFileSync(`${prefix}-journal.json`, JSON.stringify(journal, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
const stage = mkdtempSync(join(tmpdir(), "learn-build01-email-held-auto-probe-"));
let cliExitStatus = null;
try {
  for (const file of bundle.files) {
    const path = join(stage, "supabase/functions", file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.source, { mode: 0o600 });
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${config.project}"\n[functions.${ENDPOINT}]\nverify_jwt = false\n`,
    { mode: 0o600 });
  const result = spawnSync(CLI, ["functions", "deploy", ENDPOINT,
    "--project-ref", config.project, "--use-api", "--workdir", stage], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 2097152,
  });
  cliExitStatus = result.status;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
const after = await inventory(config.project);
const current = after.find((row) => row.slug === ENDPOINT);
const unchanged = JSON.stringify(others(before)) === JSON.stringify(others(after));
const state = cliExitStatus === 0 && current?.version === prior.version + 1 &&
  current?.status === "ACTIVE" && current?.verify_jwt === false &&
  current.ezbr_sha256 !== PRIOR_WIRE && unchanged
  ? "deployed_needs_acceptance" : "requires_inspection";
const report = { state, project: config.project, endpoint: ENDPOINT, cliExitStatus,
  beforeVersion: prior.version, afterVersion: current?.version ?? null,
  afterWire: current?.ezbr_sha256 ?? null, sourceClosureSha: bundle.sha256,
  rollbackSha: sha(rollback), otherEndpointsUnchanged: unchanged,
  sourceProviderWrites: 0 };
writeFileSync(`${prefix}-result.json`, JSON.stringify(report, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
if (state !== "deployed_needs_acceptance") process.exitCode = 1;
