/** Exact schema-only claim reservation, with a rollback rehearsal per project. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const LIVE_PROJECT='tgbnakbxwcqjeimygroz';
const mode=process.argv.slice(2).join(' ');
if(!['--rehearse-test','--apply-test','--rehearse-live','--apply-live'].includes(mode))
 throw Error('Explicit exact Slack claim release mode required');
const live=mode.endsWith('-live'),project=live?LIVE_PROJECT:TEST_PROJECT;
if(process.env[live?'LEARN_LIVE_ALLOW_PROJECT_REF':'LEARN_TEST_ALLOW_PROJECT_REF']!==project)
 throw Error('Explicit project allowlist required');
const rehearsal=mode.startsWith('--rehearse-');
const source=readFileSync('supabase/migrations/20261104180000_learn_slack_event_generic_claim_exclusion.sql','utf8');
const sourceSha256=createHash('sha256').update(source).digest('hex');
const body=source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
const receiptPath=`.verification-results/learn-slack-event-generic-claim-${live?'live':'test'}-rehearsal.json`;
const stateQuery=`select
 md5(pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure)) function_md5,
 position('and c.job_type not in (''slack.history_sync'',''slack.thread_sync'')' in pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure))>0 old_gate,
 position('and c.job_type not in (''slack.history_sync'',''slack.thread_sync'',''slack.event_sync'')' in pg_get_functiondef('public.platform_jobs_claim(text,integer,integer,text[])'::regprocedure))>0 new_gate,
 (select count(*)::int from public.platform_jobs where job_type='slack.event_sync') event_jobs,
 (select count(*)::int from public.platform_jobs where job_type='slack.event_sync' and status='dead_letter') dead_events`;
async function query(sql,readOnly=true){
 const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})});
 if(!r.ok)throw Error(`Slack claim release HTTP ${r.status}`);
 const rows=await r.json();if(!Array.isArray(rows))throw Error('Slack claim SQL response changed');
 return rows;
}
const before=(await query(stateQuery))[0];
assert(before?.old_gate===true&&before?.new_gate===false,'Exact generic claim baseline changed');
if(!rehearsal){
 const prior=JSON.parse(readFileSync(receiptPath,'utf8'));
 assert(prior.state==='rehearsed_rolled_back'&&prior.sourceSha256===sourceSha256&&
  prior.priorFunctionMd5===before.function_md5&&Date.now()-Date.parse(prior.completedAt)<3600000,
  'Fresh exact rollback rehearsal required');
}
let rows;
try{
 rows=await query(`begin;\n${body}\n${stateQuery};\n${rehearsal?'rollback':'commit'};`,false);
}catch(e){
 const afterUnknown=(await query(stateQuery))[0];
 if(afterUnknown?.function_md5!==before.function_md5 || afterUnknown.new_gate)
  throw Error('Claim release outcome uncertain; inspect before retry');
 throw e;
}
const staged=rows.find(r=>r?.new_gate===true&&r?.old_gate===false);
assert(staged,'Exact claim exclusion absent inside transaction');
const after=(await query(stateQuery))[0];
assert(after && (rehearsal?
 after.function_md5===before.function_md5&&after.old_gate===true&&after.new_gate===false:
 after.function_md5===staged.function_md5&&after.old_gate===false&&after.new_gate===true),
 'Claim release readback mismatch');
assert(before.event_jobs===after.event_jobs&&before.dead_events===after.dead_events,
 'Claim release unexpectedly changed jobs');
const receipt={state:rehearsal?'rehearsed_rolled_back':'installed',project,sourceSha256,
 priorFunctionMd5:before.function_md5,functionMd5:staged.function_md5,
 eventJobs:after.event_jobs,deadEvents:after.dead_events,sourceRowsChanged:false,
 providerRequests:0,completedAt:new Date().toISOString()};
if(rehearsal)writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'w',mode:0o600});
console.log(JSON.stringify(receipt));
