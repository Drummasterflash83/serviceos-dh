/** Prepare the matching production learning storage/read package; never deploys. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='supabase/release/learn-production/', read=p=>readFileSync(p,'utf8'), hash=v=>createHash('sha256').update(v).digest('hex');
const prior=JSON.parse(read(root+'021_slack_work_context.manifest.json'));
if(hash(read(root+'021_slack_work_context.sql'))!==prior.sha256)throw Error('Prior package changed');
const paths=[
 'supabase/migrations/20261101610000_learn_observation_delivery.sql',
 'supabase/migrations/20261101620000_openfolk_learning_information.sql',
 'supabase/migrations/20261101630000_learn_learning_retained_counts.sql',
];
const sources=paths.map(path=>({path,sha256:hash(read(path))}));
const schema=JSON.parse(read('.verification-results/production-slack-context-rehearsal-v1/schema.json'));
const reader=schema.functions.find(f=>f.name==='openfolk_client_information');
if(!reader||reader.owner!=='postgres'||reader.anonExecute||reader.serviceExecute||!reader.authenticatedExecute)throw Error('Reviewed prior reader required');
const newFunctions=['learn_learning_retained_counts','learn_observation_deliver'];
const body=paths.map(p=>read(p).replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')).join('\n');
const sql=`-- DRAFT: atomic observations and audited retained-evidence reads; no capture activation.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='60s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 then raise exception 'Production learning target/checksum required';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_slack_work_context_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}')
 then raise exception 'Pinned learning prerequisite missing';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_learning_delivery_reads_v1')
 or to_regclass('public.learn_observation_receipts') is not null
 or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['learn_learning_retained_counts','learn_observation_deliver']))
 then raise exception 'Learning package already exists; inspect before retry';end if;
 if (select md5(pg_get_functiondef(p.oid)) from pg_proc p where p.oid='public.openfolk_client_information(uuid,text,text,uuid,uuid)'::regprocedure) is distinct from '${reader.hash}'
 then raise exception 'Prior information reader changed';end if;
 if exists(select 1 from public.platform_jobs where status='running') then raise exception 'Running work must drain';end if;
end$$;
${body}
insert into of_learn_deploy.migrations values('learn_learning_delivery_reads_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
const stem=root+'022_learning_delivery_reads';
writeFileSync(stem+'.sql',sql,{flag:'wx'});
writeFileSync(stem+'.manifest.json',JSON.stringify({version:'learn-production-learning/1',status:'prepared_requires_matching_release_verification',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources,newFunctions,changedFunctions:['openfolk_client_information'],newTables:['learn_observation_receipts'],changedViews:[],newSequences:[],extendedTables:{},limitations:['Requires fresh production baseline and matched worker/control-plane/frontend.','No accounts, grants, credentials, provider calls or capture activation.','Preserves existing source and observation history; source revision reconciliation remains separate.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:'prepared',sha256:hash(sql),productionChanged:false}));
