/** Prepare the production search-planning package. No hosted requests. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='supabase/release/learn-production/',read=p=>readFileSync(p,'utf8'),hash=v=>createHash('sha256').update(v).digest('hex');
const prior=JSON.parse(read(root+'022_learning_delivery_reads.manifest.json'));
if(hash(read(root+'022_learning_delivery_reads.sql'))!==prior.sha256)throw Error('Prior package changed');
const sourcePath='supabase/migrations/20261101640000_learn_commusoft_review_planning.sql',source=read(sourcePath);
const acceptance=JSON.parse(read('docs/operations/evidence/learn-review-planning-2026-10-13.json'));
if(acceptance.state!=='installed_and_signed_in_test_verified'||acceptance.source.sha256!==hash(source)||acceptance.browser.checks.length!==12||acceptance.browser.failures!==0)throw Error('Exact TEST acceptance required');
const schema=JSON.parse(read('.verification-results/production-learning-rehearsal-v2/schema.json'));
const reader=schema.functions.find(f=>f.name==='learn_commusoft_work_review_search');
if(!reader||reader.owner!=='postgres'||reader.anonExecute||reader.serviceExecute||!reader.authenticatedExecute||!reader.securityDefiner)throw Error('Reviewed reader authority required');
const body=source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
const sql=`-- DRAFT: function-local planning only. No capture, accounts, data or grants.
begin;
set local search_path=public,pg_catalog;
set local lock_timeout='3s';set local statement_timeout='30s';
lock table of_learn_deploy.migrations in share row exclusive mode;
do $$begin
 if current_user<>'postgres' or current_setting('serviceos.release_target',true) is distinct from 'tgbnakbxwcqjeimygroz'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'')!~'^[a-f0-9]{64}$'
 then raise exception 'Production review-planning target/checksum required';end if;
 if exists(select 1 from of_learn_deploy.migrations where migration_name='learn_commusoft_review_planning_v1')
 then raise exception 'Review planning already installed; inspect before retry';end if;
 if not exists(select 1 from of_learn_deploy.migrations where migration_name='learn_learning_delivery_reads_v1' and project_ref='tgbnakbxwcqjeimygroz' and source_sha256='${prior.sha256}')
 then raise exception 'Pinned review-planning prerequisite missing';end if;
 if (select md5(pg_get_functiondef('public.learn_commusoft_work_review_search(uuid,uuid,text,text,text,integer)'::regprocedure))) is distinct from '${reader.hash}'
 then raise exception 'Prior work-search reader changed';end if;
end $$;
${body}
insert into of_learn_deploy.migrations values('learn_commusoft_review_planning_v1',current_setting('serviceos.release_source_sha256'),'tgbnakbxwcqjeimygroz',clock_timestamp());
commit;
`;
const stem=root+'023_commusoft_review_planning';
writeFileSync(stem+'.sql',sql,{flag:'wx'});
writeFileSync(stem+'.manifest.json',JSON.stringify({version:'learn-production-review-planning/1',status:'prepared_requires_release_rehearsal',projectRef:'tgbnakbxwcqjeimygroz',sha256:hash(sql),priorSha256:prior.sha256,baselineArchive:prior.baselineArchive,sources:[{path:sourcePath,sha256:hash(source)}],newFunctions:[],changedFunctions:[reader.name],newTables:[],changedViews:[],newSequences:[],extendedTables:{},limitations:['Requires full-schema rehearsal and inclusion in the matched release before promotion.','Function-local query planning changes only; body, permissions, owner and retained sources remain unchanged.','No provider requests, accounts, grants, credentials or capture activation.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:'prepared',sha256:hash(sql),productionChanges:0}));
