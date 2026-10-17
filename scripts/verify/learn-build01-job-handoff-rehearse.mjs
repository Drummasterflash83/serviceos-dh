/** Rollback-only hosted schema compatibility rehearsal; no tenant rows or providers. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const mode=process.argv.slice(2).join(' ');
if (!['--rehearse-test','--rehearse-live'].includes(mode)) throw Error('Exact rehearsal mode required');
const test=mode==='--rehearse-test';
const project=test?TEST_PROJECT:'tgbnakbxwcqjeimygroz';
const files=[...(test?['20261029200000_learn_roster_recovery_guards.sql']:[]),
  '20261105120000_learn_roster_member_identity_confirmation.sql',
  '20261105130000_learn_commusoft_job_review_action.sql'];
const sources=files.map(name=>readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8'));
const sha256=createHash('sha256').update(sources.join('\n')).digest('hex');
const absence=`to_regprocedure('public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)') is null
  and to_regprocedure('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)') is null`;
const guards=`to_regprocedure('public.learn_business_input_review_access(uuid,uuid)') is not null
  and to_regprocedure('public.learn_commusoft_source_job_rows(uuid,uuid)') is not null
  and to_regprocedure('public.work_transition_apply(uuid,uuid,integer,text,jsonb,jsonb,jsonb)') is not null`;
const marker='learn-build01-job-handoff-rollback/1';
const sql=`begin;set local lock_timeout='5s';set local statement_timeout='50s';
 do $$begin if not (${absence}) or not (${guards}) or
  ${test?"to_regprocedure('public.learn_roster_write_guard(uuid,text,text,boolean)') is not null":"to_regprocedure('public.learn_roster_write_guard(uuid,text,text,boolean)') is null"}
 then raise exception 'job_handoff_prerequisite_changed';end if;end$$;
 ${sources.join('\n')}
 do $$begin if to_regprocedure('public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)') is null
  or to_regprocedure('public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)') is null
  or has_function_privilege('anon','public.cp_confirm_member_identity(uuid,uuid,integer,uuid,text,text,text,boolean)','execute')
  or has_function_privilege('anon','public.learn_commusoft_create_job_review_action(uuid,uuid,text,uuid,text)','execute')
 then raise exception 'job_handoff_rehearsal_guard_failed';end if;end$$;
 rollback;
 select '${marker}' marker,${absence} unchanged;`;
const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),
 headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
 body:JSON.stringify({query:sql,read_only:false}),
});
const raw=await response.text();
if(!response.ok){
 let code=null;try{const d=JSON.parse(raw);code=d?.code??/ERROR:\s*([0-9A-Z]{5}):/.exec(d?.message??'')?.[1]??null;}catch{}
 console.log(JSON.stringify({project,sha256,state:'rehearsal_failed',httpStatus:response.status,databaseCode:code}));
 process.exitCode=1;
}else{
 const rows=JSON.parse(raw);
 const passed=Array.isArray(rows)&&rows.length===1&&rows[0].marker===marker&&rows[0].unchanged===true;
 console.log(JSON.stringify({project,sha256,state:passed?'rehearsed_rolled_back':'requires_inspection',unchanged:passed}));
 if(!passed)process.exitCode=1;
}
