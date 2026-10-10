/** Fixed TEST server-role grants. Rehearse before installation; never replay uncertain writes. */
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {readRecoveryCatalog} from './learn-slack-recovery-catalog.mjs';import {installedPhone} from './learn-test-phone-catalog.mjs';
import {recoveryFingerprint} from './learn-test-recovery-release.mjs';import {catalogFingerprint} from './learn-test-launch-rehearsal.mjs';import {digest} from './learn-test-foundation-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';import {assertNoPhoneCredentials} from './learn-test-phone-deploy.mjs';
export const PHONE_ACCESS_NAME='learn_phone_service_access_v1',PHONE_ACCESS_SHA='f2e4706559d9a44b099126bd9bd8f364a4e5448ee3783b551a4369a188cebecb';
const MARKER='learn-test-phone-access/1',tables=['phone_calls','phone_recordings','phone_sync_runs'];
export const PHONE_PRIVILEGES_QUERY="select t as name,r as role,jsonb_object_agg(p,has_table_privilege(r,'public.'||t,p)) as privileges from unnest(array['phone_sync_runs','audit_logs','phone_calls','phone_recordings','tenant_connectors','connector_accounts']) t cross join unnest(array['service_role','anon','authenticated']) r cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p group by t,r order by t,r";
export function expectedPhonePrivileges(installed){
 const raw=readFileSync(new URL('../../supabase/release/learn-test/015_phone_service_access.expected.json',import.meta.url));
 if(createHash('sha256').update(raw).digest('hex')!=='62fb05c6374f43f5df0beea39b948ffad13220293770d6a5df542dfd2be28b86')throw Error('Phone privilege baseline differs');
 const rows=JSON.parse(raw).before;if(installed)for(const r of rows)if(tables.includes(r.name)&&r.role==='service_role')for(const p of ['SELECT','INSERT','UPDATE'])r.privileges[p]=true;return rows;
}
async function query(token,fetcher,sql,readOnly){
 const r=await fetcher(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw Error('Phone access SQL failed HTTP '+r.status);return r.json();
}
export async function readPhoneCatalog(args){
 const c=await readRecoveryCatalog(args);c.phonePrivileges=await query(args.token,args.fetcher??fetch,PHONE_PRIVILEGES_QUERY,true);return c;
}
export function installedPhoneAccess(c){
 const entries=c.readiness?.customMigrationEntries;
 if(!Array.isArray(entries)||entries.length!==16||entries.filter(e=>e.migration_name===PHONE_ACCESS_NAME&&e.source_sha256===PHONE_ACCESS_SHA&&e.project_ref===TEST_PROJECT).length!==1||digest(c.phonePrivileges)!==digest(expectedPhonePrivileges(true)))return false;
 const prior=structuredClone(c);prior.readiness.customMigrationEntries=prior.readiness.customMigrationEntries.filter(e=>e.migration_name!==PHONE_ACCESS_NAME);prior.base.report.customMigrationEntries=prior.base.report.customMigrationEntries.filter(e=>e.migration_name!==PHONE_ACCESS_NAME);prior.readinessCatalogSha256=catalogFingerprint(prior.base);
 return installedPhone(prior);
}
export const phoneAccessFingerprint=c=>digest({catalog:recoveryFingerprint(c),privileges:c.phonePrivileges});
export function phoneAccessSql(rehearse){
 const raw=readFileSync(new URL('../../supabase/release/learn-test/015_phone_service_access.sql',import.meta.url),'utf8');if(createHash('sha256').update(raw).digest('hex')!==PHONE_ACCESS_SHA)throw Error('Reviewed phone permission SQL differs');
 let sql=raw.replace('\nbegin;\n',`\nbegin;\nset local serviceos.release_target='${TEST_PROJECT}';\nset local serviceos.release_source_sha256='${PHONE_ACCESS_SHA}';\n`);
 if(rehearse)sql=sql.replace('\ncommit;\n','\nrollback;\n');
 return sql+`select '${MARKER}' as marker,${rehearse?'not ':''}exists(select 1 from of_test_deploy.migrations where migration_name='${PHONE_ACCESS_NAME}' and source_sha256='${PHONE_ACCESS_SHA}') as receipt_expected;`;
}
export async function phoneAccess({allowProjectRef,token,rehearse,rehearsal,fetcher=fetch,clock=Date.now}){
 const args={allowProjectRef,token,fetcher},before=await readPhoneCatalog(args);
 if(installedPhoneAccess(before))return {state:'already_installed',writeAttempted:false};
 if(!installedPhone(before)||digest(before.phonePrivileges)!==digest(expectedPhonePrivileges(false)))throw Error('Exact phone deployment and prior privileges required');
 await assertNoPhoneCredentials(token,fetcher);
 if(!rehearse){const at=Date.parse(rehearsal?.observedAt),now=clock();if(rehearsal?.version!==MARKER||rehearsal.projectRef!==TEST_PROJECT||rehearsal.sourceSha256!==PHONE_ACCESS_SHA||rehearsal.state!=='rehearsed_and_rolled_back'||rehearsal.afterFingerprint!==phoneAccessFingerprint(before)||!Number.isFinite(at)||at>now||now-at>3600000)throw Error('Fresh matching rollback rehearsal required');}
 let acknowledged=false;try{const rows=await query(token,fetcher,phoneAccessSql(rehearse),false);acknowledged=rows?.length===1&&rows[0].marker===MARKER&&rows[0].receipt_expected===true;}catch{/* Inspect unknown outcome, never repeat. */}
 let after=null;try{after=await readPhoneCatalog(args);}catch{}
 const verified=after&&(rehearse?phoneAccessFingerprint(before)===phoneAccessFingerprint(after)&&installedPhone(after):installedPhoneAccess(after));
 return {version:MARKER,projectRef:TEST_PROJECT,sourceSha256:PHONE_ACCESS_SHA,observedAt:new Date(clock()).toISOString(),writeAttempted:true,acknowledged,state:acknowledged&&verified?(rehearse?'rehearsed_and_rolled_back':'installed_needs_authenticated_acceptance'):'requires_inspection',beforeFingerprint:phoneAccessFingerprint(before),afterFingerprint:after?phoneAccessFingerprint(after):null,scope:'Only SELECT/INSERT/UPDATE for service_role on phone_calls, phone_recordings, phone_sync_runs; no client grants, DELETE, TRUNCATE, source edits, provider credentials or schedules.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{const a=process.argv.slice(2),rehearse=a.join(' ')==='--rehearse --existing-cli-login';if((!rehearse&&(a.length!==4||a[0]!=='--apply'||a[1]!=='--existing-cli-login'||a[2]!=='--rehearsal-report'))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST phone permission operation required');const r=await phoneAccess({allowProjectRef:TEST_PROJECT,token:savedCliToken(),rehearse,rehearsal:rehearse?null:JSON.parse(readFileSync(a[3]))});console.log(JSON.stringify(r,null,2));if(r.state==='requires_inspection')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
