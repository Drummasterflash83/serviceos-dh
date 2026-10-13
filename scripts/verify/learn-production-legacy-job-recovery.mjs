/** Bounded recovery of exactly the reviewed 14 old, unleased tracking rows.
 * No retries, new capture, secret changes or provider requests. Prepared row
 * identities/fingerprints and execution intent stay in the private run directory.
 */
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {savedCliToken} from './learn-test-readiness.mjs';
const project='tgbnakbxwcqjeimygroz', [mode,root]=process.argv.slice(2);
if(!['prepare','apply','inspect'].includes(mode)||!/^\.verification-results\/legacy-job-recovery-[a-z0-9-]+$/.test(root??'')||process.env.LEARN_LEGACY_JOB_PROJECT!==project)throw Error('Explicit recovery mode, private location and production target required');
const sha=b=>createHash('sha256').update(b).digest('hex');
const sql=readFileSync('scripts/verify/learn-production-legacy-job-settlement.sql','utf8');
const save=(name,data)=>writeFileSync(root+'/'+name,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});
const read=name=>JSON.parse(readFileSync(root+'/'+name));
const token=savedCliToken();
async function query(sql){const r=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query:sql})});if(!r.ok)throw Error('Recovery query returned HTTP '+r.status+'; do not retry writes');return await r.json();}
if(mode==='prepare'){
 if(existsSync(root))throw Error('Use a fresh preparation directory');mkdirSync(root,{mode:0o700});
 const rows=await query(`begin transaction read only;set local statement_timeout='20s';select jsonb_build_object('projectRef','${project}','observedAt',clock_timestamp(),'rows',jsonb_agg(jsonb_build_object('id',id,'tenantId',tenant_id,'rowHash',md5(to_jsonb(j)::text),'jobType',job_type) order by id)) manifest from public.platform_jobs j where status='running' and claimed_by is null and claimed_at is null and lease_expires_at is null and attempt_count=0 and completed_at is null and failed_at is null and cancelled_at is null and started_at<clock_timestamp()-interval '24 hours' and updated_at<clock_timestamp()-interval '24 hours' and ((job_type='phone.scheduled_sync' and connector_id='simwood') or(job_type='graph.sync' and connector_id='openfolk-core'));commit;`);
 const manifest=rows[0]?.manifest;
 if(manifest?.rows?.length!==14||manifest.rows.filter(r=>r.jobType==='phone.scheduled_sync').length!==13||manifest.rows.filter(r=>r.jobType==='graph.sync').length!==1)throw Error('Historical scope changed; review required');
 save('manifest.json',manifest);save('preparation.json',{state:'prepared_not_applied',sqlSha256:sha(sql),manifestSha256:sha(JSON.stringify(manifest)),productionChanges:0});
 console.log(JSON.stringify({state:'prepared_not_applied',jobs:14,phone:13,graph:1,productionChanges:0}));
}else{
 const m=read('manifest.json'),prep=read('preparation.json');
 if(m.projectRef!==project||m.rows.length!==14||new Set(m.rows.map(r=>r.id)).size!==14||m.rows.some(r=>!/^[-a-f0-9]{36}$/.test(r.id)||!/^[-a-f0-9]{36}$/.test(r.tenantId)||!/^[-a-f0-9]{32}$/.test(r.rowHash))||prep.sqlSha256!==sha(sql)||prep.manifestSha256!==sha(JSON.stringify(m)))throw Error('Exact recovery preparation changed');
 const ids=m.rows.map(r=>"'"+r.id+"'::uuid").join(',');
 if(mode==='apply'){
  const rehearsal=JSON.parse(readFileSync('.verification-results/legacy-job-settlement-rehearsal-v3/report.json'));
  if(rehearsal.state!=='legacy_job_settlement_rehearsed_offline'||!rehearsal.containerRemoved||rehearsal.sqlSha256!==sha(sql)||!rehearsal.originalJobRowsReconstructedExactly||!rehearsal.existingAuditRowsUnchanged)throw Error('Passing exact isolated rehearsal required');
  if(Date.now()-Date.parse(m.observedAt)>25*60*1000||Date.parse(m.observedAt)>Date.now())throw Error('Fresh observation required');
  save('intent.json',{createdAt:new Date().toISOString(),project,sqlSha256:sha(sql),manifestSha256:prep.manifestSha256,rows:14});
  try{await query("begin;set transaction isolation level repeatable read;set local lock_timeout='5s';set local statement_timeout='30s';set local role postgres;set local serviceos.legacy_job_target='"+project+"';select set_config('serviceos.legacy_job_manifest','"+JSON.stringify(m).replaceAll("'","''")+"',true);"+sql+'commit;');save('response.json',{acknowledged:true});}
  catch{save('response.json',{acknowledged:false,state:'unknown_outcome_inspect_do_not_retry'});throw Error('Recovery response uncertain; inspect this run, never repeat apply');}
 }
 const rows=await query(`begin transaction read only;set local statement_timeout='20s';select count(*)::int jobs,count(a.id)::int receipts,bool_and(j.status='failed' and j.failed_at is not null and j.last_error='legacy_execution_interrupted_capture_unverified' and (to_jsonb(j)-array['status','failed_at','last_error','updated_at'])=((a.detail->'before')-array['status','failed_at','last_error','updated_at']) and md5((a.detail->'before')::text)=a.detail->>'beforeHash' and a.tenant_id=j.tenant_id and a.detail->>'automaticRetry'='false') valid from public.platform_jobs j left join public.audit_logs a on a.resource_id=j.id::text and a.action='learn.legacy_job.interrupted' where j.id in(${ids});commit;`);
 const r=rows[0];const report={state:r?.jobs===14&&r?.receipts===14&&r?.valid===true?'historical_jobs_settled_with_audit':'settlement_not_verified',observedAt:new Date().toISOString(),project,sqlSha256:sha(sql),...r,providerRequests:0,retriesCreated:0,sourceRowsChanged:0,liveDrainProven:false};
 save('inspection-'+Date.now()+'.json',report);console.log(JSON.stringify(report));if(report.state!=='historical_jobs_settled_with_audit')process.exitCode=1;
}
