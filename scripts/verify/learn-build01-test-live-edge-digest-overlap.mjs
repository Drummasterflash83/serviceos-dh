/** Names/digests only: find existing TEST bindings usable for recovery rehearsal. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--read-only")
  throw Error("Exact read-only mode required");
const LIVE = "tgbnakbxwcqjeimygroz";
const names = [
  "GOOGLE_CLIENT_SECRET", "GOOGLE_WORKSPACE_PRIVATE_KEY",
  "LEARN_COMMUSOFT_WORKER_KEY", "LEARN_QUICKBOOKS_WORKER_KEY",
  "LEARN_SLACK_EVENTS_SIGNING_SECRET", "LEARN_SLACK_WORKER_KEY",
  "MARKETING_TRACKING_SECRET", "OPENAI_API_KEY", "OPENAI_EMMA_REVIEW_KEY",
  "OPENFOLK_CONTROLPLANE_KEY", "PHONE_OPERATIONS_WEBHOOK_SECRET",
  "RECEPTIONIST_SLACK_DRUMMONDS", "RECEPTIONIST_VAPI_DRUMMONDS",
  "RESEND_API_KEY", "SIMWOOD_PASSWORD", "SIMWOOD_USERNAME",
];
const token = savedCliToken();
async function inventory(project) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/secrets`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Secret-digest read failed for ${project} (HTTP ${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length > 200 || rows.some(row =>
    typeof row.name !== "string" || !/^[a-f0-9]{64}$/.test(row.value ?? row.digest ?? "")))
    throw Error(`Secret-digest response changed for ${project}`);
  const map = new Map();
  for (const row of rows) {
    if (map.has(row.name)) throw Error(`Duplicate secret name in ${project}`);
    map.set(row.name, row.value ?? row.digest);
  }
  return map;
}
const [live, test] = await Promise.all([inventory(LIVE), inventory(TEST_PROJECT)]);
const sharedExact = [], sharedDifferent = [], liveOnly = [], testOnly = [];
for (const name of names) {
  const liveHash = live.get(name), testHash = test.get(name);
  if (liveHash && testHash) (liveHash === testHash ? sharedExact : sharedDifferent).push(name);
  else if (liveHash) liveOnly.push(name);
  else if (testHash) testOnly.push(name);
}
console.log(JSON.stringify({ version: "learn-build01-test-live-edge-digest-overlap/1",
  observedAtUtc: new Date().toISOString(), liveProject: LIVE, testProject: TEST_PROJECT,
  reviewedNames: names.length, sharedExact, sharedDifferent, liveOnly, testOnly,
  digestValuesReturned: false, plaintextValuesRead: false,
  productionDataWrites: false, providerWrites: false,
  limitation: "Equal Edge digests establish matching configured values, not permission to call providers from TEST or proof that a replacement project can restore credentials." }));
