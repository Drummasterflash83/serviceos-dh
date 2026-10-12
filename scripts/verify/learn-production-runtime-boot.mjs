/** Boot the exact compiled eszips with NO network, dependency cache or source mount. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
const root = resolve("."), source = resolve(process.argv[2] ?? "");
if (!source.startsWith(join(root, ".verification-results") + "/")) throw Error("Private bundle run required");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const report = JSON.parse(readFileSync(join(source, "report.json")));
const manifestText = readFileSync("supabase/release/learn-production/runtime-candidate.manifest.json", "utf8");
const manifest = JSON.parse(manifestText);
if (report.state !== "all_candidate_endpoints_bundled" || report.manifestSha256 !== sha(manifestText) ||
    report.endpoints.length !== manifest.endpoints.length ||
    manifest.files.some(f => sha(readFileSync(join(source, "stage/supabase/functions", f.path))) !== f.sha256) ||
    report.endpoints.some(e => sha(readFileSync(join(source, "artifacts", e.name + ".eszip"))) !== e.eszipSha256))
  throw Error("Exact successful bundle run and staged sources required");
const runName = process.argv[3] ?? "boot-eszip";
if (!/^boot-[a-z0-9-]+$/.test(runName)) throw Error("Explicit boot output name required");
const output = join(source, runName);
mkdirSync(output, { mode: 0o700 });
const env = [
  ["SUPABASE_URL", "http://127.0.0.1:1"],
  ["SUPABASE_ANON_KEY", "synthetic-anonymous-not-a-credential"],
  ["SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-not-a-credential"],
  ...["CARD_SYNC_SECRET", "EMAIL_SCHEDULE_SECRET", "EMAIL_WORKSPACE_BACKFILL_SECRET",
    "EMAIL_WORKSPACE_SCHEDULE_SECRET", "IDENTITY_SYNC_SECRET", "PHONE_PROCESSING_SECRET",
    "PHONE_SCHEDULE_SECRET", "SIGNAL_SYNC_SECRET", "WORKER_SECRET", "LEARN_COMMUSOFT_WORKER_KEY",
    "LEARN_SLACK_WORKER_KEY", "SERVICEOS_INTERNAL_KEY", "OPENFOLK_CONTROLPLANE_KEY"]
    .map(name => [name, "synthetic-runtime-denial-probe-not-a-credential"]),
];
const main = `
const endpoints = ${JSON.stringify(manifest.endpoints.map(e => e.name))};
const envVars = ${JSON.stringify(env)};
Deno.serve(async req => {
  const name = new URL(req.url).pathname.slice(1);
  if (!endpoints.includes(name)) return Response.json({error:"unknown"},{status:404});
  try {
    const scopedEnv=name==="learn-launch-status" ? envVars.map(([key,value])=>
      [key,key==="SUPABASE_URL"?"https://tgbnakbxwcqjeimygroz.supabase.co":value])
      .concat([["LEARN_STATUS_READ_MODE","production_metadata_views"]]) : envVars;
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath:"/work/supabase/functions/"+name, memoryLimitMb:128,
      maybeEszip:await Deno.readFile("/artifacts/"+name+".eszip"),
      maybeEntrypoint:"file:///work/supabase/functions/"+name+"/index.ts",
      workerTimeoutMs:5000, noModuleCache:false, envVars:scopedEnv, forceCreate:true,
      cpuTimeSoftLimitMs:3000, cpuTimeHardLimitMs:3000,
    });
    // The runtime forwards the native incoming request stream to the user worker.
    const response = await worker.fetch(req);
    const text = await response.text();
    let value = {}; try { value=JSON.parse(text); } catch {}
    return Response.json({name,status:response.status,
      code:typeof value.error?.code==="string"?value.error.code:typeof value.code==="string"?value.code:null,
      denied:response.status===401||response.status===403});
  } catch(error) { return Response.json({name,denied:false,error:String(error.message).slice(0,500)}); }
});
for (const name of endpoints) {
  const syntheticId="11111111-1111-4111-8111-111111111111";
  const phoneInput=["phone-analyse-transcript","phone-process-pipeline",
    "phone-transcribe-recording","simwood-download-recording"].includes(name);
  const body=name==="learn-launch-status"?{tenant_id:syntheticId}:phoneInput?
    {tenant_id:syntheticId,recording_id:syntheticId,transcript_id:syntheticId}:{};
  const r = await fetch("http://127.0.0.1:9000/"+name,
    {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  console.log("CANDIDATE_BOOT="+JSON.stringify(await r.json()));
}
console.log("CANDIDATE_BOOT_DONE");
`;
writeFileSync(join(output, "index.ts"), main, { mode: 0o600 });
const docker = "/usr/local/bin/docker", name = "serviceos-runtime-boot-" + randomUUID().slice(0, 8);
const image = report.image;
const inspect = spawnSync(docker, ["image", "inspect", image, "--format", "{{.Id}}"], { encoding:"utf8" });
if (inspect.status !== 0 || inspect.stdout.trim() !== report.imageId) throw Error("Image changed");
let created = false, logs = "", seen = 0, checks = [];
const result = { version:"learn-production-runtime-boot/1", state:"running", startedAt:new Date().toISOString(),
  sourceClosureSha256:report.sourceClosureSha256, manifestSha256:report.manifestSha256,
  harnessSha256:sha(main), verifierSha256:sha(readFileSync(new URL(import.meta.url))),
  artifacts:report.endpoints.map(({name,eszipSha256})=>({name,eszipSha256})),
  imageId:report.imageId, network:"none", publishedPorts:false, realCredentials:false,
  customerData:false, productionChanged:false, hostedTestChanged:false, containerRemoved:false,
  checks, limitations:["Missing-authorization checks only; no hosted JWT gateway, valid-user, database or provider acceptance.",
    "Runs the exact retained eszips; no dependency cache or original source is mounted."] };
try {
  const start = spawnSync(docker, ["run", "-d", "--pull=never", "--network", "none", "--name", name,
    "--memory", "1024m", "--cpus", "2",
    "--mount", `type=bind,source=${join(source,"artifacts")},target=/artifacts,readonly`,
    "--mount", `type=bind,source=${output},target=/probe,readonly`,
    image, "start", "--main-service", "/probe"], { encoding:"utf8" });
  if (start.status !== 0) throw Error("Container startup failed");
  created = true;
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const got = spawnSync(docker, ["logs", name], { encoding:"utf8", maxBuffer:4*1024*1024 });
    if (got.status !== 0) throw Error("Container log read failed");
    logs = got.stdout + got.stderr;
    checks = logs.split("\n").filter(l => l.startsWith("CANDIDATE_BOOT="))
      .map(l => JSON.parse(l.slice("CANDIDATE_BOOT=".length)));
    if (checks.length !== seen) { seen = checks.length; console.log(JSON.stringify({observed:seen,total:manifest.endpoints.length})); }
    if (logs.includes("CANDIDATE_BOOT_DONE")) break;
    const state = spawnSync(docker,["inspect","--format","{{.State.Running}}",name],{encoding:"utf8"});
    if (state.status !== 0 || state.stdout.trim() !== "true") throw Error("Runtime stopped early");
    await new Promise(r=>setTimeout(r,1000));
  }
  result.checks = checks;
  result.state = checks.length === manifest.endpoints.length && checks.every(c=>c.denied)
    ? "all_endpoints_booted_and_rejected_missing_auth" : "runtime_acceptance_failed";
  if (result.state === "runtime_acceptance_failed") process.exitCode = 1;
} catch(error) {
  result.state = "runtime_probe_failed"; result.error = error.message; process.exitCode = 1;
} finally {
  if (created) {
    const removed=spawnSync(docker,["rm","-f",name],{encoding:"utf8"});
    result.containerRemoved=removed.status===0;
    if (!result.containerRemoved) { result.state="cleanup_unconfirmed";process.exitCode=1; }
  }
  result.completedAt=new Date().toISOString();
  writeFileSync(join(output,"runtime.log"),logs,{mode:0o600});
  writeFileSync(join(output,"report.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});
  console.log(JSON.stringify({state:result.state,checks:checks.length,
    failures:checks.filter(c=>!c.denied).map(c=>({name:c.name,status:c.status,code:c.code,error:c.error?.slice(0,180)})),
    containerRemoved:result.containerRemoved}));
}
