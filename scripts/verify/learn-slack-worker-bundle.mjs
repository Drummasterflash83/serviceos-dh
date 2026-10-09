import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
export const WORKER_RELEASE_NAME='learn_slack_durable_worker_v1';
export const WORKER_NEW_FUNCTIONS=['learn_slack_claim_jobs','learn_slack_finish_job','learn_slack_commit_page_private','learn_slack_read_credential'];
export function buildWorker(){
 const before=JSON.parse(readFileSync(new URL('docs/operations/evidence/learn-test-worker-before-schema-2026-10-09.json',root)));
 const sources=['20261030100000_learn_slack_worker.sql','20261030110000_learn_slack_credential_binding.sql'].map(name=>{
  const path='supabase/migrations/'+name,source=readFileSync(new URL(path,root),'utf8');
  return {path,source,sha256:hash(source),selected:source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')};
 });
 const prior=before.workerFunctions.filter(f=>f.name!=='platform_jobs_complete_email_v1');
 const sql=`-- Generated TEST-only durable Slack worker and existing-credential resolver.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_storage_setup_v1' and source_sha256='d4b762ace7c9ccecba29890649e40d7e1501aa5f6e1c2b711970fb55368d305e' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified Slack storage prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${WORKER_RELEASE_NAME}') then raise exception 'Slack worker release already exists';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${WORKER_NEW_FUNCTIONS.map(n=>`'${n}'`).join(',')}])) then raise exception 'Worker function already exists';end if;
 if not exists(select 1 from pg_extension where extname='supabase_vault' and extversion='0.3.1') or not has_schema_privilege('postgres','vault','USAGE') or not has_table_privilege('postgres','vault.decrypted_secrets','SELECT') then raise exception 'Reviewed existing Vault prerequisite required';end if;
 ${prior.map(f=>`if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f.name}') is distinct from '${hash(f.definition,'md5')}' then raise exception 'Reviewed ${f.name} differs';end if;`).join('\n ')}
end $$;
${sources.map(s=>`-- SOURCE ${s.path}\n-- SHA-256 ${s.sha256}\n${s.selected}`).join('\n')}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${WORKER_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-slack-worker-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:WORKER_RELEASE_NAME,sha256:hash(sql),sources:sources.map(({path,sha256})=>({path,sha256})),tables:[],newFunctions:WORKER_NEW_FUNCTIONS,changedFunctions:['platform_jobs_claim','slack_history_commit_page'],unchanged:['All existing tables, grants, source rows, credentials and schedules.','Email completion and all other queue job types.'],deferred:['Separate Edge deployment and actual JWT acceptance.','Live Slack permission, threads, continuous/multi-window backfill, workspace-wide pacing.']}};
}
export function checkedWorker(){const b=buildWorker();for(const [suffix,text] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])if(readFileSync(new URL('supabase/release/learn-test/010_slack_durable_worker.'+suffix,root),'utf8')!==text)throw Error('Worker bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildWorker();writeFileSync(new URL('supabase/release/learn-test/010_slack_durable_worker.sql',root),b.sql);writeFileSync(new URL('supabase/release/learn-test/010_slack_durable_worker.manifest.json',root),JSON.stringify(b.manifest,null,2)+'\n');console.log(b.manifest.sha256);}else{checkedWorker();console.log('Worker source manifest: PASS');}}
