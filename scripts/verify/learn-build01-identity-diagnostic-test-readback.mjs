/** Exact TEST byte and unauthenticated-denial readback for the identity diagnostic. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

if (process.argv.length !== 4 || process.argv[2] !== "--manifest")
  throw Error("Exact TEST stage manifest required");
const root = resolve(".verification-results");
const path = resolve(process.argv[3]);
if (!path.startsWith(root + "/") || realpathSync(path) !== path)
  throw Error("Private TEST stage path invalid");
const stage = JSON.parse(readFileSync(path, "utf8"));
if (stage.version !== "learn-build01-identity-diagnostic-stage/1" ||
  stage.label !== "test" || stage.project !== TEST_PROJECT ||
  stage.results.length !== 1 || stage.results[0].slug !== "platform-worker")
  throw Error("Exact TEST stage changed");
const deploy = JSON.parse(readFileSync(join(stage.root, "deploy-journal.json"), "utf8"));
const compiled = JSON.parse(readFileSync(join(stage.root, "compile-manifest-network.json"), "utf8"));
if (deploy.state !== "exact_candidates_deployed" ||
  deploy.completed[0]?.bodySha256 !== compiled.results[0]?.sha256)
  throw Error("TEST worker deployment unconfirmed");
const tests = spawnSync(process.execPath, ["--experimental-strip-types", "--test",
  "supabase/functions/_shared/worker_handlers/identity_resolve.test.ts"],
  { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 });
if (tests.status !== 0 || !tests.stdout.includes("pass 18") ||
  !tests.stdout.includes("fail 0"))
  throw Error("Identity handler regression tests failed");
const token = savedCliToken();
const base = `https://api.supabase.com/v1/projects/${TEST_PROJECT}`;
async function read(endpoint) {
  const response = await fetch(base + endpoint, { headers: {
    Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`TEST Edge readback HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const inventory = JSON.parse((await read("/functions")).toString("utf8"));
const worker = inventory.find(item => item.slug === "platform-worker");
const target = stage.results[0];
const current = deploy.completed[0];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
if (!worker || worker.status !== "ACTIVE" ||
  worker.version !== target.version + 1 ||
  worker.ezbr_sha256 !== current.wireSha256 ||
  worker.verify_jwt !== target.verifyJwt ||
  sha(await read("/functions/platform-worker/body")) !== compiled.results[0].sha256)
  throw Error("Exact TEST worker bytes changed");
const denied = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,
  { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    redirect: "error", signal: AbortSignal.timeout(15000) });
await denied.body?.cancel();
if (denied.status !== 403) throw Error("Unsigned TEST worker request not denied");
const result = { state: "test_exact_candidate_verified", project: TEST_PROJECT,
  workerVersion: worker.version, candidateHandlerSha256: target.candidateHandlerSha256,
  workerArtifactSha256: compiled.results[0].sha256,
  identityHandlerTestsPassed: 18, unsignedStatus: denied.status,
  providerRequests: 0, productionDataWrites: false,
  observedAtUtc: new Date().toISOString() };
writeFileSync(join(stage.root, "test-readback-receipt.json"),
  JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(result));
