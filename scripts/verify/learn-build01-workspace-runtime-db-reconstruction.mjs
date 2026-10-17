/** Check whether restored tenant metadata reproduces active non-secret Workspace settings. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const snapshot = "2026-10-17T07:52:11.013627Z";
const auth = { Authorization: `Bearer ${savedCliToken()}` };
const root = `https://api.supabase.com/v1/projects/${project}`;
const secretsResponse = await fetch(`${root}/secrets`, {
  headers: auth, redirect: "error", signal: AbortSignal.timeout(30000),
});
if (!secretsResponse.ok) throw Error(`LIVE Edge metadata read failed (HTTP ${secretsResponse.status})`);
const secrets = await secretsResponse.json();
if (!Array.isArray(secrets) || secrets.length > 200 || secrets.some(row =>
  typeof row.name !== "string" || !/^[a-f0-9]{64}$/.test(row.value ?? "")))
  throw Error("LIVE Edge digest response changed");
const byName = new Map(secrets.map(row => [row.name, row.value]));
const fields = [
  ["GOOGLE_WORKSPACE_CLIENT_EMAIL", "service_account_email"],
  ["GOOGLE_WORKSPACE_CLIENT_ID", "service_account_client_id"],
  ["GOOGLE_WORKSPACE_DOMAIN", "domain"],
  ["GOOGLE_WORKSPACE_IMPERSONATION_SUBJECT", "impersonation_subject"],
  ["GOOGLE_WORKSPACE_PROJECT_ID", "split_part(split_part(service_account_email,'@',2),'.iam.gserviceaccount.com',1)"],
];
if (fields.some(([name]) => !byName.has(name))) throw Error("Expected Workspace setting missing");
const digestEquals = (expression, digest) =>
  `encode(extensions.digest(convert_to(${expression},'UTF8'),'sha256'),'hex')='${digest}'`;
const projections = fields.map(([name, expression], index) =>
  `coalesce(bool_or(${digestEquals(expression, byName.get(name))}),false) as match_${index}`);
const query = `begin read only; select count(*)::int as eligible_rows,
  ${projections.join(",\n  ")}
  from public.google_workspace_connections
  where tenant_id='${tenant}'::uuid
    and updated_at<='${snapshot}'::timestamptz; commit;`;
const response = await fetch(`${root}/database/query`, {
  method: "POST", headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw Error(`Read-only Workspace metadata comparison failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !Number.isInteger(rows[0].eligible_rows) ||
    fields.some((_, index) => typeof rows[0][`match_${index}`] !== "boolean"))
  throw Error("Workspace comparison shape changed");
const matchedNames = fields.filter((_, index) => rows[0][`match_${index}`]).map(([name]) => name);
const unmatchedNames = fields.filter((_, index) => !rows[0][`match_${index}`]).map(([name]) => name);
console.log(JSON.stringify({
  version: "learn-build01-workspace-runtime-db-reconstruction/1",
  observedAtUtc: new Date().toISOString(), environment: "LIVE", project,
  scheduledDatabaseSnapshotAtUtc: snapshot, eligibleRowsInSnapshot: rows[0].eligible_rows,
  reviewedCandidateNames: fields.length, matchedNames, unmatchedNames,
  plaintextValuesReturned: false, digestValuesReturned: false,
  productionDataWrites: false,
  limitation: "Digest parity with a pre-snapshot tenant row proves only that the named non-secret setting can be reconstructed from the backup; it does not verify the Workspace private key or provider access.",
}));
