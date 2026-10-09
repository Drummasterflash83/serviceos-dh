import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
export const THREADS_RELEASE_NAME='learn_slack_threads_v1';
export const THREADS_NEW_FUNCTIONS=['learn_slack_store_records','learn_slack_thread_immutable','learn_slack_start_thread_import','slack_thread_commit_page','learn_slack_read_thread_credential','learn_slack_finish_thread_job'];
export const THREADS_CHANGED_FUNCTIONS=['platform_jobs_claim','learn_slack_claim_jobs','learn_slack_commit_page_private'];
export function buildThreads(){
 const before=JSON.parse(readFileSync(new URL('docs/operations/evidence/learn-test-threads-before-schema-2026-10-10.json',root)));
 const sources=['20261030120000_learn_slack_thread_storage.sql','20261030130000_learn_slack_thread_worker.sql'].map(name=>{const path='supabase/migrations/'+name,source=readFileSync(new URL(path,root),'utf8');return {path,source,sha256:hash(source),selected:source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')};});
 const sql=`-- Generated TEST-only retained Slack thread windows. No source imports or schedules.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_durable_worker_v1' and source_sha256='74bfa2f96e5ad2b40fb40b1e6b03f1cdd6f605f3d8d57a598a541222f8a1955e' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified durable worker prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${THREADS_RELEASE_NAME}') then raise exception 'Slack thread release already exists';end if;
 if to_regclass('public.slack_thread_imports') is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${THREADS_NEW_FUNCTIONS.map(n=>`'${n}'`).join(',')}])) then raise exception 'Thread objects already exist';end if;
 ${before.workerFunctions.map(f=>`if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f.name}') is distinct from '${hash(f.definition,'md5')}' then raise exception 'Reviewed ${f.name} differs';end if;`).join('\n ')}
end $$;
${sources.map(s=>`-- SOURCE ${s.path}\n-- SHA-256 ${s.sha256}\n${s.selected}`).join('\n')}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${THREADS_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-slack-threads-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:THREADS_RELEASE_NAME,sha256:hash(sql),sources:sources.map(({path,sha256})=>({path,sha256})),tables:['slack_thread_imports'],newFunctions:THREADS_NEW_FUNCTIONS,changedFunctions:THREADS_CHANGED_FUNCTIONS,unchanged:['Existing table definitions, privileges, sources, credentials and schedules.','Existing history approval/page/finish contracts and unrelated queue completion.'],deferred:['Separate matching endpoint release and hosted authenticated acceptance.','Operator thread discovery/import UI, live Slack access, continuous coverage and workspace pacing.']}};
}
export function checkedThreads(){const b=buildThreads();for(const [suffix,text] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])if(readFileSync(new URL('supabase/release/learn-test/011_slack_threads.'+suffix,root),'utf8')!==text)throw Error('Thread bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildThreads();for(const [suffix,value] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])writeFileSync(new URL('supabase/release/learn-test/011_slack_threads.'+suffix,root),value);console.log(b.manifest.sha256);}else{checkedThreads();console.log('Thread source manifest: PASS');}}
