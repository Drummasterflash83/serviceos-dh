import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
export const PACING_RELEASE_NAME='learn_slack_workspace_pacing_v1';
export const PACING_FUNCTIONS=['learn_slack_claim_jobs','learn_slack_finish_job','learn_slack_finish_thread_job'];
export function buildPacing(){
 const before=JSON.parse(readFileSync(new URL('docs/operations/evidence/learn-test-operator-installed-schema-2026-10-10.json',root)));
 const sources=['20261030150000_learn_slack_workspace_pacing.sql'].map(name=>{const path='supabase/migrations/'+name,source=readFileSync(new URL(path,root),'utf8');return {path,source,sha256:hash(source),selected:source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')};});
 const sql=`-- Generated TEST-only shared Slack workspace pacing. No source imports or schedules.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
lock table public.platform_jobs in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_operator_reads_v1' and source_sha256='e37839d9be63ff9ee9db8b0ada2c25c676546cb108a3882c57d1ec58aa8300b1' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified thread prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${PACING_RELEASE_NAME}') then raise exception 'Slack pacing release already exists';end if;
 if to_regclass('public.slack_workspace_pacing') is not null then raise exception 'Pacing table already exists';end if;
 if exists(select 1 from public.platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')) then raise exception 'Slack queue must be quiescent before pacing release';end if;
 ${[...before.threadFunctions,...before.operatorFunctions].map(f=>`if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f.name}') is distinct from '${hash(f.definition,'md5')}' then raise exception 'Reviewed ${f.name} differs';end if;`).join('\n ')}
end $$;
${sources.map(s=>`-- SOURCE ${s.path}\n-- SHA-256 ${s.sha256}\n${s.selected}`).join('\n')}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${PACING_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-slack-pacing-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:PACING_RELEASE_NAME,sha256:hash(sql),sources:sources.map(({path,sha256})=>({path,sha256})),tables:['slack_workspace_pacing'],newFunctions:[],changedFunctions:PACING_FUNCTIONS,unchanged:['Existing table definitions, privileges, sources, credentials and schedules.','Existing source writers, credentials, reader functions, approval contracts and unrelated queue completion.'],deferred:['Hosted concurrency, cooldown and deployed-worker compatibility acceptance.','Live Slack access, continuous coverage and operator recovery.']}};
}
export function checkedPacing(){const b=buildPacing();for(const [suffix,text] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])if(readFileSync(new URL('supabase/release/learn-test/013_slack_pacing.'+suffix,root),'utf8')!==text)throw Error('Pacing bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildPacing();for(const [suffix,value] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])writeFileSync(new URL('supabase/release/learn-test/013_slack_pacing.'+suffix,root),value);console.log(b.manifest.sha256);}else{checkedPacing();console.log('Pacing source manifest: PASS');}}
