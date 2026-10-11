#!/usr/bin/env python3
"""Offline actual Supabase user-worker compatibility check; no repo/secret mount."""
import json
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
IMAGE = "public.ecr.aws/supabase/edge-runtime:v1.74.3"
DOCKER = "/usr/local/bin/docker"
name = "serviceos-voicemail-edge-" + uuid.uuid4().hex[:8]

with tempfile.TemporaryDirectory(prefix="serviceos-voicemail-edge-") as tmp:
    stage = Path(tmp)
    package = stage / "scripts/verify/voicemail-auth"
    package.mkdir(parents=True)
    source = ROOT / "scripts/verify/voicemail-auth"
    for filename in ("package.json", "package-lock.json"):
        shutil.copy2(source / filename, stage / filename)
    shutil.copytree(source / "node_modules", stage / "node_modules")
    shared = stage / "supabase/functions/_shared"
    shared.mkdir(parents=True)
    shutil.copy2(ROOT / "supabase/functions/_shared/birchills_voicemail_email.ts", shared)
    shutil.copytree(ROOT / "supabase/functions/_shared/voicemail", shared / "voicemail")
    fixture = subprocess.run(["node", str(source / "edge-fixture.mjs")], check=True, capture_output=True, text=True)
    (package / "fixture.json").write_text(fixture.stdout)
    (stage / "deno.json").write_text(json.dumps({"nodeModulesDir": "manual"}))
    shutil.copy2(source / "edge-runtime-probe.ts", package / "index.ts")
    main = stage / "main"
    main.mkdir()
    (main / "index.ts").write_text('''
Deno.serve(async (req) => {
try {
  const worker = await EdgeRuntime.userWorkers.create({
    servicePath:"/work/scripts/verify/voicemail-auth", memoryLimitMb:256,
    workerTimeoutMs:30000, noModuleCache:false, envVars:[], forceCreate:true,
    cpuTimeSoftLimitMs:2000, cpuTimeHardLimitMs:2000,
  });
  return await worker.fetch(req);
} catch (e) { return Response.json({state:"failed",error:e.message}, {status:500}); }
});
const response = await fetch("http://127.0.0.1:9000/check");
console.log("EDGE_RESULT=" + await response.text());
''')
    try:
        subprocess.run([DOCKER, "run", "-d", "--pull=never", "--network", "none", "--name", name,
                        "--mount", f"type=bind,source={stage},target=/work,readonly", IMAGE,
                        "start", "--main-service", "/work/main"], check=True, capture_output=True, text=True)
        # Poll the confirmed container, never recreate on a delayed observation.
        import time
        output = ""
        for _ in range(40):
            logs = subprocess.run([DOCKER, "logs", name], check=True, capture_output=True, text=True)
            output = logs.stdout + logs.stderr
            if "EDGE_RESULT=" in output:
                break
            state = subprocess.run([DOCKER, "inspect", "--format", "{{.State.Running}}", name], check=True, capture_output=True, text=True)
            if state.stdout.strip() != "true":
                break
            time.sleep(1)
        results = [line.split("EDGE_RESULT=", 1)[1] for line in output.splitlines() if "EDGE_RESULT=" in line]
        if not results or json.loads(results[-1]).get("state") != "passed":
            print(output)
            raise SystemExit("Offline Edge user-worker compatibility not proven")
        image_id = subprocess.run([DOCKER, "image", "inspect", IMAGE, "--format", "{{.Id}}"], check=True, capture_output=True, text=True).stdout.strip()
        tracked_sources = [ROOT / "supabase/functions/_shared/birchills_voicemail_email.ts",
                           *sorted((ROOT / "supabase/functions/_shared/voicemail").glob("*.js")),
                           source / "edge-fixture.mjs", source / "edge-runtime-probe.ts",
                           source / "package-lock.json", Path(__file__).resolve()]
        print(json.dumps({
            "observedAt": datetime.now(timezone.utc).isoformat(),
            "scope": "local_offline_actual_supabase_user_worker",
            "image": IMAGE, "imageId": image_id,
            "network": "none", "customerData": False, "credentials": False,
            "workerLimits": {"memoryMiB": 256, "cpuHardMs": 2000, "wallMs": 30000},
            "result": json.loads(results[-1]),
            "sourceSha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in tracked_sources},
            "limitations": ["controlled SDK transport; not hosted Storage or SQL", "synthetic audio only",
                            "DNS supplied by synthetic resolver", "no hosted deployment or provider activation"],
        }, indent=2))
    finally:
        subprocess.run([DOCKER, "rm", "-f", name], check=True, capture_output=True)
