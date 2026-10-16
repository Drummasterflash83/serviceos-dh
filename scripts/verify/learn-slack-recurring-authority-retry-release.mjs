/** Bounded retry for unchanged approved recurring Slack authority failures. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const LIVE_PROJECT='tgbnakbxwcqjeimygroz';
const mode=process.argv.slice(2).join(' ');
if(!['--rehearse-test','--apply-test','--rehearse-live','--apply-live'].includes(mode))
 throw Error('Explicit recurring Slack authority retry release mode required');
const live=mode.endsWith('-live'),project=live?LIVE_PROJECT:TEST_PROJECT;
if(process.env[live?'LEARN_LIVE_ALLOW_PROJECT_REF':'LEARN_TEST_ALLOW_PROJECT_REF']!==project)
 throw Error('Explicit project allowlist required');
const rehearsal=mode.startsWith('--rehearse-');
const source=readFileSync('supabase/migrations/20261104190000_learn_slack_recurring_authority_retry.sql','utf8');
const sourceSha256=createHash('sha256').update(source).digest('hex');
const body=source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
const receiptPath=`.verification-results/learn-slack-recurring-authority-retry-${live?'live':'test'}-rehearsal.json`;
const stateQuery=`select
 md5(pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure)) finish_md5,
 to_regprocedure('public.learn_slack_recurring_authority_retry_allowed(uuid,uuid)') is not null guard_exists,
 position('public.learn_slack_recurring_authority_retry_allowed(j.tenant_id,j.id)' in
  pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure))>0 retry_gate,
 (select count(*)::int from public.platform_jobs where job_type='slack.history_sync' and status='dead_letter') dead_history_jobs`;
async function query(sql,readOnly=true){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})});
 if(!r.ok)throw Error(`Recurring Slack retry release HTTP ${r.status}`);
 const rows=await r.json();if(!Array.isArray(rows))throw Error('Recurring retry SQL response changed');
 return rows;
}
const before=(await query(stateQuery))[0];
assert(before?.guard_exists===false&&before?.retry_gate===false,
 'Recurring retry baseline changed');
if(!rehearsal){
 const prior=JSON.parse(readFileSync(receiptPath,'utf8'));
 assert(prior.state==='rehearsed_rolled_back'&&prior.sourceSha256===sourceSha256&&
  prior.priorFinishMd5===before.finish_md5&&Date.now()-Date.parse(prior.completedAt)<3600000,
  'Fresh exact rollback rehearsal required');
}
let rows;
try{rows=await query(`begin;\n${body}\n${stateQuery};\n${rehearsal?'rollback':'commit'};`,false)}
catch(e){const afterUnknown=(await query(stateQuery))[0];
 if(afterUnknown?.finish_md5!==before.finish_md5||afterUnknown?.guard_exists)
  throw Error('Recurring retry outcome uncertain; inspect before retry');
 throw e;}
const staged=rows.find(r=>r?.guard_exists===true&&r?.retry_gate===true);
assert(staged,'Guarded retry absent inside transaction');
const after=(await query(stateQuery))[0];
assert(after && (rehearsal?
 after.finish_md5===before.finish_md5&&after.guard_exists===false&&after.retry_gate===false:
 after.finish_md5===staged.finish_md5&&after.guard_exists===true&&after.retry_gate===true),
 'Recurring retry readback mismatch');
assert(before.dead_history_jobs===after.dead_history_jobs,
 'Recurring retry unexpectedly changed jobs');
const receipt={state:rehearsal?'rehearsed_rolled_back':'installed',project,sourceSha256,
 priorFinishMd5:before.finish_md5,finishMd5:staged.finish_md5,
 deadHistoryJobs:after.dead_history_jobs,sourceRowsChanged:false,providerRequests:0,
 completedAt:new Date().toISOString()};
if(rehearsal)writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'w',mode:0o600});
console.log(JSON.stringify(receipt));
