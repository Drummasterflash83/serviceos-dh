/** Read-only TEST/LIVE platform-worker version and executable fingerprint. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";
const mode = process.argv.slice(2).join(" ");
const project = mode === "--test-read-only" ? TEST_PROJECT
  : mode === "--live-read-only" ? "tgbnakbxwcqjeimygroz" : null;
if (!project) throw Error("Exact project read-only mode required");
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/functions`, {
  headers: { Authorization: `Bearer ${savedCliToken()}` }, redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw Error(`Worker inventory HTTP ${response.status}`);
const functions = await response.json();
const worker = functions.find((entry) => entry.slug === "platform-worker");
if (!worker || !Number.isInteger(worker.version) ||
    !/^[a-f0-9]{64}$/.test(worker.ezbr_sha256 ?? ""))
  throw Error("Worker inventory shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  version: worker.version, wireSha256: worker.ezbr_sha256,
  verifyJwt: worker.verify_jwt, status: worker.status,
  functionCount: functions.length, productionDataWrites: false }));
