import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const root=new URL('../../',import.meta.url),hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
export const OPERATOR_RELEASE_NAME='learn_slack_operator_reads_v1';
export const OPERATOR_NEW_FUNCTIONS=['learn_slack_accounts_read','learn_slack_threads_read'];
export function buildOperator(){
 const before=JSON.parse(readFileSync(new URL('docs/operations/evidence/learn-test-operator-before-schema-2026-10-10.json',root)));
 const sources=['20261030140000_learn_slack_operator_reads.sql'].map(name=>{const path='supabase/migrations/'+name,source=readFileSync(new URL(path,root),'utf8');return {path,source,sha256:hash(source),selected:source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')};});
 const sql=`-- Generated TEST-only company-scoped Slack operator reads. No source imports or schedules.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_threads_v1' and source_sha256='c476f687762c1bb648c7ecdd7bd9bdb054b1d7f5ccc9cb43af17468991edf5ce' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified thread prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${OPERATOR_RELEASE_NAME}') then raise exception 'Slack operator release already exists';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${OPERATOR_NEW_FUNCTIONS.map(n=>`'${n}'`).join(',')}])) then raise exception 'Operator functions already exist';end if;
 ${before.threadFunctions.map(f=>`if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f.name}') is distinct from '${hash(f.definition,'md5')}' then raise exception 'Reviewed ${f.name} differs';end if;`).join('\n ')}
end $$;
${sources.map(s=>`-- SOURCE ${s.path}\n-- SHA-256 ${s.sha256}\n${s.selected}`).join('\n')}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${OPERATOR_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-slack-operator-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:OPERATOR_RELEASE_NAME,sha256:hash(sql),sources:sources.map(({path,sha256})=>({path,sha256})),tables:[],newFunctions:OPERATOR_NEW_FUNCTIONS,changedFunctions:[],unchanged:['Existing table definitions, privileges, sources, credentials and schedules.','Existing history approval/page/finish contracts and unrelated queue completion.'],deferred:['Hosted authenticated reader and browser acceptance.','Live Slack access, continuous coverage and workspace pacing.']}};
}
export function checkedOperator(){const b=buildOperator();for(const [suffix,text] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])if(readFileSync(new URL('supabase/release/learn-test/012_slack_operator.'+suffix,root),'utf8')!==text)throw Error('Operator bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildOperator();for(const [suffix,value] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])writeFileSync(new URL('supabase/release/learn-test/012_slack_operator.'+suffix,root),value);console.log(b.manifest.sha256);}else{checkedOperator();console.log('Operator source manifest: PASS');}}
