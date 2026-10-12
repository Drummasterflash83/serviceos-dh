/** Prepare exact Slack user/operator production package. No hosted operations. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = p => readFileSync(p, "utf8"), sha = x => createHash("sha256").update(x).digest("hex");
const quote = x => "'" + x.replaceAll("'", "''") + "'";
const root = "supabase/release/learn-production/";
const prior = JSON.parse(read(root + "017_commusoft_update_windows.manifest.json"));
const catalog = JSON.parse(read(".verification-results/production-update-windows-rehearsal-v2/schema.json"));
const rehearsal = JSON.parse(read(".verification-results/production-update-windows-rehearsal-v2/report.json"));
if (rehearsal.state !== "production_update_windows_rehearsed_offline" || !rehearsal.containerRemoved ||
    rehearsal.packages.length !== 17 || rehearsal.packages.at(-1) !== prior.sha256 ||
    sha(read(root + "017_commusoft_update_windows.sql")) !== prior.sha256 ||
    JSON.stringify(rehearsal.archive) !== JSON.stringify(prior.baselineArchive)) throw Error("Reviewed prior archive rehearsal required");
const changedFunctions = ['learn_slack_start_import','learn_slack_read_credential','learn_slack_start_thread_import','learn_slack_read_thread_credential','learn_slack_threads_read','learn_slack_history_state','learn_slack_thread_recovery_state','learn_slack_recurring_control','learn_slack_schedule_recurring','learn_slack_queue_recurring_threads','learn_slack_resume_history','learn_slack_resume_thread','learn_slack_accounts_read','learn_slack_history_read','learn_slack_thread_recovery_read'].sort();
const functions=catalog.functions.filter(f=>changedFunctions.includes(f.name));
const newFunctions=['learn_slack_credential_field','learn_slack_configure','learn_slack_control_access','learn_slack_connections_read','learn_slack_reference_guard'].sort();
const newTables=['learn_slack_connection_requests'];
if(functions.length!==15 || catalog.functions.some(f=>newFunctions.includes(f.name)) || catalog.tables.some(t=>newTables.includes(t.name))) throw Error('Slack function/table baseline differs');
const sources=['supabase/migrations/20261101560000_learn_slack_user_credential.sql','supabase/migrations/20261101570000_learn_slack_operator_setup.sql','supabase/migrations/20261101580000_learn_slack_operator_reference.sql'].map(path=>({path,sha256:sha(read(path))}));
const body=sources.map(({path})=>{const migration=read(path);if((migration.match(/^begin;$/gm)??[]).length!==1 ||(migration.match(/^commit;$/gm)??[]).length!==1)throw Error('Single migration transaction required');return migration.replace(/^begin;\n/m,'').replace(/^commit;\n/m,'');}).join('\n');
const inventory = read("scripts/verify/learn-release-schema-inventory.sql").trim().replace(/;$/, "");
const sql = `-- DRAFT: Slack user credentials and logged operator setup; no credential provisioning or activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then
  raise exception 'Reviewed production Slack setup target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_update_windows_v1'
  and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then
  raise exception 'Pinned production Slack setup prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_user_operator_v1')
 or to_regprocedure('public.learn_slack_credential_field(jsonb)') is not null
 or to_regclass('public.learn_slack_connection_requests') is not null then
  raise exception 'Production Slack setup candidate already exists; inspect before retry';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into observed from (${inventory}) q,
  lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${changedFunctions.map(quote).join(",")}]);
 if observed is distinct from ${quote(JSON.stringify(functions))}::jsonb then
  raise exception 'Production Slack setup function baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_slack_user_operator_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const stem = root + "018_slack_user_operator";
writeFileSync(stem + ".sql", sql);
writeFileSync(stem + ".manifest.json", JSON.stringify({ version: "learn-production-slack-user-operator/1",
  status: "prepared_requires_matching_release_verification", projectRef: "tgbnakbxwcqjeimygroz",
  sha256: sha(sql), priorSha256: prior.sha256, baselineArchive: prior.baselineArchive, sources,
  newFunctions, changedFunctions, newTables, changedTriggerTables:['slack_history_imports','slack_thread_imports'], changedViews: [], newSequences: [], extendedTables: {},
  limitations: ["No credential, access grant, provider request, module activation or capture is created by installation.",
    "Matching runtime and frontend, signed-in acceptance and source preservation remain release requirements.",
    "Private-channel visibility and whole-history orchestration remain unfinished; DMs are excluded."] }, null, 2) + "\n");
console.log(JSON.stringify({ sha256: sha(sql), changedFunctions: functions.length, newFunctions: 5, newTables: 1 }));
