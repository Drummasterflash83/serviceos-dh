/** Offline check of manually resolved RPC dispatch against the rehearsed schema.
 * No database connection, secrets, provider calls or deployment capability. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const root = "supabase/release/learn-production/";
const candidate = JSON.parse(readFileSync(root + "runtime-candidate.manifest.json"));
const review = JSON.parse(readFileSync(root + "rpc-bindings.review.json"));
const baselineBytes = readFileSync(".verification-results/production-learning-rehearsal-v2/schema.json");
const baseline = JSON.parse(baselineBytes);
const provenance = JSON.parse(readFileSync(".verification-results/production-learning-rehearsal-v2/report.json"));
const output = process.argv[2];
if (!/^\.verification-results\/[a-z0-9-]+\.json$/.test(output ?? ""))
  throw Error("Explicit private report path required");
if (sha(baselineBytes) !== review.baselineSchemaSha256 ||
    review.sourceClosureSha256 !== candidate.sourceClosureSha256 ||
    provenance.state !== "production_learning_rehearsed_offline" ||
    !provenance.containerRemoved || provenance.packages.length !== 22 ||
    !provenance.journey?.passed || candidate.database.length !== 22)
  throw Error("Rehearsed candidate provenance changed");
for (const [i, p] of candidate.database.entries()) {
  if (sha(readFileSync(p.path)) !== p.sha256 ||
      sha(readFileSync(p.path.replace(".sql", ".manifest.json"))) !== p.manifestSha256 ||
      provenance.packages[i] !== p.sha256)
    throw Error("Rehearsed SQL package changed");
}
for (const f of candidate.files)
  if (sha(readFileSync("supabase/functions/" + f.path)) !== f.sha256)
    throw Error("Runtime binding review is stale: " + f.path);
const siteKey = s => `${s.path}:${s.line}:${s.kind}`;
const keys = review.sites.map(siteKey);
if (keys.length !== candidate.unresolvedCalls.length || new Set(keys).size !== keys.length ||
    candidate.unresolvedCalls.some(s => !keys.includes(siteKey(s))))
  throw Error("Unresolved dispatch coverage changed");
const functions = [...baseline.functions];
const checks = review.sites.map(s => {
  if (s.sourceSha256 !== candidate.files.find(f => f.path === s.path)?.sha256 ||
      !s.resolution || !Array.isArray(s.targets) ||
      (!s.targets.length && s.path !== "_shared/voicemail/queue.ts"))
    throw Error("Incomplete binding review");
  return { path: s.path, line: s.line, targets: s.targets.map(t => {
    if (!/^[a-z][a-z0-9_]+$/.test(t.name) || !["authenticated", "service_role"].includes(t.role))
      throw Error("Unexpected RPC or role");
    const found = functions.filter(f => f.name === t.name);
    const permission = t.role === "authenticated" ? "authenticatedExecute" : "serviceExecute";
    return { ...t, found: found.length > 0, executeAllowed: found.some(f => f[permission] === true),
      schemaEvidence: "rehearsed_001_to_022_catalog" };
  }), resolution: s.resolution };
});
const failures = checks.flatMap(c => c.targets.filter(t => !t.found || !t.executeAllowed)
  .map(t => ({ path: c.path, line: c.line, ...t })));
const report = { version: "learn-production-rpc-bindings-check/1", observedAt: new Date().toISOString(),
  state: failures.length ? "rpc_binding_gap" : "reviewed_dynamic_rpc_targets_available",
  sourceClosureSha256: candidate.sourceClosureSha256, reviewSha256: sha(readFileSync(root + "rpc-bindings.review.json")),
  baselineSchemaSha256: sha(baselineBytes), reviewedSites: checks.length,
  uniqueTargets: new Set(checks.flatMap(c => c.targets.map(t => t.name))).size,
  checks, failures, productionChanges: 0, hostedTestChanges: 0,
  limitations: review.limitations,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ state: report.state, reviewedSites: checks.length,
  uniqueTargets: report.uniqueTargets, failures }));
if (failures.length) process.exitCode = 1;
