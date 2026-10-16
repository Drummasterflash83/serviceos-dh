/** Deploy the signed Slack receiver to LIVE with no active signing configuration. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz", name = "learn-slack-events";
if (process.argv.slice(2).join(" ") !== "--deploy-live-inactive" ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error("Exact LIVE inactive receiver release required");
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const receiptPath = ".verification-results/learn-slack-event-live-receiver-result.json";
if (existsSync(receiptPath)) throw Error("Prior LIVE receiver release requires inspection");
const token = savedCliToken();
const secrets = spawnSync(cli, ["secrets", "list", "--project-ref", project], {
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8", timeout: 90000,
});
if (secrets.status !== 0 || secrets.stdout.split("\n").some(line =>
  /^LEARN_SLACK_EVENTS_[A-Z0-9_]+$/.test(line.split("|")[0].trim())))
  throw Error("LIVE receiver signing configuration is not confirmed absent");
const bundle = edgeRuntimeBundle([{ name, verifyJwt: false }]);
if (bundle.files.length !== 4 || !bundle.files.some(file => file.path === `${name}/index.ts`))
  throw Error("LIVE receiver source closure changed");
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
  .map(row => ({ slug: row.slug, version: row.version,
    wire: row.ezbr_sha256, verifyJwt: row.verify_jwt, status: row.status }))
  .sort((a, b) => a.slug.localeCompare(b.slug));
const before = await inventory();
if (before.some(row => row.slug === name)) throw Error("LIVE receiver already exists");
const work = mkdtempSync(join(tmpdir(), "learn-slack-live-receiver-"));
let cliStatus = null;
try {
  for (const file of bundle.files) {
    const path = join(work, "supabase/functions", file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.source, { mode: 0o600 });
  }
  writeFileSync(join(work, "supabase/config.toml"),
    `project_id = "${project}"\n[functions.${name}]\nverify_jwt = false\n`, { mode: 0o600 });
  const result = spawnSync(cli, ["functions", "deploy", name,
    "--project-ref", project, "--use-api", "--workdir", work], {
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
      timeout: 120000, maxBuffer: 2 * 1024 * 1024,
    });
  cliStatus = result.status;
} finally { rmSync(work, { recursive: true, force: true }); }
const after = await inventory();
const current = after.find(row => row.slug === name);
const otherEndpointsUnchanged = JSON.stringify(others(before)) === JSON.stringify(others(after));
const endpoint = `https://${project}.supabase.co/functions/v1/${name}`;
const post = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
  body: "{}", signal: AbortSignal.timeout(30000) });
const get = await fetch(endpoint, { method: "GET", signal: AbortSignal.timeout(30000) });
const state = cliStatus === 0 && current?.version === 1 && current.status === "ACTIVE" &&
  current.verify_jwt === false && otherEndpointsUnchanged && post.status === 503 &&
  get.status === 405 ? "deployed_inactive" : "requires_inspection";
const receipt = { state, project, endpoint: name, version: current?.version ?? null,
  wireSha256: current?.ezbr_sha256 ?? null, sourceClosureSha256: bundle.sha256,
  sourceFiles: bundle.files.map(file => ({ path: file.path,
    sha256: createHash("sha256").update(file.source).digest("hex") })),
  otherEndpointsUnchanged, postStatus: post.status, getStatus: get.status,
  signingConfigurationPresent: false, slackAppChanged: false,
  providerRequests: 0, cliStatus };
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(receipt));
if (state !== "deployed_inactive") process.exitCode = 1;
