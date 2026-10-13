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
const planningRoot = '.verification-results/production-review-planning-rehearsal-v4/';
const planning = JSON.parse(readFileSync(planningRoot+'report.json'));
const planningSchemaBytes = readFileSync(planningRoot+'schema.json');
const planningSchema = JSON.parse(planningSchemaBytes);
const campaignRoot='.verification-results/production-slack-campaign-rehearsal-v4/';
const campaign=JSON.parse(readFileSync(campaignRoot+'report.json'));
const campaignSchemaBytes=readFileSync(campaignRoot+'schema.json');
const campaignSchema=JSON.parse(campaignSchemaBytes);
const campaignManifest=JSON.parse(readFileSync(root+'024_slack_campaigns.manifest.json'));
const output = process.argv[2];
if (!/^\.verification-results\/[a-z0-9-]+\.json$/.test(output ?? ""))
  throw Error("Explicit private report path required");
if (sha(baselineBytes) !== review.baselineSchemaSha256 ||
    review.sourceClosureSha256 !== candidate.sourceClosureSha256 ||
    provenance.state !== "production_learning_rehearsed_offline" ||
    !provenance.containerRemoved || provenance.packages.length !== 22 ||
    !provenance.journey?.passed || candidate.database.length !== 24 ||
    planning.state !== 'production_review_planning_rehearsed_offline' ||
    !planning.containerRemoved || planning.packages !== 23 ||
    planning.packageSha256 !== candidate.database[22].sha256 ||
    !planning.bodyOwnerAndAclUnchanged || !planning.otherSchemaUnchanged || !planning.permissionProbePassed ||
    campaign.state!=='production_slack_campaigns_rehearsed_offline'||!campaign.containerRemoved||campaign.packages!==24||
    campaign.packageSha256!==candidate.database[23].sha256||!campaign.previouslyRehearsedSchemaWithExplicitNewPostgresOwnership||
    !campaign.packageRollbackVerified||!campaign.priorReceiptsUnchanged||!campaign.duplicateRejected||
    campaign.journeys.length!==10||campaign.journeys.some(j=>!j.passed))
  throw Error("Rehearsed candidate provenance changed");
for (const [i, p] of candidate.database.entries()) {
  if (sha(readFileSync(p.path)) !== p.sha256 ||
      sha(readFileSync(p.path.replace(".sql", ".manifest.json"))) !== p.manifestSha256 ||
      (i < 22 ? provenance.packages[i] : i===22 ? planning.packageSha256 : campaign.packageSha256) !== p.sha256)
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
// Only the reviewed work-search definition hash may differ; its authority and
// every other function must still match the prior complete RPC review.
const oldFunctions=baseline.functions.map(f=>f.name==='learn_commusoft_work_review_search'?{...f,hash:null}:f);
const newFunctions=planningSchema.functions.map(f=>f.name==='learn_commusoft_work_review_search'?{...f,hash:null}:f);
if(JSON.stringify(oldFunctions)!==JSON.stringify(newFunctions)) throw Error('RPC catalog changed beyond planning setting');
const functionKey=f=>JSON.stringify([f.name,f.arguments]);
const oldCatalog=new Map(planningSchema.functions.map(f=>[functionKey(f),f]));
const newCatalog=new Map(campaignSchema.functions.map(f=>[functionKey(f),f]));
const changed=[];
for(const [key,prior] of oldCatalog){
 const current=newCatalog.get(key);
 if(!current||JSON.stringify({...prior,hash:current.hash})!==JSON.stringify(current))throw Error('Existing RPC authority changed');
 if(prior.hash!==current.hash)changed.push(prior.name);
}
const added=campaignSchema.functions.filter(f=>!oldCatalog.has(functionKey(f)));
if(JSON.stringify(changed.sort())!==JSON.stringify(campaignManifest.changedFunctions)||
 JSON.stringify(added.map(f=>f.name).sort())!==JSON.stringify(campaignManifest.newFunctions)||
 added.some(f=>f.owner!=='postgres'||f.anonExecute))throw Error('Campaign RPC delta differs');
for(const name of ['learn_slack_campaign_reserve_request','learn_slack_schedule_campaigns']){
 const matches=added.filter(f=>f.name===name);
 if(matches.length!==1||!matches[0].serviceExecute||matches[0].authenticatedExecute)throw Error('New worker RPC binding differs');
}
const functions = [...campaignSchema.functions];
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
      schemaEvidence: "rehearsed_001_to_024_catalog" };
  }), resolution: s.resolution };
});
const failures = checks.flatMap(c => c.targets.filter(t => !t.found || !t.executeAllowed)
  .map(t => ({ path: c.path, line: c.line, ...t })));
const report = { version: "learn-production-rpc-bindings-check/1", observedAt: new Date().toISOString(),
  state: failures.length ? "rpc_binding_gap" : "reviewed_dynamic_rpc_targets_available",
  sourceClosureSha256: candidate.sourceClosureSha256, reviewSha256: sha(readFileSync(root + "rpc-bindings.review.json")),
  baselineSchemaSha256: sha(campaignSchemaBytes), priorReviewedSchemaSha256: sha(baselineBytes), reviewedSites: checks.length,
  uniqueTargets: new Set(checks.flatMap(c => c.targets.map(t => t.name))).size,
  checks, failures, productionChanges: 0, hostedTestChanges: 0,
  limitations: review.limitations,
};
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
console.log(JSON.stringify({ state: report.state, reviewedSites: checks.length,
  uniqueTargets: report.uniqueTargets, failures }));
if (failures.length) process.exitCode = 1;
