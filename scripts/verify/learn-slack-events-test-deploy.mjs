/** Deploy only the inactive signed receiver and paced event worker to TEST. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const endpoints = [
  { name: "learn-slack-worker", verifyJwt: true },
  { name: "learn-slack-events", verifyJwt: false },
];
if (process.argv.slice(2).join(" ") !== "--deploy-test-inactive" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit inactive TEST release required");
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const prefix = ".verification-results/learn-slack-events-test-deploy";
if (!existsSync(cli) || existsSync(prefix + "-journal.json") ||
    existsSync(prefix + "-result.json"))
  throw Error("TEST release prerequisites or prior attempt require inspection");
const token = savedCliToken();
const sha = (value) => createHash("sha256").update(value).digest("hex");
const bundles = endpoints.map((endpoint) => ({ ...endpoint,
  bundle: edgeRuntimeBundle([endpoint]) }));
for (const item of bundles) {
  if (!item.bundle.files.some((file) => file.path === `${item.name}/index.ts`))
    throw Error("Endpoint source closure incomplete");
}

async function inventory() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`TEST inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map((row) => row.slug)).size !== rows.length)
    throw Error("TEST inventory invalid");
  return rows;
}
const snapshot = (row) => ({ slug: row.slug, version: row.version,
  wireSha: row.ezbr_sha256, verifyJwt: row.verify_jwt, status: row.status });
const before = await inventory();
for (const endpoint of endpoints) {
  const row = before.find((candidate) => candidate.slug === endpoint.name);
  if (!row || row.status !== "ACTIVE" || row.verify_jwt !== endpoint.verifyJwt ||
      !Number.isSafeInteger(row.version) || typeof row.ezbr_sha256 !== "string")
    throw Error(`TEST baseline changed: ${endpoint.name}`);
}
const rollback = [];
for (const endpoint of endpoints) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions/${endpoint.name}/body`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`TEST rollback body HTTP ${response.status}: ${endpoint.name}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from("ESZIP")))
    throw Error(`TEST rollback executable invalid: ${endpoint.name}`);
  const file = `${prefix}-${endpoint.name}-rollback.eszip`;
  writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  rollback.push({ endpoint: endpoint.name, file, sha256: sha(bytes) });
}
const journal = { version: "learn-slack-events-test-deploy/1", project: TEST_PROJECT,
  observedAt: new Date().toISOString(), receiverActive: false, slackAppChanged: false,
  before: before.map(snapshot).sort((a, b) => a.slug.localeCompare(b.slug)),
  source: bundles.map((item) => ({ endpoint: item.name, closureSha: item.bundle.sha256,
    files: item.bundle.files.map((file) => ({ path: file.path, sha256: sha(file.source) })) })),
  rollback };
writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });

const deployed = [];
let issue = null;
for (const item of bundles) {
  const stage = mkdtempSync(join(tmpdir(), "learn-slack-events-test-"));
  try {
    for (const file of item.bundle.files) {
      const path = join(stage, "supabase/functions", file.path);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, file.source, { mode: 0o600 });
    }
    mkdirSync(join(stage, "supabase"), { recursive: true, mode: 0o700 });
    writeFileSync(join(stage, "supabase/config.toml"),
      `project_id = "${TEST_PROJECT}"\n[functions.${item.name}]\nverify_jwt = ${item.verifyJwt}\n`,
      { mode: 0o600 });
    const result = spawnSync(cli, ["functions", "deploy", item.name,
      "--project-ref", TEST_PROJECT, "--use-api", "--workdir", stage], {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
      timeout: 120000, maxBuffer: 2097152,
    });
    if (result.status !== 0) {
      issue = { endpoint: item.name, kind: "cli_failed", exitStatus: result.status,
        message: (result.stderr || result.stdout || "").slice(-300).replace(/sbp_[^\s]+/g, "[redacted]") };
      break;
    }
    const now = await inventory();
    const prior = before.find((row) => row.slug === item.name);
    const current = now.find((row) => row.slug === item.name);
    const expected = before.filter((row) => row.slug !== item.name &&
      !deployed.some((entry) => entry.endpoint === row.slug)).map(snapshot)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    const unchanged = now.filter((row) => row.slug !== item.name &&
      !deployed.some((entry) => entry.endpoint === row.slug)).map(snapshot)
      .sort((a, b) => a.slug.localeCompare(b.slug));
    if (!current || current.version !== prior.version + 1 ||
        current.verify_jwt !== item.verifyJwt || current.status !== "ACTIVE" ||
        current.ezbr_sha256 === prior.ezbr_sha256 ||
        JSON.stringify(expected) !== JSON.stringify(unchanged)) {
      issue = { endpoint: item.name, kind: "inventory_mismatch" };
      break;
    }
    deployed.push({ endpoint: item.name, beforeVersion: prior.version,
      afterVersion: current.version, afterWireSha: current.ezbr_sha256,
      sourceClosureSha: item.bundle.sha256 });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
const report = { state: issue ? "requires_inspection" : "deployed_inactive_needs_http_acceptance",
  project: TEST_PROJECT, completedAt: new Date().toISOString(), deployed, issue,
  receiverActive: false, slackAppChanged: false, productionChanged: false };
writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
if (issue) process.exitCode = 1;
