/** Prepare exact function-only production package. No hosted operations. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = p => readFileSync(p, "utf8"), sha = x => createHash("sha256").update(x).digest("hex");
const quote = x => "'" + x.replaceAll("'", "''") + "'";
const root = "supabase/release/learn-production/";
const prior = JSON.parse(read(root + "018_slack_user_operator.manifest.json"));
const catalog = JSON.parse(read(".verification-results/production-slack-setup-rehearsal-v2/schema.json"));
const rehearsal = JSON.parse(read(".verification-results/production-slack-setup-rehearsal-v2/report.json"));
if (rehearsal.state !== "production_slack_setup_rehearsed_offline" || !rehearsal.containerRemoved ||
    rehearsal.packages.length !== 18 || rehearsal.packages.at(-1) !== prior.sha256 ||
    sha(read(root + "018_slack_user_operator.sql")) !== prior.sha256 ||
    JSON.stringify(rehearsal.archive) !== JSON.stringify(prior.baselineArchive)) throw Error("Reviewed prior archive rehearsal required");
const changedFunctions = ["learn_slack_claim_jobs", "learn_slack_reference_guard"];
// pg_get_functiondef qualifies composite return types according to search_path.
// Use the same postgres/public context as the package guard, measured on the
// identical 001–018 schema; do not mistake that rendering difference for drift.
const contextRoot=".verification-results/production-slack-recurring-rehearsal-v4/";
const originalContext=JSON.parse(read(contextRoot+"before-schema.json"));
const packageContext=JSON.parse(read(contextRoot+"package-context-schema.json"));
if(JSON.stringify(originalContext)!==JSON.stringify(catalog))throw Error("Normalization source schema differs");
const functions=packageContext.functions.filter(f=>changedFunctions.includes(f.name)).sort((a,b)=>a.name.localeCompare(b.name)||a.arguments.localeCompare(b.arguments));
for(const f of functions){const old=catalog.functions.find(x=>x.name===f.name&&x.arguments===f.arguments);
 if(!old||JSON.stringify({...old,hash:f.hash})!==JSON.stringify(f))throw Error("Function authority differs under package context");}
const newFunctions=["learn_slack_recurring_attribution_allowed"];
if(functions.length!==2 || catalog.functions.some(f=>newFunctions.includes(f.name)))throw Error("Slack recurring attribution baseline differs");
const path = "supabase/migrations/20261101590000_learn_slack_recurring_attribution.sql";
const migration = read(path), sources = [{ path, sha256: sha(migration) }];
if ((migration.match(/^begin;$/gm) ?? []).length !== 1 || (migration.match(/^commit;$/gm) ?? []).length !== 1)
  throw Error("Single migration transaction required");
const body = migration.replace(/^begin;\n/m, "").replace(/^commit;\n/m, "");
const inventory = read("scripts/verify/learn-release-schema-inventory.sql").trim().replace(/;$/, "");
const sql = `-- DRAFT: recorded operator attribution for recurring Slack work; no activation or data modification.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production recurring Slack attribution target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_user_operator_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then
  raise exception 'Pinned production recurring Slack attribution prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_recurring_attribution_v1')
 or to_regprocedure('public.learn_slack_recurring_attribution_allowed(text,jsonb)') is not null then
  raise exception 'Production recurring Slack attribution candidate already exists; inspect before retry';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into observed from (${inventory}) q,
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${changedFunctions.map(quote).join(",")}]);
 if observed is distinct from ${quote(JSON.stringify(functions))}::jsonb then
  raise exception 'Production recurring Slack attribution function baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_slack_recurring_attribution_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const stem = root + "019_slack_recurring_attribution";
writeFileSync(stem + ".sql", sql);
writeFileSync(stem + ".manifest.json", JSON.stringify({ version: "learn-production-slack-recurring-attribution/1",
  status: "prepared_requires_matching_release_verification", projectRef: "tgbnakbxwcqjeimygroz",
  sha256: sha(sql), priorSha256: prior.sha256, baselineArchive: prior.baselineArchive, sources,
  newFunctions, changedFunctions, newTables: [], changedViews: [], newSequences: [], extendedTables: {},
  limitations: ["No subscription, credential, grant, job or hosted provider request is created by installation.",
    "Existing operator authority and exact enabled subscription, connection, source and queued job must match.",
    "Real-provider ongoing capture, complete history and private-channel visibility remain separate acceptance requirements."] }, null, 2) + "\n");
console.log(JSON.stringify({ sha256: sha(sql), changedFunctions: functions.length, newFunctions: 1 }));
