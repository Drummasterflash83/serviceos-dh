/** Match reviewed non-secret configuration candidates against LIVE Edge digests. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const activation = JSON.parse(readFileSync(
  "docs/operations/evidence/learn-build01-slack-events-live-activation-2026-10-16.json", "utf8"));
const handoff = JSON.parse(readFileSync(
  "docs/operations/evidence/learn-build01-slack-20-handoff-live-2026-10-16.json", "utf8"));
if (activation.project_ref !== "tgbnakbxwcqjeimygroz" ||
    handoff.projectRef !== activation.project_ref ||
    handoff.currentEnabledUniquePublicChannels !== 180 ||
    activation.slack_team_id !== handoff.teamId ||
    activation.tenant_id !== handoff.tenantId)
  throw Error("Reviewed LIVE configuration receipts changed");

const candidates = new Map([
  ["GOOGLE_REDIRECT_URI", ["https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1/gmail-oauth-callback"]],
  ["LEARN_INPUT_DISPATCH_ENABLED", ["true", "false"]],
  ["LEARN_QUICKBOOKS_DISPATCH_ENABLED", ["true", "false"]],
  ["LEARN_SLACK_DISPATCH_ENABLED", ["true", "false"]],
  ["LEARN_SLACK_EVENTS_ACTIVE", ["true", "false"]],
  ["LEARN_SLACK_EVENTS_APP_ID", [activation.slack_app_id]],
  ["LEARN_SLACK_EVENTS_EXPECTED_CHANNELS", [String(handoff.currentEnabledUniquePublicChannels)]],
  ["LEARN_SLACK_EVENTS_MIN_TS", [activation.saved_cutoff]],
  ["LEARN_SLACK_EVENTS_ROSTER_SHA256", [handoff.currentRosterSha256]],
  ["LEARN_SLACK_EVENTS_TEAM_ID", [handoff.teamId]],
  ["LEARN_SLACK_EVENTS_TENANT_ID", [handoff.tenantId]],
  ["LEARN_STATUS_READ_MODE", ["production_metadata_views"]],
  ["QUICKBOOKS_MINOR_VERSION", ["75"]],
  ["QUICKBOOKS_SITE_ORIGIN", ["https://www.openfolk.ai"]],
  ["MARKETING_PUBLIC_BASE_URL", ["https://tgbnakbxwcqjeimygroz.supabase.co/functions/v1"]],
  ["OPENAI_ANALYSIS_MODEL", ["gpt-4o-mini"]],
  ["OPENAI_EMMA_REVIEW_MODEL", ["gpt-4.1-mini"]],
  ["OPENAI_TRANSCRIPTION_MODEL", ["gpt-4o-transcribe"]],
]);
const response = await fetch(
  "https://api.supabase.com/v1/projects/tgbnakbxwcqjeimygroz/secrets", {
    headers: { Authorization: `Bearer ${savedCliToken()}` },
    redirect: "error", signal: AbortSignal.timeout(30000),
  });
if (!response.ok) throw Error(`LIVE Edge digest read failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 200 || rows.some(row =>
  typeof row.name !== "string" || !/^[a-f0-9]{64}$/.test(row.value ?? "")))
  throw Error("LIVE Edge digest response changed");
const configured = new Map(rows.map(row => [row.name, row.value]));
const sha = value => createHash("sha256").update(value).digest("hex");
const matched = [], unmatched = [], absent = [];
for (const [name, values] of candidates) {
  if (!configured.has(name)) { absent.push(name); continue; }
  if (values.some(value => sha(value) === configured.get(name))) matched.push(name);
  else unmatched.push(name);
}
console.log(JSON.stringify({
  version: "learn-build01-nonsecret-runtime-reconstruction/1",
  observedAtUtc: new Date().toISOString(), environment: "LIVE",
  reviewedCandidateNames: candidates.size, matchedNames: matched.sort(),
  unmatchedNames: unmatched.sort(), absentNames: absent.sort(),
  currentValuesReturned: false, digestValuesReturned: false,
  sensitiveCredentialCandidatesTested: false, productionDataWrites: false,
  limitation: "A digest match establishes the reviewed non-secret candidate's current value only; it does not back up provider credentials or prove all-function recovery.",
}));
