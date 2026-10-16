/** One-function TEST release of independent Phone and Email projection scheduling. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const phase = process.argv.slice(2).join(" ");
const priorityPhase = phase === "--deploy-test-priority";
if (!["--deploy-test", "--deploy-test-priority"].includes(phase) ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST deployment required");

const endpoint = "interactions-scheduled-sync";
const prior = priorityPhase
  ? { version: 4, wireSha: "ca41f62e1c7e79d1da5fae8853058877cee1d95f25e56f18a8e0c79460f8b808" }
  : { version: 3, wireSha: "fbe551dd5f07bb6007f9dd829a4a02c4e88ae8dc92c9d1ad884e9246326a8159" };
const expectedSourceSha = priorityPhase
  ? "974691f473fe3ba112b48a94680461e21449b4db6ea27637717aa1291fc684eb"
  : "50d123bf0c62128f2b11c5d82f87d98d49db3a302615349569706490f4199767";
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const prefix = priorityPhase
  ? ".verification-results/projection-scheduler-priority-test"
  : ".verification-results/projection-scheduler-test";
const token = savedCliToken();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const bundle = edgeRuntimeBundle([{ name: endpoint, verifyJwt: false }]);
if (bundle.sha256 !== expectedSourceSha ||
    !bundle.files.some(f => f.path === "_shared/interactions_schedule_plan.ts") ||
    !bundle.files.some(f => f.path === `${endpoint}/index.ts`))
  throw Error("Scheduler source closure incomplete");
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior TEST release attempt requires inspection");

async function inventory() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: "error",
  });
  if (!response.ok) throw Error(`TEST inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map(r => r.slug)).size !== rows.length)
    throw Error("TEST inventory invalid");
  return rows;
}
const before = await inventory();
const original = before.find(f => f.slug === endpoint);
if (!original || original.version !== prior.version ||
    original.ezbr_sha256 !== prior.wireSha || original.status !== "ACTIVE" ||
    original.verify_jwt !== false)
  throw Error("TEST scheduler baseline changed");
const bodyResponse = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions/${endpoint}/body`, {
  headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: "error",
});
if (!bodyResponse.ok) throw Error(`TEST rollback body HTTP ${bodyResponse.status}`);
const rollback = Buffer.from(await bodyResponse.arrayBuffer());
if (!rollback.subarray(0, 5).equals(Buffer.from("ESZIP")))
  throw Error("TEST rollback executable invalid");
writeFileSync(prefix + "-rollback.eszip", rollback, { flag: "wx", mode: 0o600 });
const journal = { version: "learn-build01-projection-scheduler-test/1", project: TEST_PROJECT,
  endpoint, observedAt: new Date().toISOString(), before: { version: original.version,
    wireSha: original.ezbr_sha256, verifyJwt: original.verify_jwt, rollbackSha: sha(rollback) },
  sourceClosureSha: bundle.sha256, sourceFiles: bundle.files.map(f => ({ path: f.path, sha: sha(f.source) })),
  otherEndpoints: before.filter(f => f.slug !== endpoint).map(f => ({ slug: f.slug, version: f.version,
    wireSha: f.ezbr_sha256, verifyJwt: f.verify_jwt })).sort((a,b) => a.slug.localeCompare(b.slug)) };
writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n", { flag: "wx", mode: 0o600 });

const stage = mkdtempSync(join(tmpdir(), "learn-build01-projection-scheduler-test-"));
let cliExitStatus = null;
try {
  for (const file of bundle.files) {
    const path = join(stage, "supabase/functions", file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.source, { mode: 0o600 });
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${TEST_PROJECT}"\n[functions.${endpoint}]\nverify_jwt = false\n`, { mode: 0o600 });
  const result = spawnSync(cli, ["functions", "deploy", endpoint, "--project-ref", TEST_PROJECT,
    "--use-api", "--workdir", stage], { env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    encoding: "utf8", timeout: 90000, maxBuffer: 2097152 });
  cliExitStatus = result.status;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
const after = await inventory();
const current = after.find(f => f.slug === endpoint);
const other = after.filter(f => f.slug !== endpoint).map(f => ({ slug: f.slug, version: f.version,
  wireSha: f.ezbr_sha256, verifyJwt: f.verify_jwt })).sort((a,b) => a.slug.localeCompare(b.slug));
const state = cliExitStatus === 0 && current?.version === prior.version + 1 &&
  current?.status === "ACTIVE" && current?.verify_jwt === false &&
  current.ezbr_sha256 !== prior.wireSha &&
  JSON.stringify(other) === JSON.stringify(journal.otherEndpoints)
  ? "deployed_needs_http_acceptance" : "requires_inspection";
const report = { state, project: TEST_PROJECT, endpoint, cliExitStatus,
  beforeVersion: original.version, afterVersion: current?.version ?? null,
  afterWireSha: current?.ezbr_sha256 ?? null, sourceClosureSha: bundle.sha256,
  rollbackSha: sha(rollback), otherEndpointsUnchanged: JSON.stringify(other) === JSON.stringify(journal.otherEndpoints),
  productionChanged: false, sourceProviderRequests: 0 };
writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
if (state !== "deployed_needs_http_acceptance") process.exitCode = 1;
