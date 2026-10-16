/** Targeted, baseline-checked Email receipt continuation release, TEST first. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
import { BASELINE_SHA256, patchDeployedEmailReceiptWorker, sha256 }
  from "./learn-build01-email-receipt-deployed-overlay.mjs";

const LIVE_PROJECT = "tgbnakbxwcqjeimygroz";
const mode = process.argv.slice(2).join(" ");
const config = mode === "--test --existing-cli-login"
  ? { project: TEST_PROJECT, label: "test", version: 63 }
  : mode === "--live --existing-cli-login"
  ? { project: LIVE_PROJECT, label: "live", version: 104 } : null;
if (!config || (config.label === "test" ? process.env.LEARN_TEST_ALLOW_PROJECT_REF
  : process.env.LEARN_LIVE_ALLOW_PROJECT_REF) !== config.project)
  throw Error("Exact TEST or LIVE worker deployment allowlist required");
const CLI = "/Users/chrisdrummond/.npm/_npx/f488b5593433aa64/node_modules/supabase/bin/supabase";
const endpoint = "platform-worker";
const expectedWire = "d80c5656fefad63ddca67bc625beeabb004bc505bfdfc781c10072d949028994";
const target = "_shared/worker_handlers/interactions_sync.ts";
const prefix = `.verification-results/build01-email-receipt-worker-${config.label}`;
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior Email worker release requires inspection");
const token = savedCliToken();
async function inventory(project) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Worker inventory HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || new Set(rows.map((row) => row.slug)).size !== rows.length)
    throw Error("Worker inventory invalid");
  return rows;
}
const others = (rows) => rows.filter((row) => row.slug !== endpoint)
  .map((row) => [row.slug,row.version,row.ezbr_sha256,row.verify_jwt])
  .sort((a,b) => a[0].localeCompare(b[0]));
const before = await inventory(config.project);
const prior = before.find((row) => row.slug === endpoint);
if (prior?.version !== config.version || prior?.ezbr_sha256 !== expectedWire ||
    prior.status !== "ACTIVE" || prior.verify_jwt !== false)
  throw Error("Exact worker baseline changed");
if (config.label === "live") {
  const tested = JSON.parse(readFileSync(
    ".verification-results/build01-email-receipt-worker-test-result.json", "utf8"));
  const testWorker = (await inventory(TEST_PROJECT)).find((row) => row.slug === endpoint);
  if (tested.state !== "deployed_needs_hosted_acceptance" ||
      testWorker?.version !== tested.afterVersion ||
      testWorker?.ezbr_sha256 !== tested.afterWireSha256 ||
      testWorker?.status !== "ACTIVE")
    throw Error("Exact TEST worker changed");
  const fixture = JSON.parse(readFileSync(
    ".verification-results/learn-build01-email-receipt-window/test-hosted-acceptance-v2.json", "utf8"));
  if (fixture.state !== "email_receipt_worker_test_accepted" ||
      fixture.workerVersion !== testWorker.version ||
      fixture.workerWireSha256 !== testWorker.ezbr_sha256)
    throw Error("TEST hosted Email acceptance missing");
}
const body = await fetch(`https://api.supabase.com/v1/projects/${config.project}/functions/${endpoint}/body`, {
  headers: { Authorization: `Bearer ${token}` }, redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!body.ok) throw Error("Rollback worker executable unavailable");
const rollback = Buffer.from(await body.arrayBuffer());
if (!rollback.subarray(0,5).equals(Buffer.from("ESZIP")))
  throw Error("Rollback worker executable invalid");
writeFileSync(prefix + "-rollback.eszip", rollback, { flag: "wx", mode: 0o600 });
const work = mkdtempSync(join(tmpdir(), "build01-email-receipt-worker-"));
let candidateSha256 = null, sourceFiles = 0, cliStatus = null;
try {
  const download = join(work, "download");
  mkdirSync(download, { mode: 0o700 });
  const fetched = spawnSync(CLI, ["functions","download",endpoint,
    "--project-ref",config.project,"--workdir",download], {
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, encoding: "utf8",
    timeout: 90000, maxBuffer: 1024 * 1024,
  });
  if (fetched.status !== 0) throw Error("Deployed worker source download unconfirmed");
  const sourceRoot = join(download,"supabase/functions",endpoint);
  const stage = join(work,"stage"), files = [];
  function collect(directory) {
    for (const entry of readdirSync(directory,{withFileTypes:true})) {
      const path = join(directory,entry.name);
      if (entry.isSymbolicLink()) throw Error("Downloaded worker source symlink");
      if (entry.isDirectory()) collect(path);
      else if (entry.isFile()) files.push({path,rel:relative(sourceRoot,path)});
      else throw Error("Downloaded worker source nonfile");
    }
  }
  collect(sourceRoot);
  if (files.length < 100 || files.length > 200 ||
      !files.some((file) => file.rel === "index.ts"))
    throw Error("Downloaded worker closure changed");
  let patched = 0;
  const manifest = [];
  for (const file of files) {
    if (!/\.(ts|js|json)$/.test(file.rel) || file.rel.includes(".."))
      throw Error("Unexpected worker source path");
    const rel = file.rel.startsWith("functions/")
      ? file.rel.slice("functions/".length) : `${endpoint}/${file.rel}`;
    const targetPath = join(stage,"supabase/functions",rel);
    mkdirSync(dirname(targetPath),{recursive:true,mode:0o700});
    let source = readFileSync(file.path,"utf8");
    if (rel === target) {
      if (sha256(source) !== BASELINE_SHA256) throw Error("Target handler baseline changed");
      source = patchDeployedEmailReceiptWorker(source);
      patched++;
    }
    writeFileSync(targetPath,source,{mode:0o600});
    manifest.push({path:rel,sha256:sha256(source)});
  }
  if (patched !== 1 || new Set(manifest.map((entry) => entry.path)).size !== manifest.length)
    throw Error("Targeted worker mapping changed");
  sourceFiles = manifest.length;
  candidateSha256 = sha256(JSON.stringify(manifest.sort((a,b) => a.path.localeCompare(b.path))));
  if (config.label === "live") {
    const tested = JSON.parse(readFileSync(
      ".verification-results/build01-email-receipt-worker-test-result.json", "utf8"));
    if (candidateSha256 !== tested.candidateSha256)
      throw Error("LIVE worker closure differs from TEST candidate");
  }
  writeFileSync(join(stage,"supabase/config.toml"),
    `project_id = "${config.project}"\n[functions.${endpoint}]\nverify_jwt = false\n`,
    {mode:0o600});
  writeFileSync(prefix + "-journal.json",JSON.stringify({state:"prepared",
    project:config.project,beforeVersion:prior.version,beforeWireSha256:prior.ezbr_sha256,
    rollbackSha256:sha256(rollback),candidateSha256,sourceFiles,
    changedSourcePaths:[target],otherEndpoints:others(before)},null,2)+"\n",
    {flag:"wx",mode:0o600});
  const deployed = spawnSync(CLI,["functions","deploy",endpoint,
    "--project-ref",config.project,"--use-api","--workdir",stage],{
    env:{...process.env,SUPABASE_ACCESS_TOKEN:token},encoding:"utf8",
    timeout:120000,maxBuffer:2*1024*1024,
  });
  cliStatus = deployed.status;
} finally {
  rmSync(work,{recursive:true,force:true});
}
const after = await inventory(config.project), current = after.find((row) => row.slug === endpoint);
const unchangedOthers = JSON.stringify(others(before)) === JSON.stringify(others(after));
const passed = cliStatus === 0 && current?.version === config.version+1 &&
  current?.status === "ACTIVE" && current?.verify_jwt === false &&
  current?.ezbr_sha256 !== expectedWire && unchangedOthers;
const result = { state: passed ? "deployed_needs_hosted_acceptance" : "requires_inspection",
  project:config.project,beforeVersion:config.version,afterVersion:current?.version??null,
  beforeWireSha256:expectedWire,afterWireSha256:current?.ezbr_sha256??null,
  candidateSha256,sourceFiles,changedSourcePaths:[target],
  otherEndpointsUnchanged:unchangedOthers,cliStatus,
  productionChanged:config.label==="live",providerRequests:0 };
writeFileSync(prefix + "-result.json",JSON.stringify(result,null,2)+"\n",
  {flag:"wx",mode:0o600});
console.log(JSON.stringify(result));
if (!passed) process.exitCode=1;
