/** Bundle and boot the pinned current Control Plane source with synthetic settings.
 * Public package resolution is permitted during bundling. The startup container
 * has no network, no production credentials and no provider requests. */
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

if (process.argv.slice(2).join(" ") !== "--reviewed-v38-offline")
  throw Error("Exact reviewed v38 offline mode required");
const base = resolve(".verification-results/build01-runtime-archive-2026-10-16T23-22-48-811Z");
const patch = resolve("infrastructure/recovery/edge-functions/control-plane-v38-from-v107.patch");
const verifier = resolve("scripts/backup/verify_live_controlplane_overlay.py");
const image = "sha256:c52405002a890ca9fcf77978671c57f3a988e03174afb277f84ac65bc917013c";
const docker = "/usr/local/bin/docker";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const tmp = mkdtempSync("/private/tmp/learn-cp-v38-startup-");
const reconstructed = join(tmp, "raw"), stage = join(tmp, "stage"), output = join(tmp, "out");
const label = `ai.openfolk.serviceos.cp-v38=${randomUUID()}`;
const container = `learn-cp-v38-${randomUUID().slice(0, 10)}`;
let created = false;
const run = (command, args, options = {}) => spawnSync(command, args,
  { encoding: "utf8", timeout: options.timeout ?? 120000,
    maxBuffer: 1024 * 1024, ...options });
try {
  const inspected = run(docker, ["image", "inspect", image, "--format", "{{.Id}}"]);
  if (inspected.status !== 0 || inspected.stdout.trim() !== image)
    throw Error("Pinned Edge runtime image unavailable");
  const verified = run("python3", [verifier, "--archive", base, "--patch", patch,
    "--output", reconstructed]);
  if (verified.status !== 0) throw Error("Pinned source reconstruction failed");
  const details = JSON.parse(verified.stdout);
  if (details.filesVerified !== 24 || details.reconstructedVersion !== 38)
    throw Error("Reconstructed source shape changed");
  const copy = folder => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name), info = statSync(path);
      if (info.isDirectory()) copy(path);
      else if (info.isFile()) {
        const relative = path.slice(reconstructed.length + 1);
        const target = relative === "index.ts"
          ? join(stage, "supabase/functions/openfolk-control-plane/index.ts")
          : relative.startsWith("work/")
            ? join(stage, relative.slice("work/".length)) : null;
        if (!target) throw Error("Reconstructed source path changed");
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(path, target);
      } else throw Error("Reconstructed source is not a regular file");
    }
  };
  copy(reconstructed);
  mkdirSync(output, { recursive: true });
  const bundled = run(docker, ["run", "--rm", "--pull=never", "--network", "bridge",
    "--memory", "768m", "--cpus", "2",
    "--mount", `type=bind,src=${stage},dst=/work,readonly`,
    "--mount", `type=bind,src=${output},dst=/out`, "--workdir", "/work", image,
    "bundle", "--entrypoint", "/work/supabase/functions/openfolk-control-plane/index.ts",
    "--output", "/out/openfolk-control-plane.eszip", "--checksum", "sha256",
    "--timeout", "55"], { timeout: 90000 });
  const bundle = join(output, "openfolk-control-plane.eszip");
  if (bundled.status !== 0 || statSync(bundle).size < 1024)
    throw Error("Reconstructed Control Plane bundle failed");
  const bundleSha256 = sha(readFileSync(bundle));
  const harness = `
Deno.serve(async request => {
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: "/recovery/supabase/functions/openfolk-control-plane",
      memoryLimitMb: 128,
      maybeEszip: await Deno.readFile("/bundle/openfolk-control-plane.eszip"),
      maybeEntrypoint: "file:///recovery/supabase/functions/openfolk-control-plane/index.ts",
      workerTimeoutMs: 5000, noModuleCache: false, forceCreate: true,
      cpuTimeSoftLimitMs: 3000, cpuTimeHardLimitMs: 3000,
      envVars: [
        ["SUPABASE_URL", "http://127.0.0.1:1"],
        ["SUPABASE_ANON_KEY", "synthetic-anon-not-a-credential"],
        ["SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-not-a-credential"],
        ["SERVICEOS_INTERNAL_KEY", "synthetic-internal-not-a-credential"],
      ],
    });
    const response = await worker.fetch(request);
    return Response.json({ booted: true, status: response.status });
  } catch (error) {
    return Response.json({ booted: false, errorClass: String(error?.name ?? "Error") }, { status: 500 });
  }
});
const response = await fetch("http://127.0.0.1:9000/", { method: "OPTIONS", signal: AbortSignal.timeout(8000) });
console.log("CP_V38_STARTUP=" + JSON.stringify(await response.json()));
console.log("CP_V38_STARTUP_DONE");
`;
  const probe = join(tmp, "probe");
  mkdirSync(probe, { mode: 0o700 });
  writeFileSync(join(probe, "index.ts"), harness, { mode: 0o600 });
  const started = run(docker, ["run", "-d", "--pull=never", "--network", "none",
    "--ipc", "private", "--name", container, "--label", label,
    "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
    "--memory", "512m", "--cpus", "2", "--pids-limit", "128",
    "--mount", `type=bind,src=${output},dst=/bundle,readonly`,
    "--mount", `type=bind,src=${probe},dst=/probe,readonly`, image,
    "start", "--main-service", "/probe", "--ip", "127.0.0.1", "--port", "9000"]);
  if (started.status !== 0) throw Error("Offline startup container failed to start");
  created = true;
  let observed = null;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const logs = run(docker, ["logs", container]);
    if (logs.status !== 0) throw Error("Offline startup logs unavailable");
    const line = (logs.stdout + logs.stderr).split("\n").find(row => row.startsWith("CP_V38_STARTUP="));
    if (line) { observed = JSON.parse(line.slice("CP_V38_STARTUP=".length)); break; }
    await new Promise(resolveWait => setTimeout(resolveWait, 1000));
  }
  if (!observed?.booted || !Number.isInteger(observed.status))
    throw Error("Current Control Plane did not start offline");
  console.log(JSON.stringify({ state: "current_control_plane_started_offline",
    sourceFilesVerified: 24, reconstructedVersion: 38, bundleSha256,
    syntheticOptionsStatus: observed.status, network: "none", realCredentials: false,
    providerRequests: 0, productionDataWrites: false,
    limitation: "Module startup only; authenticated recovery and provider restart remain unproven." }));
} finally {
  if (created) {
    const inspected = run(docker, ["inspect", "--format", "{{json .Config.Labels}}", container]);
    if (inspected.status !== 0 || JSON.parse(inspected.stdout)[label.split("=")[0]] !== label.split("=")[1])
      throw Error("Offline startup container cleanup identity unconfirmed");
    const removed = run(docker, ["rm", "-f", container]);
    if (removed.status !== 0) throw Error("Offline startup container cleanup failed");
  }
  rmSync(tmp, { recursive: true, force: true });
}
