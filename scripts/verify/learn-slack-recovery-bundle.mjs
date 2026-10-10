import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {pacingInstalledBaseline} from './learn-slack-pacing-baseline.mjs';
const root=new URL('../../',import.meta.url),hash=(s,algorithm='sha256')=>createHash(algorithm).update(s).digest('hex');
export const RECOVERY_RELEASE_NAME='learn_slack_history_recovery_v1';
export const RECOVERY_NEW_FUNCTIONS=['learn_slack_history_state','learn_slack_history_read','learn_slack_resume_history'];
export function buildRecovery(){
 const before=pacingInstalledBaseline();
 const sources=['20261030160000_learn_slack_history_resume.sql'].map(name=>{const path='supabase/migrations/'+name,source=readFileSync(new URL(path,root),'utf8');return {path,source,sha256:hash(source),selected:source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')};});
 const sql=`-- Generated TEST-only reviewed Slack channel recovery. No source imports or schedules.
begin;
set local search_path=public,pg_temp;
set local lock_timeout='3s';
set local statement_timeout='30s';
lock table of_test_deploy.migrations in share row exclusive mode;
do $$ begin
 if current_setting('serviceos.release_target',true) is distinct from 'saatxzwxvdvqevbnskxy'
 or coalesce(current_setting('serviceos.release_source_sha256',true),'') !~ '^[a-f0-9]{64}$' then raise exception 'Explicit TEST target/checksum required';end if;
 if not exists(select 1 from of_test_deploy.migrations where migration_name='learn_slack_workspace_pacing_v1' and source_sha256='7191b47ec926094b2118d957cddccf6ebec6c62e10e2d04670db327d23c223a5' and project_ref='saatxzwxvdvqevbnskxy') then raise exception 'Verified pacing prerequisite required';end if;
 if exists(select 1 from of_test_deploy.migrations where migration_name='${RECOVERY_RELEASE_NAME}') then raise exception 'Slack recovery release already exists';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${RECOVERY_NEW_FUNCTIONS.map(n=>`'${n}'`).join(',')}])) then raise exception 'Recovery functions already exist';end if;
 ${[...before.threadFunctions,...before.operatorFunctions].map(f=>`if (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f.name}') is distinct from '${hash(f.definition,'md5')}' then raise exception 'Reviewed ${f.name} differs';end if;`).join('\n ')}
end $$;
${sources.map(s=>`-- SOURCE ${s.path}\n-- SHA-256 ${s.sha256}\n${s.selected}`).join('\n')}
insert into of_test_deploy.migrations(source_sha256,migration_name,project_ref,applied_at)
 values(current_setting('serviceos.release_source_sha256'),'${RECOVERY_RELEASE_NAME}','saatxzwxvdvqevbnskxy',clock_timestamp());
notify pgrst,'reload schema';
commit;
`;
 return {sql,manifest:{version:'learn-slack-recovery-bundle/1',projectRef:'saatxzwxvdvqevbnskxy',releaseName:RECOVERY_RELEASE_NAME,sha256:hash(sql),sources:sources.map(({path,sha256})=>({path,sha256})),tables:[],newFunctions:RECOVERY_NEW_FUNCTIONS,changedFunctions:[],unchanged:['Existing table definitions, privileges, sources, credentials and schedules.','Existing history approval/page/finish contracts and unrelated queue completion.'],deferred:['Hosted authenticated recovery acceptance and browser controls.','Live Slack access, continuous coverage and thread recovery.']}};
}
export function checkedRecovery(){const b=buildRecovery();for(const [suffix,text] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])if(readFileSync(new URL('supabase/release/learn-test/014_slack_recovery.'+suffix,root),'utf8')!==text)throw Error('Recovery bundle differs from retained sources');return b;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv[2]==='--write'){const b=buildRecovery();for(const [suffix,value] of [['sql',b.sql],['manifest.json',JSON.stringify(b.manifest,null,2)+'\n']])writeFileSync(new URL('supabase/release/learn-test/014_slack_recovery.'+suffix,root),value);console.log(b.manifest.sha256);}else{checkedRecovery();console.log('Recovery source manifest: PASS');}}
