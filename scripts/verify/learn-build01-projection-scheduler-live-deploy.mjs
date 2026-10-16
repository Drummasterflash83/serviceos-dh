/** LIVE one-function release after exact TEST source and endpoint verification. */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const project = "tgbnakbxwcqjeimygroz", endpoint = "interactions-scheduled-sync";
const phase = process.argv.slice(2).join(" ");
const priorityPhase = phase === "--deploy-live-priority";
const prior = priorityPhase
  ? { version: 49, wireSha: "ca41f62e1c7e79d1da5fae8853058877cee1d95f25e56f18a8e0c79460f8b808" }
  : { version: 48, wireSha: "79eb4e34b509a59ecff8ea6620cd3f7b09eccc01e9f31c48c88e676e0830bbb3" };
const test = priorityPhase
  ? { version: 5, wireSha: "5390cc34dfa7231217e7ab5f082d4dfa8622afdc5816bd95310f7f5c5d67d042" }
  : { version: 4, wireSha: "ca41f62e1c7e79d1da5fae8853058877cee1d95f25e56f18a8e0c79460f8b808" };
const sourceClosureSha = priorityPhase
  ? "974691f473fe3ba112b48a94680461e21449b4db6ea27637717aa1291fc684eb"
  : "50d123bf0c62128f2b11c5d82f87d98d49db3a302615349569706490f4199767";
const cli = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const prefix = priorityPhase
  ? ".verification-results/projection-scheduler-priority-live"
  : ".verification-results/projection-scheduler-live";
if (!["--deploy-live", "--deploy-live-priority"].includes(phase) ||
    process.env.LEARN_LIVE_ALLOW_PROJECT_REF !== project)
  throw Error("Exact LIVE scheduler deployment required");
const tested = JSON.parse(readFileSync(priorityPhase
  ? ".verification-results/projection-scheduler-priority-test-result.json"
  : ".verification-results/projection-scheduler-test-result.json"));
if (tested.state !== "deployed_needs_http_acceptance" ||
    tested.sourceClosureSha !== sourceClosureSha || tested.afterVersion !== test.version ||
    tested.afterWireSha !== test.wireSha || !tested.otherEndpointsUnchanged)
  throw Error("TEST source and endpoint verification required");
const bundle = edgeRuntimeBundle([{ name: endpoint, verifyJwt: false }]);
if (bundle.sha256 !== sourceClosureSha) throw Error("Reviewed scheduler source changed");
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior LIVE release attempt requires inspection");
const token = savedCliToken();
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
async function inventory(ref) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: "error",
  });
  if (!response.ok) throw Error(`Runtime inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map(r => r.slug)).size !== rows.length)
    throw Error("Runtime inventory invalid");
  return rows;
}
const testFunction = (await inventory(TEST_PROJECT)).find(f => f.slug === endpoint);
if (!testFunction || testFunction.version !== test.version ||
    testFunction.ezbr_sha256 !== test.wireSha || testFunction.status !== "ACTIVE" ||
    testFunction.verify_jwt !== false)
  throw Error("TEST deployed scheduler changed");
const before = await inventory(project);
const original = before.find(f => f.slug === endpoint);
if (!original || original.version !== prior.version || original.ezbr_sha256 !== prior.wireSha ||
    original.status !== "ACTIVE" || original.verify_jwt !== false)
  throw Error("LIVE scheduler baseline changed");
const bodyResponse = await fetch(`https://api.supabase.com/v1/projects/${project}/functions/${endpoint}/body`, {
  headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000), redirect: "error",
});
if (!bodyResponse.ok) throw Error(`LIVE rollback body HTTP ${bodyResponse.status}`);
const rollback = Buffer.from(await bodyResponse.arrayBuffer());
if (!rollback.subarray(0, 5).equals(Buffer.from("ESZIP")))
  throw Error("LIVE rollback executable invalid");
writeFileSync(prefix + "-rollback.eszip", rollback, { flag: "wx", mode: 0o600 });
const other = rows => rows.filter(f => f.slug !== endpoint).map(f => ({ slug: f.slug,
  version: f.version, wireSha: f.ezbr_sha256, verifyJwt: f.verify_jwt }))
  .sort((a,b) => a.slug.localeCompare(b.slug));
const journal = { version: "learn-build01-projection-scheduler-live/1", project,
  endpoint, observedAt: new Date().toISOString(), before: { version: original.version,
    wireSha: original.ezbr_sha256, verifyJwt: original.verify_jwt, rollbackSha: sha(rollback) },
  sourceClosureSha, sourceFiles: bundle.files.map(f => ({ path: f.path, sha: sha(f.source) })),
  otherEndpoints: other(before), testVersion: test.version, testWireSha: test.wireSha };
writeFileSync(prefix + "-journal.json", JSON.stringify(journal, null, 2) + "\n", { flag: "wx", mode: 0o600 });
const stage = mkdtempSync(join(tmpdir(), "learn-build01-projection-scheduler-live-"));
let cliExitStatus = null;
try {
  for (const file of bundle.files) {
    const path = join(stage, "supabase/functions", file.path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, file.source, { mode: 0o600 });
  }
  writeFileSync(join(stage, "supabase/config.toml"),
    `project_id = "${project}"\n[functions.${endpoint}]\nverify_jwt = false\n`, { mode: 0o600 });
  const result = spawnSync(cli, ["functions", "deploy", endpoint, "--project-ref", project,
    "--use-api", "--workdir", stage], { env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    encoding: "utf8", timeout: 90000, maxBuffer: 2097152 });
  cliExitStatus = result.status;
} finally {
  rmSync(stage, { recursive: true, force: true });
}
const after = await inventory(project), current = after.find(f => f.slug === endpoint);
const otherUnchanged = JSON.stringify(other(after)) === JSON.stringify(journal.otherEndpoints);
const state = cliExitStatus === 0 && current?.version === prior.version + 1 &&
  current?.status === "ACTIVE" && current?.verify_jwt === false &&
  current.ezbr_sha256 !== prior.wireSha && otherUnchanged
  ? "deployed_needs_scheduled_acceptance" : "requires_inspection";
const report = { state, project, endpoint, cliExitStatus, beforeVersion: original.version,
  afterVersion: current?.version ?? null, afterWireSha: current?.ezbr_sha256 ?? null,
  sourceClosureSha, rollbackSha: sha(rollback), otherEndpointsUnchanged: otherUnchanged,
  testVersion: test.version, testWireSha: test.wireSha, sourceProviderRequests: 0 };
writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
if (state !== "deployed_needs_scheduled_acceptance") process.exitCode = 1;
