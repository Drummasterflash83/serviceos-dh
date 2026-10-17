/** Names-only reference inventory for the exact staged LIVE v107 Edge source. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

if (process.argv.slice(2).join(" ") !== "--reviewed-v107-source")
  throw Error("Exact reviewed v107 source mode required");
const stage = resolve(".verification-results/build01-edge-staged-v107");
const manifestPath = resolve(".verification-results/build01-runtime-archive-2026-10-16T23-22-48-811Z/manifest.private.json");
const bytes = readFileSync(manifestPath);
const sha = value => createHash("sha256").update(value).digest("hex");
const manifestSha256 = "4008cc502a41f5948cfea8e2d06fa3be26ff4f4f7828839f707724b7c49f1488";
if (sha(bytes) !== manifestSha256) throw Error("Reviewed v107 source manifest changed");
const manifest = JSON.parse(bytes);
if (manifest.entries?.length !== 103) throw Error("Reviewed v107 function count changed");
const names = [
  "GOOGLE_CLIENT_SECRET", "GOOGLE_WORKSPACE_PRIVATE_KEY",
  "LEARN_COMMUSOFT_WORKER_KEY", "LEARN_QUICKBOOKS_WORKER_KEY",
  "LEARN_SLACK_EVENTS_SIGNING_SECRET", "LEARN_SLACK_WORKER_KEY",
  "MARKETING_TRACKING_SECRET", "OPENAI_API_KEY", "OPENAI_EMMA_REVIEW_KEY",
  "OPENFOLK_CONTROLPLANE_KEY", "PHONE_OPERATIONS_WEBHOOK_SECRET",
  "RECEPTIONIST_SLACK_DRUMMONDS", "RECEPTIONIST_VAPI_DRUMMONDS",
  "RESEND_API_KEY", "SIMWOOD_PASSWORD", "SIMWOOD_USERNAME",
  "GOOGLE_CLIENT_ID", "GOOGLE_WORKSPACE_CLIENT_ID",
  "GOOGLE_WORKSPACE_DOMAIN", "GOOGLE_WORKSPACE_IMPERSONATION_SUBJECT",
];
const usage = new Map(names.map(name => [name, []]));
let sourceFiles = 0;
for (const entry of manifest.entries) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(entry.slug)) throw Error("Invalid function name");
  const seen = new Set();
  for (const file of entry.files) {
    const parts = file.path.split("/");
    if (parts.some(part => !part || part === "." || part === ".."))
      throw Error("Invalid reviewed source path");
    let path;
    if (parts[0] === "functions")
      path = join(stage, entry.slug, "supabase", file.path);
    else if (parts[0] === "work" && parts[1] === "supabase")
      path = join(stage, entry.slug, ...parts.slice(1));
    else if (parts.length === 1)
      path = join(stage, entry.slug, "supabase", "functions", entry.slug, file.path);
    else throw Error("Unrecognised reviewed source path");
    const content = readFileSync(path);
    if (content.length !== file.bytes || sha(content) !== file.sha256)
      throw Error("Reviewed v107 source file changed");
    sourceFiles++;
    const text = content.toString("utf8");
    for (const name of names) {
      if (text.includes(`Deno.env.get("${name}")`) ||
          text.includes(`Deno.env.get('${name}')`) ||
          text.includes(`process.env.${name}`)) seen.add(name);
    }
  }
  for (const name of seen) usage.get(name).push(entry.slug);
}
if (sourceFiles !== 728) throw Error("Reviewed v107 source file count changed");
console.log(JSON.stringify({
  version: "learn-build01-v107-runtime-credential-usage/1",
  observedAtUtc: new Date().toISOString(), sourceManifestSha256: manifestSha256,
  reviewedFunctions: 103, reviewedFiles: sourceFiles,
  literalLookups: Object.fromEntries([...usage].map(([name, functions]) =>
    [name, { functionCount: functions.length, functions: functions.sort() }])),
  secretValuesRead: false, productionDataWrites: false,
  limitation: "Static literal lookups in the exact staged source only. Dynamic environment-name references and actual provider use require separate review. A configured setting with no literal read here may still be legacy or dynamically accessed.",
}));
