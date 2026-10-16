/** Advance one exact idle LIVE Email retry for diagnosis, never acceptance.
 * A rollback-only rehearsal is required before the commit mode. No provider,
 * source, interaction or card row is changed by this operation.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { savedCliToken } from './learn-test-readiness.mjs';

const project='tgbnakbxwcqjeimygroz';
const tenant='00000000-0000-0000-0000-000000000001';
const key=`interactions.sync:${tenant}:email`;
const wire='bd8a8997ee61e921ce8714cbf6c291081b0a4b7f7c1af13912e4c58c714d51e4';
const rehearsal='.verification-results/build01-email-inventory-diagnostic-advance-rehearsal.json';
const resultPath='.verification-results/build01-email-inventory-diagnostic-advance-result.json';
const mode=process.argv.slice(2).join(' ');
if(!['--rollback-rehearsal','--advance-exact'].includes(mode) ||
   process.env.LEARN_LIVE_ALLOW_PROJECT_REF!==project)
  throw Error('Exact LIVE Email diagnostic mode required');
if((mode==='--rollback-rehearsal' && existsSync(rehearsal)) ||
   (mode==='--advance-exact' && existsSync(resultPath)))
  throw Error('Prior exact diagnostic attempt needs review');
const token=savedCliToken();
async function query(sql,readOnly) {
  const endpoint=readOnly?'database/query/read-only':'database/query';
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/${endpoint}`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:JSON.stringify({query:sql,read_only:readOnly})});
  if(!response.ok) {
    let detail={};
    try { detail=await response.json(); } catch { /* Withhold provider text. */ }
    const errorFile='.verification-results/build01-email-inventory-diagnostic-http-error.private.json';
    if(!existsSync(errorFile)) writeFileSync(errorFile,JSON.stringify(detail,null,2)+'\n',
      {flag:'wx',mode:0o600});
    const message=typeof detail?.message==='string'?detail.message:'';
    const kind=/syntax error/i.test(message)?'syntax':
      /permission denied/i.test(message)?'permission':
      /statement timeout/i.test(message)?'timeout':
      /not supported|read.only/i.test(message)?'unsupported': 'other';
    throw Error(`Email diagnostic ${readOnly?'read':'transaction'} HTTP ${response.status} ${kind} keys=${Object.keys(detail).join(',')}`);
  }
  const rows=await response.json();
  if(!Array.isArray(rows)) throw Error('Email diagnostic result shape changed');
  return rows;
}
const inventory=await fetch(`https://api.supabase.com/v1/projects/${project}/functions`,{
  redirect:'error',signal:AbortSignal.timeout(30000),
  headers:{Authorization:`Bearer ${token}`}});
if(!inventory.ok) throw Error('LIVE worker metadata unconfirmed');
const worker=(await inventory.json()).find(v=>v.slug==='platform-worker');
if(worker?.version!==101 || worker?.ezbr_sha256!==wire || worker?.status!=='ACTIVE')
  throw Error('Exact diagnostic worker not serving');
const preflight=await query(`select id,status,attempt_count,max_attempts,error_code,
  available_at,lease_expires_at,updated_at,
  metadata?'build01_diagnostic_advance_at' already_advanced,
  payload->>'source' source,payload->>'limit' batch_limit
  from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='interactions.sync' and job_key='${key}'
  and status in('queued','running','retrying')`,true);
if(preflight.length!==1) throw Error('One exact active Email lane not confirmed');
const row=preflight[0];
if(!/^[a-f0-9-]{36}$/i.test(row.id) || row.status!=='retrying' ||
   row.attempt_count!==4 || row.max_attempts!==5 ||
   row.error_code!=='projection_inventory_unconfirmed' ||
   row.source!=='email' || row.batch_limit!=='200' ||
   row.lease_expires_at!==null || row.already_advanced!==false ||
   !/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}\+00$/.test(row.available_at) ||
   !Number.isFinite(Date.parse(row.available_at)) ||
   Date.parse(row.available_at)<Date.now()+300000)
  throw Error('Exact idle Email retry preflight changed');
if(mode==='--advance-exact') {
  const prior=JSON.parse(readFileSync(rehearsal,'utf8'));
  if(prior.state!=='rolled_back' || prior.id!==row.id ||
     prior.attempt!==row.attempt_count || prior.availableAt!==row.available_at ||
     prior.workerWire!==wire) throw Error('Rollback rehearsal no longer matches job');
}
const action=mode==='--rollback-rehearsal'?'rollback':'commit';
const sql=`begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $$ declare n integer; begin
 update public.platform_jobs set available_at=clock_timestamp(),
  updated_at=clock_timestamp(),
  metadata=coalesce(metadata,'{}'::jsonb)||
   jsonb_build_object('build01_diagnostic_advance_at',clock_timestamp())
 where tenant_id='${tenant}'::uuid and id='${row.id}'::uuid
  and job_type='interactions.sync' and job_key='${key}'
  and payload->>'source'='email' and payload->>'limit'='200'
  and status='retrying' and attempt_count=4 and max_attempts=5
  and error_code='projection_inventory_unconfirmed'
  and available_at='${row.available_at}'::timestamptz
  and lease_expires_at is null
  and not (coalesce(metadata,'{}'::jsonb)?'build01_diagnostic_advance_at');
 get diagnostics n=row_count;
 if n<>1 then raise exception 'email_diagnostic_exact_job_changed'; end if;
end $$;
${action};`;
await query(sql,false);
const after=await query(`select status,attempt_count,available_at,
  metadata?'build01_diagnostic_advance_at' advanced
  from public.platform_jobs where tenant_id='${tenant}'::uuid and id='${row.id}'::uuid`,true);
if(after.length!==1 || (action==='rollback' &&
   (after[0].advanced!==false || after[0].available_at!==row.available_at ||
    after[0].attempt_count!==4)) ||
   (action==='commit' && after[0].advanced!==true))
  throw Error('Email diagnostic transaction outcome unconfirmed');
const record={version:'learn-build01-email-inventory-diagnostic-advance/1',
  state:action==='rollback'?'rolled_back':'advanced_for_diagnosis',
  observedAt:new Date().toISOString(),project,tenant,id:row.id,
  attempt:row.attempt_count,availableAt:row.available_at,workerWire:wire,
  providerRequests:0,sourceWrites:0,interactionWrites:0,
  unattendedRecoveryProven:false};
writeFileSync(action==='rollback'?rehearsal:resultPath,
  JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({state:record.state,attempt:record.attempt,
  providerRequests:0,sourceWrites:0,unattendedRecoveryProven:false}));
