/** Build the combined scoring, recovery and working-time production candidate. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const literal=s=>`'${s.replaceAll("'","''")}'`;
const sources=[
 {
  "path": "supabase/migrations/20261031020000_learn_performance_corrections.sql",
  "sha256": "4914c58f4fef0b88fab739c63b3866e1890de5c6d18979aef532c99b9961b223"
 },
 {
  "path": "supabase/migrations/20261031040000_learn_saved_assessments.sql",
  "sha256": "be262c0001dbd1b8ca5b99b0fbe331e6942048a348959711a9357a53a5b61227"
 },
 {
  "path": "supabase/migrations/20261101060000_learn_assessment_recovery.sql",
  "sha256": "cf9afb35113bb7db565a6ec6618621511d3398df0963ddba72623d24f5e066f0"
 },
 {
  "path": "supabase/migrations/20261101080000_learn_team_work_residence.sql",
  "sha256": "dc5b889428f07c8d40d9788116ba03ac796a9ce04a36668780c8dd6a6a276ef1"
 },
 {
  "path": "supabase/migrations/20261101090000_learn_resumable_work_collection.sql",
  "sha256": "6dcc66b01f802c6312c16916c3dd788a624579cbd483c527e24cdee367b94688"
 },
 {
  "path": "supabase/migrations/20261101100000_learn_work_calendars.sql",
  "sha256": "01ecf776740369ff14f30a207678b65049b065b49596c87022e59038fe04ef81"
 },
 {
  "path": "supabase/migrations/20261101110000_learn_work_delays.sql",
  "sha256": "2317137b438c2b6d1f3003d9b235e4f29b150b7a8f98da59c4c427d91973bd91"
 },
 {
  "path": "supabase/migrations/20261101120000_learn_working_time_calculation.sql",
  "sha256": "bf89b1cfcc9a7b2c909212a1420b423d73ee6b1d544ce668f0f44a507044fd0f"
 },
 {
  "path": "supabase/migrations/20261101130000_learn_working_time_collection.sql",
  "sha256": "3ff14495fab91b5b7826b4e7a8bf4fc3113a03c368f002a76c445f7e72dcb984"
 },
 {
  "path": "supabase/migrations/20261101140000_learn_working_collection_input_bounds.sql",
  "sha256": "eef4047164686fa4a97d5f20e25abf1bd3cf4e68b8d6d0ae781fd759d90a31af"
 },
 {
  "path": "supabase/migrations/20261101160000_learn_measurement_receipt_guards.sql",
  "sha256": "a991911c0f83c8bfb46b30d8848a1379bbf8b920d7bb8f9cddc7c3758a392165"
 },
 {
  "path": "supabase/migrations/20261101170000_learn_correction_recovery.sql",
  "sha256": "daed0808006b6506556f8226dcf1444f411e0b635096c3efeba1b12b6f3997e4"
 }
];
const bodies=sources.map(s=>{const body=read(s.path);if(hash(body)!==s.sha256)throw Error('Scoring source pin differs');
 return '-- SOURCE '+s.path+'\n'+body.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');});
const body=bodies.join('\n');
const base=JSON.parse(read('.verification-results/production-scoring-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-scoring-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/004_governed_work_actions.manifest.json'));
if(report.state!=='offline_scoring_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Scoring baseline unavailable');
const newTables=[...body.matchAll(/^create table public\.(\w+)/gm)].map(m=>m[1]);
const created=[...new Set([...body.matchAll(/^create (?:or replace )?function public\.(\w+)\(/gm)].map(m=>m[1]))];
const newFunctions=created.filter(n=>!base.functions.some(f=>f.name===n));
const changedFunctions=['learn_performance_append','learn_scorecard_save_draft'];
if(base.tables.some(t=>newTables.includes(t.name))||created.some(n=>!newFunctions.includes(n)))throw Error('New scoring names already exist');
const tableNames=['tenants','profiles','team_members','org_units','view_as_context','config_versions','operating_profile_entries','learn_scorecard_publications','learn_member_history','measurements','learn_performance_reviews','learn_work_measurement_runs','intelligence_objects','object_state_history','interactions','email_messages','phone_calls','phone_recordings','jobs','customer_cards'];
const tables=base.tables.filter(t=>tableNames.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
if(tables.length!==tableNames.length)throw Error('Missing scoring prerequisites');
const helpers=base.functions.filter(f=>f.name.startsWith('learn_')||['current_tenant_id','current_user_role','objectives_append_only'].includes(f.name));
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT production scoring/recovery/working time. No activation or source rewrite.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
  or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production scoring target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_governed_work_actions_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production actions prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_scoring_working_time_v1')
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(literal).join(',')}]))
  or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(literal).join(',')}])) then
   raise exception 'Production scoring candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${tableNames.map(literal).join(',')}]);
 if observed is distinct from ${literal(JSON.stringify(tables))}::jsonb then raise exception 'Production scoring table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name' like 'learn_%' or f->>'name' in ('current_tenant_id','current_user_role','objectives_append_only');
 if actual_helpers is distinct from ${literal(JSON.stringify(helpers))}::jsonb then raise exception 'Production scoring helper baseline differs';end if;
end $$;
${body}
insert into of_learn_deploy.migrations values('learn_scoring_working_time_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/005_scoring_working_time';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-scoring-working-time/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables:tableNames,newTables,newFunctions,changedFunctions,newSequences:[],newExistingTriggers:{measurements:['learn_measurement_receipt_guard'],learn_performance_reviews:['learn_review_receipt_guard']},limitations:['Full provider and signed-in acceptance remain required.','No production activation, calendar publication, staff grant or historical scoring.','Remaining operator, card-input and connector packages are not included.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
