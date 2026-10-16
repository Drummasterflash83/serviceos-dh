/** Align one exact idle LIVE Email job payload with the reviewed ten-row worker. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';
const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const key=`interactions.sync:${tenant}:email`;
const mode=process.argv.slice(2).join(' ');
if(!['--rollback-rehearsal','--apply-exact'].includes(mode)||
  process.env.LEARN_LIVE_ALLOW_PROJECT_REF!==project)
  throw Error('Exact LIVE Email queue repair mode required');
const rehearsal='.verification-results/build01-email-ten-row-job-rehearsal.json';
const resultPath='.verification-results/build01-email-ten-row-job-result.json';
if((mode==='--rollback-rehearsal'&&existsSync(rehearsal))||
  (mode==='--apply-exact'&&existsSync(resultPath)))
  throw Error('Prior exact queue repair needs review');
const token=savedCliToken();
async function get(url,options={}){
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/${url}`,{
    redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...options});
  if(!response.ok) throw Error(`Email queue repair API HTTP ${response.status}`);
  return response.json();
}
const functions=await get('functions');
const worker=functions.find(f=>f.slug==='platform-worker');
const scheduler=functions.find(f=>f.slug==='interactions-scheduled-sync');
if(worker?.version!==103||worker?.ezbr_sha256!==
  '60c191fe0a2917dfd762f4238b6e22750b2f9b33a355dc5a21189034f7c1d2e2'||
  scheduler?.version!==56||scheduler?.ezbr_sha256!==
  '8014c04f25290cb7ad027be42828fc5d00a7df6253c3d2f42331ec9399b10140')
  throw Error('Exact LIVE Email worker/scheduler not active');
async function query(sql,readOnly){
  const rows=await get(`database/query${readOnly?'/read-only':''}`,{
    method:'POST',body:JSON.stringify({query:sql})});
  if(!Array.isArray(rows)) throw Error('Queue repair result shape changed');
  return rows;
}
const rows=await query(`select id,status,attempt_count,max_attempts,error_code,
  available_at,lease_expires_at,created_at,payload->>'limit' batch_limit,
  payload->>'source' source from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_key='${key}'
    and status in('queued','retrying','running')`,true);
if(rows.length!==1) throw Error('One exact active Email job not confirmed');
const row=rows[0];
const idleRetry=row.status==='retrying'&&
  ['lease_expired','projection_inventory_unconfirmed'].includes(row.error_code)&&
  row.lease_expires_at===null;
const expiredClaim=row.status==='running'&&
  [null,'lease_expired'].includes(row.error_code)&&
  typeof row.lease_expires_at==='string'&&
  Date.parse(row.lease_expires_at)<Date.now()-10000;
if(!/^[a-f0-9-]{36}$/i.test(row.id)||(!idleRetry&&!expiredClaim)||
  !Number.isInteger(row.attempt_count)||row.attempt_count<1||
  row.attempt_count>4||row.max_attempts!==5||
  row.batch_limit!=='200'||row.source!=='email'||
  Date.parse(row.created_at)<Date.parse('2026-10-16T19:45:00Z')||
  !/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}\+00$/.test(row.available_at))
  throw Error('Exact idle Email job preflight changed');
if(mode==='--apply-exact'){
  const prior=JSON.parse(readFileSync(rehearsal,'utf8'));
  if(prior.state!=='rolled_back'||prior.id!==row.id||
    prior.attempt!==row.attempt_count||prior.availableAt!==row.available_at||
    prior.status!==row.status||prior.leaseExpiresAt!==row.lease_expires_at)
    throw Error('Exact rollback rehearsal no longer matches job');
}
const action=mode==='--rollback-rehearsal'?'rollback':'commit';
await query(`begin;
set local lock_timeout='5s';set local statement_timeout='15s';
do $$declare n integer;begin
 update public.platform_jobs set payload=jsonb_set(payload,'{limit}','10'::jsonb,false)
 where tenant_id='${tenant}'::uuid and id='${row.id}'::uuid
 and job_key='${key}' and job_type='interactions.sync'
 and status='${row.status}' and attempt_count=${row.attempt_count} and max_attempts=5
 and error_code is not distinct from ${row.error_code===null?'null':`'${row.error_code}'`}
 and lease_expires_at is not distinct from ${row.lease_expires_at===null?'null':`'${row.lease_expires_at}'::timestamptz`}
 and available_at='${row.available_at}'::timestamptz
 and payload->>'source'='email' and payload->>'limit'='200';
 get diagnostics n=row_count;
 if n<>1 then raise exception 'email_ten_row_job_changed';end if;
end $$;
${action};`,false);
const after=await query(`select status,attempt_count,payload->>'limit' batch_limit
 from public.platform_jobs where tenant_id='${tenant}'::uuid and id='${row.id}'::uuid`,true);
if(after.length!==1||(action==='rollback'&&after[0].batch_limit!=='200')||
  (action==='commit'&&after[0].batch_limit!=='10'))
  throw Error('Email queue repair outcome unconfirmed');
const record={state:action==='rollback'?'rolled_back':'applied',
  observedAt:new Date().toISOString(),project,tenant,id:row.id,
  attempt:row.attempt_count,availableAt:row.available_at,
  status:row.status,leaseExpiresAt:row.lease_expires_at,
  sourceRowsChanged:0,providerRequests:0};
writeFileSync(action==='rollback'?rehearsal:resultPath,
  JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({state:record.state,attempt:record.attempt,
  sourceRowsChanged:0,providerRequests:0}));
