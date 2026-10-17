/** Names-only LIVE check of the five active Edge credentials outside the
 * approved eleven-setting LEARN recovery package. No value or digest output. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const manifest = ".verification-results/build01-runtime-archive-2026-10-16T23-22-48-811Z/manifest.private.json";
const manifestSha256 = "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488";
const sha = value => createHash("sha256").update(value).digest("hex");
if (sha(readFileSync(manifest)) !== manifestSha256)
  throw Error("Reviewed LIVE source inventory changed");
const names = ["MARKETING_TRACKING_SECRET", "OPENAI_EMMA_REVIEW_KEY",
  "RECEPTIONIST_SLACK_DRUMMONDS", "RECEPTIONIST_VAPI_DRUMMONDS", "RESEND_API_KEY"];
const source = ".verification-results/build01-runtime-archive-2026-10-16T23-22-48-811Z";
const uses = [
  ["marketing-track", "supabase/functions/marketing-track/index.ts", "MARKETING_TRACKING_SECRET"],
  ["receptionist-task-review", "supabase/functions/receptionist-task-review/index.ts", "OPENAI_EMMA_REVIEW_KEY"],
  ["client-notifications", "supabase/functions/client-notifications/index.ts", "Deno.env.get(w.slack_secret_name)"],
  ["receptionist-calls", "supabase/functions/receptionist-calls/index.ts", "Deno.env.get(w.vapi_secret_name)"],
  ["platform-worker", "supabase/functions/platform-worker/functions/_shared/connectors/marketing_email.ts", "RESEND_API_KEY"],
];
for (const [slug, relative, expected] of uses) {
  const file = `${source}/${slug}/${relative}`;
  if (!readFileSync(file, "utf8").includes(expected))
    throw Error(`Reviewed source use changed for ${slug}`);
}
const token = savedCliToken();
const management = `https://api.supabase.com/v1/projects/${project}`;
const [edge, roster] = await Promise.all([
  fetch(`${management}/secrets`, { redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}` } }),
  fetch(`${management}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `select vapi_secret_name,slack_secret_name
      from public.receptionist_workspaces where tenant_id='${tenant}'::uuid limit 2` }),
  }),
]);
if (!edge.ok || !roster.ok) throw Error("LIVE binding metadata unavailable");
const edgeRows = await edge.json(), workspaceRows = await roster.json();
if (!Array.isArray(edgeRows) || edgeRows.length !== 62 ||
    edgeRows.some(row => typeof row.name !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.value ?? "")) ||
    !Array.isArray(workspaceRows) || workspaceRows.length > 1)
  throw Error("LIVE binding shape changed");
const active = new Set(edgeRows.map(row => row.name));
if (active.size !== edgeRows.length || names.some(name => !active.has(name)))
  throw Error("One of five configured provider bindings changed");
const workspace = workspaceRows[0] ?? null;
const receptionistVapiBound = workspace?.vapi_secret_name === "RECEPTIONIST_VAPI_DRUMMONDS";
const receptionistSlackBound = workspace?.slack_secret_name === "RECEPTIONIST_SLACK_DRUMMONDS";
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  activeEdgeBindings: edgeRows.length, additionalConfiguredProviderBindings: names,
  reviewedSourceFunctions: uses.map(([slug]) => slug),
  receptionistWorkspaceExists: !!workspace,
  receptionistVapiBound, receptionistSlackBound,
  includedInApprovedElevenSettingPackage: false,
  sourceManifestSha256: manifestSha256,
  plaintextValuesReturned: false, digestValuesReturned: false,
  workspaceSecretNameValuesReturned: false, productionDataWrites: false,
  limitation: "Names and source use only; no credential recovery or provider restart." }));
