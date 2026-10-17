/** One exact LIVE recovery of a stopped, empty-page Commusoft recurring job. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';

const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const mode=process.argv.slice(2).join(' ');
if(!['--inspect-live','--apply-live'].includes(mode) || process.env.LEARN_LIVE_ALLOW_PROJECT_REF!==project)
 throw Error('Explicit LIVE Commusoft recovery mode and project allowlist required');
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const receiptPath='.verification-results/learn-commusoft-retained-authority-requeue-live-inspection.json';
async function query(sql,readOnly=true){
 const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${readOnly?'/read-only':''}`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{Authorization:`Bearer ${savedCliToken()}`,'Content-Type':'application/json'},
  body:JSON.stringify({query:sql,...(readOnly?{}:{read_only:false})})});
 if(!response.ok){
  const detail=(await response.text()).slice(0,500).replace(/[\r\n]/g,' ');
  throw Error(`Commusoft retained recovery HTTP ${response.status}: ${detail}`);
 }
 const rows=await response.json();if(!Array.isArray(rows))throw Error('Commusoft recovery response changed');
 return rows;
}
const stateQuery=`select j.id job_id,j.status,j.error_code,j.attempt_count,j.max_attempts,
 s.account_id,s.phase,s.current_request,s.enabled,s.last_state,
 a.sync_cursor->>'pages' retained_pages,
 a.settings->'commusoft_import'->>'contactTargetCount' contact_targets,
 (select count(*)::int from public.learn_business_input_pages p where p.job_id=j.id) job_pages,
 public.learn_commusoft_recurring_authority_retry_allowed(s.tenant_id,j.id) guard_allowed
from public.learn_commusoft_recurring s
join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id
join public.platform_jobs j on j.tenant_id=s.tenant_id and j.job_type='commusoft.source_sync'
 and j.job_key='commusoft.source:'||s.account_id::text||':'||s.current_request::text
where s.tenant_id='${tenant}'::uuid and j.status in ('dead_letter','retrying','running','succeeded')
order by j.created_at desc limit 1`;
const inspect=()=>query(`begin;${stateQuery};rollback;`,false);
const current=(await inspect())[0];
assert(current&&uuid.test(current.job_id)&&uuid.test(current.account_id)&&uuid.test(current.current_request),
 'Current Commusoft recovery scope absent');
if(mode==='--inspect-live'){
 assert(current.status==='dead_letter'&&current.error_code==='commusoft_authority_unavailable'&&
  current.attempt_count===1&&current.job_pages===0&&current.phase===4&&
  current.retained_pages==='516'&&current.contact_targets==='872'&&current.guard_allowed===true,
  'Exact stopped Commusoft scope or authority guard changed');
 const receipt={state:'inspected',project,tenant,jobId:current.job_id,accountId:current.account_id,
  requestId:current.current_request,phase:current.phase,retainedPages:516,contactTargets:872,
  jobPages:0,guardAllowed:true,inspectedAt:new Date().toISOString()};
 writeFileSync(receiptPath,JSON.stringify(receipt,null,2)+'\n',{flag:'w',mode:0o600});
 console.log(JSON.stringify(receipt));
}else{
 const prior=JSON.parse(readFileSync(receiptPath,'utf8'));
 assert(prior.state==='inspected'&&prior.jobId===current.job_id&&prior.accountId===current.account_id&&
  prior.requestId===current.current_request&&current.status==='dead_letter'&&current.guard_allowed===true&&
  Date.now()-Date.parse(prior.inspectedAt)<15*60*1000,'Fresh exact recovery inspection required');
 let answer;
 try{answer=await query(`begin;select public.learn_commusoft_requeue_retained_authority('${tenant}'::uuid,'${current.job_id}'::uuid) recovery;commit;`,false)}
 catch(error){
  const unknown=(await inspect())[0];
  if(unknown?.job_id===current.job_id&&unknown?.status!=='dead_letter')
   throw Error('Commusoft requeue outcome uncertain; inspect job before retry');
  throw error;
 }
 const receipt=answer.find(row=>row?.recovery)?.recovery;
 assert(receipt?.job_id===current.job_id&&receipt?.state==='retrying'&&receipt?.retained_page_written===false,
  'Commusoft requeue receipt changed');
 const after=(await inspect())[0];
 assert(after?.job_id===current.job_id&&['retrying','running','succeeded'].includes(after.status),
  'Commusoft recovery readback changed');
 console.log(JSON.stringify({state:'requeued',project,tenant,jobId:current.job_id,
  immediatelyObservedStatus:after.status,priorRetainedPages:516,sourceRowsChanged:false,
  providerRequestsByThisScript:0,completedAt:new Date().toISOString()}));
}
