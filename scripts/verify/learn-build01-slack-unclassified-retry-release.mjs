/** Install a bounded retry for zero-page unclassified failures on approved public windows. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken, TEST_PROJECT } from './learn-test-readiness.mjs';

const LIVE_PROJECT='tgbnakbxwcqjeimygroz';
const mode=process.argv.slice(2).join(' ');
if(!['--rehearse-test','--apply-test','--rehearse-live','--apply-live'].includes(mode))
 throw Error('Exact Slack unclassified retry release mode required');
const live=mode.endsWith('-live'),project=live?LIVE_PROJECT:TEST_PROJECT;
if(process.env[live?'LEARN_LIVE_ALLOW_PROJECT_REF':'LEARN_TEST_ALLOW_PROJECT_REF']!==project)
 throw Error('Explicit project allowlist required');
const rehearsal=mode.startsWith('--rehearse-');
const source=readFileSync('supabase/migrations/20261104220000_learn_slack_recurring_unclassified_retry.sql','utf8');
const sourceSha256=createHash('sha256').update(source).digest('hex');
const body=source.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
const receiptPath=`.verification-results/learn-build01-slack-unclassified-retry-${live?'live':'test'}-rehearsal.json`;
const stateSql=`select
 md5(pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure)) finish_md5,
 to_regprocedure('public.learn_slack_recurring_unclassified_retry_allowed(uuid,uuid)') is not null guard_exists,
 position('public.learn_slack_recurring_unclassified_retry_allowed(j.tenant_id,j.id)' in
  pg_get_functiondef('public.learn_slack_finish_job(uuid,uuid,text,integer,jsonb)'::regprocedure))>0 retry_gate,
 (select count(*)::int from public.platform_jobs where job_type='slack.history_sync' and status='dead_letter') dead_history_jobs`;
async function query(sql,readOnly=true){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})}),
 });
 if(!response.ok)throw Error(`Slack unclassified retry release HTTP ${response.status}`);
 const rows=await response.json();
 if(!Array.isArray(rows))throw Error('Slack unclassified retry SQL response changed');
 return rows;
}
const [before]=await query(stateSql);
assert(before && !before.guard_exists && !before.retry_gate,
 'Slack unclassified retry baseline changed');
if(!rehearsal){
 const prior=JSON.parse(readFileSync(receiptPath,'utf8'));
 assert(prior.state==='rehearsed_rolled_back' && prior.project===project &&
  prior.sourceSha256===sourceSha256 && prior.priorFinishMd5===before.finish_md5 &&
  Date.now()-Date.parse(prior.completedAt)<3600000,
  'Fresh exact rollback rehearsal required');
}
let rows;
try{
 rows=await query(`begin;\n${body}\n${stateSql};\n${rehearsal?'rollback':'commit'};`,false);
}catch(error){
 const [afterUnknown]=await query(stateSql);
 if(afterUnknown?.guard_exists || afterUnknown?.finish_md5!==before.finish_md5)
  throw Error('Slack retry deployment outcome uncertain; inspect before retry');
 throw error;
}
const staged=rows.find(row=>row?.guard_exists===true && row?.retry_gate===true);
assert(staged,'Guarded unclassified retry absent inside transaction');
const [after]=await query(stateSql);
assert(after && (rehearsal?
 after.finish_md5===before.finish_md5 && !after.guard_exists && !after.retry_gate:
 after.finish_md5===staged.finish_md5 && after.guard_exists && after.retry_gate),
 'Slack unclassified retry readback mismatch');
assert(after.dead_history_jobs===before.dead_history_jobs,
 'Slack retry unexpectedly changed history jobs');
const receipt={state:rehearsal?'rehearsed_rolled_back':'installed',project,
 sourceSha256,priorFinishMd5:before.finish_md5,finishMd5:staged.finish_md5,
 deadHistoryJobs:after.dead_history_jobs,sourceRowsChanged:false,
 providerRequests:0,completedAt:new Date().toISOString()};
if(rehearsal)writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(receipt));
