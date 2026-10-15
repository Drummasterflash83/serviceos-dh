/** One new internal diagnostic endpoint. No database or provider write is made here. */
import { spawnSync } from "node:child_process";
import { closeSync, fsyncSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const NAME = "learn-email-mailbox-source-probe";
const PIN = "3b47a110d5810f213f48ef88c72374d3dc5d3e71a7c89bb253a07c6f4256feb9";
const CLI = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const mode = process.argv.slice(2).join(" ");
const project = ["--deploy-test", "--replace-test-v1"].includes(mode) ? TEST_PROJECT :
  mode === "--deploy-live" ? LIVE_PROJECT : null;
if (!project) throw Error("Explicit TEST or LIVE endpoint release required");
const replacing = mode === "--replace-test-v1";
const bundle = edgeRuntimeBundle([{ name: NAME, verifyJwt: true }]);
if (bundle.sha256 !== PIN || bundle.external.join("|") !== "https://esm.sh/@supabase/supabase-js@2.45.4")
  throw Error("Reviewed source closure changed");
const token = savedCliToken();
async function management(path) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Project inventory unavailable (${response.status})`);
  return response.json();
}
function catalog(rows) {
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.slug !== "string" ||
    !Number.isInteger(r.version) || typeof r.verify_jwt !== "boolean" ||
    typeof r.status !== "string") || new Set(rows.map((r) => r.slug)).size !== rows.length)
    throw Error("Incomplete Edge inventory");
  return rows.map(({ slug, id, version, verify_jwt, status, ezbr_sha256 }) =>
    ({ slug, id, version, verify_jwt, status, ezbr_sha256 })).sort((a, b) => a.slug.localeCompare(b.slug));
}
const before = catalog(await management("/functions"));
const priorTarget = before.find((r) => r.slug === NAME);
if (replacing ? !priorTarget || priorTarget.version !== 1 || priorTarget.status !== "ACTIVE" ||
  priorTarget.verify_jwt !== false : !!priorTarget)
  throw Error("Exact expected endpoint version required before release");
const path = `.verification-results/${NAME}-${mode.slice(2)}-${Date.now()}.json`;
const journal = { version: "learn-email-mailbox-source-probe-release/1", project,
  sourceSha256: PIN, previousEndpointCount: before.length, targetBefore: priorTarget ?? null,
  startedAt: new Date().toISOString(), state: "release_prepared" };
const fd = openSync(path, "wx", 0o600);
try { writeSync(fd, JSON.stringify(journal, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
const stage = mkdtempSync(join(tmpdir(), "learn-mailbox-proof-"));
let submitted = false;
let cliExitStatus = null;
try {
  for (const file of bundle.files) {
    const destination = join(stage, "supabase/functions", file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.source);
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${project}"\n[functions.${NAME}]\nverify_jwt = true\n`);
  submitted = true;
  const result = spawnSync(CLI, ["functions", "deploy", NAME, "--project-ref", project,
    "--use-api", "--workdir", stage], { env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    encoding: "utf8", timeout: 120000, maxBuffer: 2097152 });
  cliExitStatus = result.status;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
let after = null;
try { after = catalog(await management("/functions")); } catch { /* Unknown outcome needs inspection. */ }
const target = after?.find((r) => r.slug === NAME);
const existingPreserved = !!after && JSON.stringify(before) ===
  JSON.stringify(after.filter((r) => r.slug !== NAME).concat(priorTarget ? [priorTarget] : [])
    .sort((a, b) => a.slug.localeCompare(b.slug)));
const state = cliExitStatus === 0 && target?.version === (replacing ? 2 : 1) &&
  target.status === "ACTIVE" && target.verify_jwt === true &&
  after.length === before.length + (replacing ? 0 : 1) && existingPreserved
  ? "deployed_needs_http_acceptance" : "requires_inspection";
const report = { ...journal, finishedAt: new Date().toISOString(), state, submitted,
  cliExitStatus, endpoint: target ?? null, existingPreserved, endpointCountAfter: after?.length ?? null,
  sourceFiles: bundle.files.length, providerRequests: 0, databaseWrites: 0 };
writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ state, project, cliExitStatus, endpoint: target && {
  slug: target.slug, version: target.version, verify_jwt: target.verify_jwt, status: target.status },
  existingPreserved, sourceFiles: bundle.files.length, journal: path }));
if (state !== "deployed_needs_http_acceptance") process.exitCode = 1;
