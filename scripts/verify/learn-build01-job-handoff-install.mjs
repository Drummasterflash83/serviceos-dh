/** Exact, one-shot hosted function release after rollback rehearsal. No tenant rows. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';
const mode=process.argv.slice(2).join(' ');
if(!['--apply-test','--apply-live','--readback-test','--readback-live'].includes(mode))
 throw Error('Exact release mode required');
const test=mode.endsWith('test'),apply=mode.startsWith('--apply');
const project=test?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const files=[...(test?['20261029200000_learn_roster_recovery_guards.sql']:[]),
 '20261105120000_learn_roster_member_identity_confirmation.sql',
 '20261105130000_learn_commusoft_job_review_action.sql'];
const sources=files.map(name=>readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
const sha256=createHash('sha256').update(sources.join('\n')).digest('hex');
const expected=test?'29b72332dc11abf5df5cf2f773380bc7cbfcd81ab417ce4b5d57741261c69a2c':
 '448c1609b929a025cf01623f9f111a3f8019896e7b28356b53efd6526fe646ee';
if(sha256!==expected)throw Error('Source differs from exact rollback rehearsal');
const q=s=>"'"+s.replaceAll("'","''")+"'";
const roles=`select to_regprocedure('public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)') is not null identity_installed,
 to_regprocedure('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)') is not null review_installed,
 not has_function_privilege('anon','public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)','execute') identity_anon_denied,
 not has_function_privilege('anon','public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)','execute') review_anon_denied,
 has_function_privilege('service_role','public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)','execute') identity_service_allowed,
 has_function_privilege('authenticated','public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)','execute') review_customer_allowed`;
const ledger=test?`select source_sha256 digest from of_test_deploy.migrations where migration_name='learn_build01_job_handoff_v1'`:
 `select version,encode(sha256(convert_to(array_to_string(statements,''),'UTF8')),'hex') digest
  from supabase_migrations.schema_migrations where version in('20261105120000','20261105130000') order by version`;
async function query(sql,readOnly){
 const endpoint=readOnly?'database/query/read-only':'database/query';
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/${endpoint}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),
 });
 const raw=await response.text();
 if(!response.ok){
  let code=null;try{const d=JSON.parse(raw);code=d?.code??/ERROR:\s*([0-9A-Z]{5}):/.exec(d?.message??'')?.[1]??null;}catch{}
  throw Error(`Release database request rejected: HTTP ${response.status}, SQLSTATE ${code??'unknown'}`);
 }
 const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw Error('Release response shape changed');
 return parsed;
}
async function readback(){
 const [state,entries]=await Promise.all([query(roles,true),query(ledger,true)]);
 const flags=state[0];
 if(state.length!==1||!flags||Object.values(flags).some(v=>v!==true))throw Error('Installed function or privilege readback failed');
 if(test){if(entries.length!==1||entries[0].digest!==expected)throw Error('TEST release receipt mismatch');}
 else{
  if(entries.length!==2||entries[0].version!=='20261105120000'||entries[1].version!=='20261105130000'||
   entries.some((e,i)=>e.digest!==createHash('sha256').update(sources[i]).digest('hex')))
   throw Error('LIVE release receipt mismatch');
 }
 return {project,sha256,state:'installed_verified',flags,ledgerCount:entries.length};
}
if(!apply){console.log(JSON.stringify(await readback()));process.exit(0);}
const before=await query(`select ${test?"to_regprocedure('public.learn_roster_write_guard(uuid,text,text,boolean)') is null":"to_regprocedure('public.learn_roster_write_guard(uuid,text,text,boolean)') is not null"} roster_expected,
 to_regprocedure('public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)') is null identity_absent,
 to_regprocedure('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)') is null review_absent`,true);
if(before.length!==1||Object.values(before[0]).some(v=>v!==true))throw Error('Release precondition changed');
const receipt=test?
 `insert into of_test_deploy.migrations(migration_name,source_sha256,project_ref)
  values('learn_build01_job_handoff_v1','${expected}','${project}');`:
 `insert into supabase_migrations.schema_migrations(version,name,statements) values
  ('20261105120000','learn_roster_member_identity_confirmation',array[${q(sources[0])}]),
  ('20261105130000','learn_commusoft_job_review_action',array[${q(sources[1])}]);`;
const sql=`begin;set local lock_timeout='5s';set local statement_timeout='50s';
 do $$begin if to_regprocedure('public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)') is not null
  or to_regprocedure('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)') is not null
 then raise exception 'job_handoff_release_already_changed';end if;end$$;
 ${sources.join('\n')}\n${receipt}\ncommit;
 select 'learn-build01-job-handoff-install/1' marker;`;
let acknowledged=false;
try{const result=await query(sql,false);acknowledged=result.length===1&&result[0].marker==='learn-build01-job-handoff-install/1';}
catch(e){
 console.log(JSON.stringify({project,sha256,state:'release_requires_inspection',reason:e.message}));
 process.exitCode=1;
}
try{const result=await readback();console.log(JSON.stringify({...result,acknowledged}));if(!acknowledged)process.exitCode=1;}
catch(e){console.log(JSON.stringify({project,sha256,state:'release_requires_inspection',reason:e.message,acknowledged}));process.exitCode=1;}
