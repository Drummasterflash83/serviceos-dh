/** Offline release inventory only. Does not deploy, read secrets or call a provider. */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { edgeRuntimeBundle } from "./learn-email-runtime-edge-bundle.mjs";

export const PRODUCTION_PROJECT = "tgbnakbxwcqjeimygroz";
// Explicit candidate flags, not supabase/config.toml defaults. Gateway flags do
// not replace endpoint authorization. The four legacy callers are part of the
// same review even though they are absent from the hosted TEST inventory.
const jwt = [
  "learn-launch-status", "work-transition", "learn-slack-worker",
  "simwood-sync-calls", "simwood-sync-recordings", "simwood-download-recording",
  "simwood-test-connection", "learn-data-import", "learn-commusoft-worker",
  "learn-commusoft-verify", "gmail-sync-messages", "gmail-workspace-sync-messages",
  "gmail-workspace-backfill-messages", "learn-slack-schedule", "phone-process-pending",
  "phone-transcribe-recording", "phone-analyse-transcript", "phone-process-pipeline",
  "learn-phone-playback", "phone-call-detail", "customer-card-sync",
  "google-workspace-discover-mailboxes", "interactions-sync", "identity-resolve",
  "receptionist-voicemail-recording", "learn-operator-phone-playback",
];
const customAuth = [
  "platform-worker", "openfolk-control-plane", "phone-scheduled-sync",
  "email-scheduled-sync", "email-workspace-scheduled-sync",
  "email-workspace-backfill-scheduled-sync", "learn-voicemail-import",
  "customer-card-scheduled-sync", "interactions-scheduled-sync",
  "identity-scheduled-sync", "phone-processing-scheduled-sync",
];
export const PRODUCTION_RUNTIME_ENDPOINTS = [
  ...jwt.map(name => ({ name, verifyJwt: true })),
  ...customAuth.map(name => ({ name, verifyJwt: false })),
].sort((a, b) => a.name.localeCompare(b.name));
const sha = value => createHash("sha256").update(value).digest("hex");

export function inspectRuntimeSource(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const environment = new Set(), rpc = new Set(), literalCalls = new Set(), unresolved = [];
  function walk(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file), arg = node.arguments[0];
      const kind = callee === "Deno.env.get" ? "environment"
        : callee.endsWith(".rpc") ? "rpc"
        : callee === "invokeFunction" || callee.endsWith(".functions.invoke") ? "function" : null;
      if (kind) {
        if (arg && ts.isStringLiteral(arg)) {
          (kind === "environment" ? environment : kind === "rpc" ? rpc : literalCalls).add(arg.text);
        } else {
          unresolved.push({ kind, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(file);
  return { environment: [...environment].sort(), rpc: [...rpc].sort(),
    literalCalls: [...literalCalls].sort(), unresolved };
}

export function validateInventory(rows) {
  if (!Array.isArray(rows) || new Set(rows.map(r => r.name)).size !== rows.length ||
      rows.some(r => !/^[a-z][a-z0-9-]+$/.test(r.name) ||
        !Number.isSafeInteger(r.version) || r.version < 1 || typeof r.jwt !== "boolean" ||
        !/^[a-f0-9]{64}$/.test(r.hash) || typeof r.id !== "string" || r.status !== "ACTIVE"))
    throw Error("Complete active endpoint metadata required");
  // Whitelist metadata: never copy arbitrary provider fields into Git.
  return rows.map(({ name, id, version, hash, jwt, status }) => ({ name, id, version, hash, jwt, status }));
}

export function productionRuntimeCandidate({ production, test, read = p => readFileSync(p, "utf8") }) {
  production = validateInventory(production);
  test = validateInventory(test);
  const database = readdirSync("supabase/release/learn-production")
    .filter(n => /^\d{3}_.+\.manifest\.json$/.test(n)).sort().map((name, index) => {
      if (Number(name.slice(0, 3)) !== index + 1) throw Error("Ordered SQL package sequence required");
      const path = "supabase/release/learn-production/" + name;
      const manifest = JSON.parse(read(path)), sqlPath = path.replace(".manifest.json", ".sql");
      if (manifest.projectRef !== PRODUCTION_PROJECT || sha(read(sqlPath)) !== manifest.sha256)
        throw Error("Production SQL package pin differs: " + name);
      for (const source of manifest.sources ?? [])
        if (sha(read(source.path)) !== source.sha256) throw Error("SQL source pin differs: " + source.path);
      return { path: sqlPath, sha256: manifest.sha256, manifestSha256: sha(read(path)) };
    });
  if (database.length !== 22) throw Error("Reviewed twenty-two-package production candidate required");
  const combined = edgeRuntimeBundle(PRODUCTION_RUNTIME_ENDPOINTS);
  const analyses = new Map(combined.files.map(f => [f.path, inspectRuntimeSource(f.path, f.source)]));
  const endpoints = PRODUCTION_RUNTIME_ENDPOINTS.map(endpoint => {
    const bundle = edgeRuntimeBundle([endpoint]);
    const existing = production.find(r => r.name === endpoint.name) ?? null;
    const reference = test.find(r => r.name === endpoint.name) ?? null;
    if (reference && reference.jwt !== endpoint.verifyJwt) throw Error("TEST gateway reference differs");
    return { ...endpoint, sourceClosureSha256: bundle.sha256, sourceFiles: bundle.files.map(f => f.path),
      environmentNames: [...new Set(bundle.files.flatMap(f => analyses.get(f.path).environment))].sort(),
      literalRpcNames: [...new Set(bundle.files.flatMap(f => analyses.get(f.path).rpc))].sort(),
      beforeProduction: existing, hostedTestReference: reference,
      gatewayChange: existing ? existing.jwt !== endpoint.verifyJwt : null,
      authorizationAndCallerAcceptance: "pending" };
  });
  return {
    version: "learn-production-runtime-candidate/1", projectRef: PRODUCTION_PROJECT,
    state: "prepared_not_approved_or_deployed", database,
    sourceClosureSha256: combined.sha256,
    files: combined.files.map(f => ({ path: f.path, sha256: sha(f.source) })),
    externalImports: combined.external, endpoints,
    requiredNonSecretConfiguration: {
      "learn-launch-status": { LEARN_STATUS_READ_MODE: "production_metadata_views" },
      "platform-worker": { LEARN_INPUT_DISPATCH_ENABLED: "true" },
    },
    literalFunctionCalls: [...analyses].flatMap(([path, a]) => a.literalCalls.map(target => ({ path, target,
      inCandidate: PRODUCTION_RUNTIME_ENDPOINTS.some(e => e.name === target) }))),
    unresolvedCalls: [...analyses].flatMap(([path, a]) => a.unresolved.map(row => ({ path, ...row }))),
    productionEndpointsOutsideCandidate: production.filter(r => !endpoints.some(e => e.name === r.name)),
    releaseGates: [
      "Review dynamic dispatch and existing non-LEARN handlers in the shared worker.",
      "Verify deployed source provenance, caller/auth compatibility and required secret availability; names are not values or proof of configuration.",
      "Stage and verify the exact dependency closure in the Edge runtime; an import inventory is not an executable bundle or runtime test.",
      "Re-read current production schema, endpoint versions, schedules and preservation baseline before any approval/execution.",
      "Pin the matching frontend artifact, production environment and sign-in/tenant journeys.",
      "Prepare journaled deployment, schedule pause/resume and rollback before requesting production promotion approval.",
    ],
    limitations: [
      "Static literal calls are supporting review evidence, not complete data-flow analysis.",
      "Hosted ezbr hashes and source-closure hashes use different representations and are not comparable.",
      "External imports are recorded verbatim, not resolved, vendored or integrity-verified by this preparation.",
      "No database, provider, credential, access grant, schedule or deployed function is changed.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [productionPath, testPath, outputPath] = process.argv.slice(2);
  if (!productionPath || !testPath || !outputPath) throw Error("Provide production inventory, TEST inventory and output paths");
  const candidate = productionRuntimeCandidate({ production: JSON.parse(readFileSync(productionPath)),
    test: JSON.parse(readFileSync(testPath)) });
  writeFileSync(outputPath, JSON.stringify(candidate, null, 2) + "\n");
  console.log(JSON.stringify({ state: candidate.state, endpoints: candidate.endpoints.length,
    files: candidate.files.length, databasePackages: candidate.database.length,
    sourceClosureSha256: candidate.sourceClosureSha256, unresolvedCalls: candidate.unresolvedCalls.length }));
}
