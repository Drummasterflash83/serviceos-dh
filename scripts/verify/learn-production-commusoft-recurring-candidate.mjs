/** Prepare recurring Commusoft production package; installation creates no active capture. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = p => readFileSync(p, "utf8"), sha = x => createHash("sha256").update(x).digest("hex");
const quote = x => "'" + x.replaceAll("'", "''") + "'";
const root = "supabase/release/learn-production/";
const prior = JSON.parse(read(root + "019_slack_recurring_attribution.manifest.json"));
const catalog = JSON.parse(read(".verification-results/production-slack-recurring-rehearsal-v5/schema.json"));
const rehearsal = JSON.parse(read(".verification-results/production-slack-recurring-rehearsal-v5/report.json"));
if (rehearsal.state !== "production_slack_recurring_rehearsed_offline" || !rehearsal.containerRemoved ||
    rehearsal.packages.length !== 19 || rehearsal.packages.at(-1) !== prior.sha256 ||
    sha(read(root + "019_slack_recurring_attribution.sql")) !== prior.sha256 ||
    JSON.stringify(rehearsal.archive) !== JSON.stringify(prior.baselineArchive)) throw Error("Reviewed prior archive rehearsal required");
const changedFunctions = ["learn_commusoft_acquire_page", "learn_commusoft_claim_jobs", "learn_commusoft_commit_page"];
const guardedFunctions = [...changedFunctions,"learn_operator_input_request"].sort();
// pg_get_functiondef qualifies composite return types according to search_path.
// Use the same postgres/public context as the package guard, measured on the
// identical 001–018 schema; do not mistake that rendering difference for drift.
const contextRoot=".verification-results/production-slack-recurring-rehearsal-v4/";
const originalContext=JSON.parse(read(contextRoot+"before-schema.json"));
const packageContext=JSON.parse(read(contextRoot+"package-context-schema.json"));
for(const name of guardedFunctions) {
 if(JSON.stringify(originalContext.functions.filter(f=>f.name===name))!==JSON.stringify(catalog.functions.filter(f=>f.name===name)))
  throw Error("Prior normalization source function differs");
}
const functions=packageContext.functions.filter(f=>guardedFunctions.includes(f.name)).sort((a,b)=>a.name.localeCompare(b.name)||a.arguments.localeCompare(b.arguments));
for(const f of functions){const old=catalog.functions.find(x=>x.name===f.name&&x.arguments===f.arguments);
 if(!old||JSON.stringify({...old,hash:f.hash})!==JSON.stringify(f))throw Error("Function authority differs under package context");}
const newFunctions=["learn_commusoft_recurring_actor","learn_commusoft_recurring_admission","learn_commusoft_recurring_page_allowed","learn_commusoft_recurring_start","learn_commusoft_recurring_control","learn_commusoft_recurring_empty_parent","learn_commusoft_schedule_recurring","learn_commusoft_recurring_read"].sort();
const newTables=["learn_commusoft_recurring","learn_commusoft_recurring_requests","learn_commusoft_recurring_steps"];
if(functions.length!==4 || catalog.functions.some(f=>newFunctions.includes(f.name)))throw Error("Commusoft recurring baseline differs");
const path = "supabase/migrations/20261101550000_learn_commusoft_recurring.sql";
const migration = read(path), sources = [{ path, sha256: sha(migration) }];
if ((migration.match(/^begin;$/gm) ?? []).length !== 1 || (migration.match(/^commit;$/gm) ?? []).length !== 1)
  throw Error("Single migration transaction required");
const body = migration.replace(/^begin;\n/m, "").replace(/^commit;\n/m, "");
const inventory = read("scripts/verify/learn-release-schema-inventory.sql").trim().replace(/;$/, "");
const sql = `-- DRAFT: recurring Commusoft cycle controls; no active subscriptions or source data modification.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production recurring Commusoft target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_recurring_attribution_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then
  raise exception 'Pinned production recurring Commusoft prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_recurring_v1')
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(quote).join(',')}]))
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(quote).join(',')}])) then
  raise exception 'Production recurring Commusoft candidate already exists; inspect before retry';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into observed from (${inventory}) q,
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${guardedFunctions.map(quote).join(",")}]);
 if observed is distinct from ${quote(JSON.stringify(functions))}::jsonb then
  raise exception 'Production recurring Commusoft function baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_commusoft_recurring_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const stem = root + "020_commusoft_recurring";
writeFileSync(stem + ".sql", sql);
writeFileSync(stem + ".manifest.json", JSON.stringify({ version: "learn-production-commusoft-recurring/1",
  status: "prepared_requires_matching_release_verification", projectRef: "tgbnakbxwcqjeimygroz",
  sha256: sha(sql), priorSha256: prior.sha256, baselineArchive: prior.baselineArchive, sources,
  newFunctions, changedFunctions, newTables, changedViews: [], newSequences: [], extendedTables: {},
  limitations: ["No subscription, credential, grant, job or hosted provider request is created by installation.",
    "Every cycle traverses full property inventory, jobs, customer contacts and site contacts; only verified completion advances the watermark.",
    "Real-provider filter acceptance, recurring capture and canonical changed-source reconciliation remain separate acceptance requirements."] }, null, 2) + "\n");
console.log(JSON.stringify({ sha256: sha(sql), changedFunctions: changedFunctions.length, guardedFunctions: functions.length, newFunctions: newFunctions.length, newTables: newTables.length }));
