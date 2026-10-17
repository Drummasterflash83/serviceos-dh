/** Boot each reviewed LIVE v107 Edge bundle offline with synthetic settings. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

if (process.argv.slice(2).join(" ") !== "--reviewed-v107-offline")
  throw Error("Exact reviewed v107 offline mode required");
const root = resolve(".verification-results/build01-edge-bundles-v107");
const report = JSON.parse(readFileSync(join(root, "report.private.json"), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const expectedManifest = "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488";
const expectedImage = "sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c";
const manifestPath = resolve(".verification-results/build01-runtime-archive-2026-10-16T23-22-48-811Z/manifest.private.json");
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
if (report.contract !== "learn-build01-edge-v107-all-bundles/1" ||
    report.bundledCount !== 103 || report.failed.length !== 0 ||
    report.sourceManifestSha256 !== expectedManifest || sha(manifestBytes) !== expectedManifest ||
    report.imageId !== expectedImage || manifest.entries.length !== 103 ||
    report.results.length !== 103)
  throw Error("Reviewed v107 manifest or bundle report changed");
const names = manifest.entries.map(entry => entry.slug).sort();
if (new Set(names).size !== 103 || names.some(name => !/^[a-z0-9][a-z0-9-]{0,80}$/.test(name)))
  throw Error("Invalid v107 function inventory");
for (const name of names) {
  const entry = report.results.find(row => row.slug === name);
  if (!entry || entry.state !== "bundled" ||
      sha(readFileSync(join(root, `${name}.eszip`))) !== entry.sha256)
    throw Error("Reviewed v107 bundle changed");
}
const docker = "/usr/local/bin/docker";
const inspectImage = spawnSync(docker, ["image", "inspect", expectedImage, "--format", "{{.Id}}"], { encoding: "utf8" });
if (inspectImage.status !== 0 || inspectImage.stdout.trim() !== expectedImage)
  throw Error("Pinned Edge image unavailable or changed");
const run = randomUUID().slice(0, 12);
const name = `serviceos-v107-all-startup-${run}`;
const label = `ai.openfolk.serviceos.v107-startup=${run}`;
const output = join(root, `offline-startup-${run}`);
mkdirSync(output, { mode: 0o700 });
const env = [
  ["SUPABASE_URL", "http://127.0.0.1:1"],
  ["SUPABASE_ANON_KEY", "synthetic-anon-not-a-credential"],
  ["SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-not-a-credential"],
  ["SERVICEOS_INTERNAL_KEY", "synthetic-internal-not-a-credential"],
  ["LEARN_STATUS_READ_MODE", "production_metadata_views"],
];
const harness = `
const names=${JSON.stringify(names)};
const env=${JSON.stringify(env)};
Deno.serve(async request => {
  const name=new URL(request.url).pathname.slice(1);
  if(!names.includes(name)) return Response.json({name,error:"not_in_reviewed_manifest"},{status:404});
  try {
    const worker=await EdgeRuntime.userWorkers.create({
      servicePath:"/recovery/supabase/functions/"+name,
      memoryLimitMb:128,
      maybeEszip:await Deno.readFile("/bundles/"+name+".eszip"),
      maybeEntrypoint:"file:///recovery/supabase/functions/"+name+"/index.ts",
      workerTimeoutMs:5000,noModuleCache:false,forceCreate:true,
      cpuTimeSoftLimitMs:3000,cpuTimeHardLimitMs:3000,envVars:env,
    });
    const response=await worker.fetch(request);
    return Response.json({name,status:response.status,booted:true});
  } catch(error) {
    return Response.json({name,booted:false,errorClass:String(error?.name ?? "Error").slice(0,70)});
  }
});
for(const name of names){
  try {
    const response=await fetch("http://127.0.0.1:9000/"+name,{method:"OPTIONS",signal:AbortSignal.timeout(8000)});
    const result=await response.json();
    console.log("V107_STARTUP="+JSON.stringify(result));
  } catch(error) {
    console.log("V107_STARTUP="+JSON.stringify({name,booted:false,errorClass:String(error?.name ?? "Error").slice(0,70)}));
  }
}
console.log("V107_STARTUP_DONE");
`;
writeFileSync(join(output, "index.ts"), harness, { mode: 0o600 });
let created = false;
let logs = "";
const result = {
  contract: "learn-build01-v107-all-edge-offline-startup/1",
  observedAtUtc: new Date().toISOString(), sourceManifestSha256: expectedManifest,
  imageId: expectedImage, bundleCount: 103, harnessSha256: sha(harness),
  network: "none", hostPorts: 0, sourceMounted: false, realCredentials: false,
  productionDataWrites: false, providerWrites: false,
  containerRemoved: false, startupChecks: [], state: "running",
  limits: "Synthetic settings and OPTIONS prove isolated module startup only; actual provider credentials, authenticated routes and capture recovery remain unverified.",
};
try {
  const start = spawnSync(docker, ["run", "-d", "--pull=never", "--network", "none",
    "--ipc", "private", "--name", name, "--label", label,
    "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
    "--memory", "1024m", "--cpus", "2", "--pids-limit", "128",
    "--mount", `type=bind,src=${root},dst=/bundles,readonly`,
    "--mount", `type=bind,src=${output},dst=/probe,readonly`,
    expectedImage, "start", "--main-service", "/probe", "--ip", "127.0.0.1", "--port", "9000"],
    { encoding: "utf8", timeout: 30000 });
  if (start.status !== 0) throw Error("Offline container did not start");
  created = true;
  const deadline = Date.now() + 600000;
  let reported = 0;
  while (Date.now() < deadline) {
    const got = spawnSync(docker, ["logs", name], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
    if (got.status !== 0) throw Error("Offline container logs unavailable");
    logs = got.stdout + got.stderr;
    const checks = logs.split("\n").filter(line => line.startsWith("V107_STARTUP="))
      .map(line => JSON.parse(line.slice("V107_STARTUP=".length)));
    if (checks.length >= reported + 10 || checks.length === 103) {
      reported = checks.length;
      console.log(JSON.stringify({ observed: reported, total: 103 }));
    }
    if (logs.includes("V107_STARTUP_DONE")) { result.startupChecks = checks; break; }
    const running = spawnSync(docker, ["inspect", "--format", "{{.State.Running}}", name], { encoding: "utf8" });
    if (running.status !== 0 || running.stdout.trim() !== "true")
      throw Error("Offline runtime exited before all checks");
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  result.state = result.startupChecks.length === 103 &&
    result.startupChecks.every(check => check.booted === true && Number.isInteger(check.status))
    ? "all_103_started_offline" : "startup_incomplete";
  if (result.state !== "all_103_started_offline") process.exitCode = 1;
} catch (error) {
  result.state = "offline_rehearsal_failed";
  result.errorClass = String(error?.message ?? error).slice(0,100);
  process.exitCode = 1;
} finally {
  if (created) {
    const inspected = spawnSync(docker, ["inspect", "--format", "{{json .Config.Labels}}", name], { encoding: "utf8" });
    if (inspected.status === 0 && JSON.parse(inspected.stdout)["ai.openfolk.serviceos.v107-startup"] === run) {
      const removed = spawnSync(docker, ["rm", "-f", name], { encoding: "utf8" });
      result.containerRemoved = removed.status === 0;
    }
    if (!result.containerRemoved) { result.state = "cleanup_unconfirmed"; process.exitCode = 1; }
  }
  result.completedAtUtc = new Date().toISOString();
  writeFileSync(join(output, "report.private.json"), JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(join(output, "runtime.private.log"), logs, { mode: 0o600 });
  console.log(JSON.stringify({ state: result.state, checks: result.startupChecks.length,
    failures: result.startupChecks.filter(check => !check.booted).map(check => check.name),
    containerRemoved: result.containerRemoved }));
}
