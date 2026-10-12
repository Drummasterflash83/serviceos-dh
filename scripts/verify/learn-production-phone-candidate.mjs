/** Production-specific Phone capture, processing, playback and operator health. No activation. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(p,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>`'${s.replaceAll("'","''")}'`;
const sources=[{"path": "supabase/migrations/20261031210000_learn_operator_capture_health.sql", "sha256": "33c93527c055d0951a041e9b035ef2a1778f273356c5ad7c0439e57c5fab397c"}, {"path": "supabase/migrations/20261031220000_learn_email_capture_evidence.sql", "sha256": "a9ee85ea529dc169e2af7a28be1cb481e1d881d6649eba918270675c2f8fe8ec"}, {"path": "supabase/migrations/20261101006000_learn_phone_page_publication.sql", "sha256": "9f5d1d66667212cb148ceb30020da3fbd1ff3e3769da7f9f3ca5718f7bac24aa"}, {"path": "supabase/migrations/20261101008000_learn_phone_import_completion.sql", "sha256": "aeb2841df72067c8909ce7661d116e3dabed385822dd4c43707f85d04262893a"}, {"path": "supabase/migrations/20261101009000_learn_phone_schedule_settlement.sql", "sha256": "90db0cb4756dc11964d4c01c8e9ee741bb81d140b9007fcb6cf3449281d86be9"}, {"path": "supabase/migrations/20261101010000_learn_phone_operator_evidence.sql", "sha256": "59429a28c3cee3f5010877a61fd99815ddfa481170d75f1efa0770724cafc1e5"}, {"path": "supabase/migrations/20261101200000_learn_phone_download_attempts.sql", "sha256": "f18cd524860ce9f9df987d61415f108f2c11805970ea930a06272043499fafd3"}, {"path": "supabase/migrations/20261101210000_learn_phone_derived_versions.sql", "sha256": "3330679e3f4028af98026ffe886dae576c38256476c546145110aa085b8ac459"}, {"path": "supabase/migrations/20261101220000_learn_phone_operator_attempts.sql", "sha256": "74c13bb6713a1fb44e53067762da20467092dec3cca7ee9ebbac244227c09383"}, {"path": "supabase/migrations/20261101230000_learn_phone_playback.sql", "sha256": "2c08721acb41ea61403690e9030c87f4a10bf2a401c514fb43d8d6cbc11a3068"}, {"path": "supabase/migrations/20261101240000_learn_phone_saved_results.sql", "sha256": "cba74342dbc2a853307732dfc59079e41275da93a663c39afb9eea8231e3fac4"}, {"path": "supabase/migrations/20261101270000_learn_scheduler_health.sql", "sha256": "97714ef7dd50c5d514b9483047656d8b6e1f8d51fda953725908dd3c9dac6457"}, {"path": "supabase/migrations/20261101290000_learn_phone_atomic_handoff.sql", "sha256": "b0073764aedf6a95d1ba76f30c769efc8ebedc3db81bed5c8baf5556e727783d"}, {"path": "supabase/migrations/20261101410000_learn_email_retention_health.sql", "sha256": "2d9af67e0363ab53f1e4817b14efcf4e66d7234c368a5a5e2828722bdd04f708"}];
for(const source of sources)if(hash(read(source.path))!==source.sha256)throw Error('Phone source pin differs');
const baseline=JSON.parse(read('.verification-results/production-phone-baseline-v1/schema.json'));
const report=JSON.parse(read('.verification-results/production-phone-baseline-v1/report.json'));
const prior=JSON.parse(read('supabase/release/learn-production/010_email_capture.manifest.json'));
if(report.state!=='offline_phone_prerequisites_inspected'||!report.containerRemoved||JSON.stringify(report.archive)!==JSON.stringify(prior.baselineArchive))throw Error('Phone baseline unavailable');
// Legacy intelligence/directory/platform projection structures already exist in
// production. Never replay their older schemas, seeds, grants or endpoint backfill.
const body=sources.map(source=>'-- INPUT '+source.path+'\n'+read(source.path).replace(/^begin;\s*$/gmi,'').replace(/^commit;\s*$/gmi,'')).join('\n');
const newTables=[...body.matchAll(/^create table (?:if not exists )?(?:public\.)?(\w+)/gmi)].map(m=>m[1]);
const declared=[...new Set([...body.matchAll(/^create (?:or replace )?function (?:public\.)?(\w+)\(/gmi)].map(m=>m[1]))];
const existingNames=new Set(baseline.functions.map(f=>f.name));
const newFunctions=declared.filter(n=>!existingNames.has(n));
const changedFunctions=['phone_pending_readiness','phone_projection_version'];
const changedViews=['phone_recording_pipeline_state'];
if(baseline.tables.some(t=>newTables.includes(t.name)))throw Error('Phone tables already present');
const referenced=n=>new RegExp('\\b'+n+'\\b').test(body);
const existingTables=baseline.tables.filter(t=>referenced(t.name)).map(t=>t.name);
const tableCatalog=baseline.tables.filter(t=>existingTables.includes(t.name)).sort((a,b)=>a.name.localeCompare(b.name));
const helpers=baseline.functions.filter(f=>referenced(f.name));
const helperNames=[...new Set(helpers.map(f=>f.name))];
const views=baseline.views.filter(v=>referenced(v.name));
const viewNames=views.map(v=>v.name);
const inventory=read('scripts/verify/learn-release-schema-inventory.sql').trim().replace(/;$/,'');
const sql=`-- DRAFT: requires matched phone workers and explicit production approval.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$declare observed jsonb;actual_helpers jsonb;actual_views jsonb;begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Reviewed production Phone target and checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_email_capture_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}') then raise exception 'Pinned production Email prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_phone_capture_v1')
 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array[${newTables.map(q).join(',')}]))
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${newFunctions.map(q).join(',')}])) then raise exception 'Production Phone candidate already exists; inspect before retry';end if;
 select jsonb_agg(t order by t->>'name') into observed from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'tables') t where t->>'name'=any(array[${existingTables.map(q).join(',')}]);
 if observed is distinct from ${q(JSON.stringify(tableCatalog))}::jsonb then raise exception 'Production Phone table baseline differs';end if;
 select jsonb_agg(f order by f->>'name',f->>'arguments') into actual_helpers from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'functions') f where f->>'name'=any(array[${helperNames.map(q).join(',')}]);
 if actual_helpers is distinct from ${q(JSON.stringify(helpers))}::jsonb then raise exception 'Production Phone helper baseline differs';end if;
 select jsonb_agg(v order by v->>'name') into actual_views from (${inventory}) q,lateral jsonb_array_elements(q.inventory->'views') v where v->>'name'=any(array[${viewNames.map(q).join(',')}]);
 if actual_views is distinct from ${q(JSON.stringify(views))}::jsonb then raise exception 'Production Phone view baseline differs';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_phone_capture_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const out='supabase/release/learn-production/011_phone_capture';
writeFileSync(out+'.sql',sql);
writeFileSync(out+'.manifest.json',JSON.stringify({version:'learn-production-phone-capture/1',status:'draft_requires_rehearsal_and_production_approval',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,existingTables,newTables,newFunctions,changedFunctions,changedViews,newSequences:[],
 extendedTables:{phone_transcripts:['source_storage_path','source_sha256','processing_run_id'],phone_ai_insights:['source_transcript_sha256','processing_run_id']},
 newExistingConstraints:{phone_transcripts:['phone_transcripts_processing_run_id_fkey'],phone_ai_insights:['phone_ai_insights_processing_run_id_fkey']},
 newExistingIndexes:{email_sync_runs:['learn_email_capture_run_lookup','learn_email_scheduler_latest_idx'],phone_sync_runs:['learn_phone_schedule_health_lookup','learn_phone_scheduler_latest_idx']},
 newExistingTriggers:{feature_flags:['learn_phone_capture_flags']},newExistingPolicies:{},
 limitations:['No source rewrite, historical provenance backfill, provider activation, schedule or new credential.','Existing production intelligence/directory/platform schemas and permissions are preserved, not replaced with TEST defaults.','Matched phone workers, real provider coverage, customer-card processing and signed-in audio acceptance remain required.']},null,2)+'\n');
console.log(JSON.stringify({sha256:hash(sql),tables:newTables.length,functions:newFunctions.length}));
