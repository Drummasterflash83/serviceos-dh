/** Process only the retained Drummonds TEST sample. No provider reads, AI,
 * accounts, grants or source edits. Durable journal prevents accidental replay. */
import{readFileSync,writeFileSync}from'node:fs';
import{randomUUID}from'node:crypto';
import{TEST_PROJECT,savedCliToken}from'./learn-test-readiness.mjs';
import{communicationQuery}from'./learn-card-communication-catalog.mjs';
import{edgeInventory}from'./learn-test-email-runtime-deploy.mjs';
const tenant='f8c114fa-fee7-4983-8970-f6e7f5fd3129',file='.verification-results/real-retained-card-run-20261012.json';
const resume=process.argv[2]==='--resume-denied';
if(!['--apply --existing-cli-login','--resume-denied --existing-cli-login'].includes(process.argv.slice(2).join(' '))||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit fixed TEST scope required');
const previous=resume?JSON.parse(readFileSync(file)):null;
if(resume&&(previous.state!=='requires_inspection'||previous.runs.length!==1||previous.runs[0].status!==403||previous.readback.email_interactions!==0||!previous.readback.paused))throw Error('Only the exact denied, unstarted run may resume');
const rehearsal=JSON.parse(readFileSync('.verification-results/real-retained-card-rehearsal-v3-20261012.json'));
if(rehearsal.state!=='real_retained_card_rehearsed_rollback_only'||rehearsal.result.emailInteractions!==19||rehearsal.preservedDatasets!==198)throw Error('Retained sample rehearsal required');
const token=savedCliToken(),q=(sql,readOnly=true)=>communicationQuery(token,sql,{readOnly}),check=(v,m)=>{if(!v)throw Error(m);};
const inventory=await edgeInventory(token),worker=inventory.find(e=>e.slug==='platform-worker');
check(worker?.version===22&&worker.ezbr_sha256==='126ee9d9a672efd3579740380d6fab2e89df15338b9e83d6250b990b1258a072'&&worker.status==='ACTIVE'&&!worker.verify_jwt,'Exact tested worker required');
check(!inventory.some(e=>e.slug==='business-graph-sync'),'Graph downstream scope changed');
const tables=await q(`select n.nspname||'.'||c.relname name,exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped) scoped from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1`);
check(tables.length===198&&tables.every(t=>/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t.name)),'Exact preservation inventory required');
const snapshot=(foreign=false)=>tables.map(t=>`select '${t.name}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${t.name} s${foreign&&t.scoped?` where tenant_id is distinct from '${tenant}'::uuid`:''}`).join(' union all ');
const currentBefore=await q(snapshot()),currentForeign=await q(snapshot(true));
const before=previous?.before??currentBefore,foreignBefore=previous?.foreignBefore??currentForeign;
if(resume&&JSON.stringify(currentForeign)!==JSON.stringify(foreignBefore))throw Error('Other data changed before resumption');
const pre=(await q(`select (select count(*) from email_messages where tenant_id='${tenant}')::int emails,(select count(*) from interactions where tenant_id='${tenant}')::int interactions,(select count(*) from platform_jobs where status='running' or (status in('queued','retrying') and job_type in('interactions.sync','identity.resolve')))::int conflicting,(select value='false'::jsonb from feature_flags where tenant_id='${tenant}' and flag='learn.inputs.email.enabled') paused,to_regclass('cron.job') is null no_schedules`))[0];
check(pre.emails===20&&pre.interactions===2&&pre.conflicting===(resume?1:0)&&pre.paused&&pre.no_schedules,'Retained sample or idle scope changed');
const queuedBefore=previous?.queuedBefore??await q(`select id,md5(to_jsonb(j)::text) fingerprint from platform_jobs j order by id`);
if(resume){const r=await q(`select id,status,attempt_count,claimed_by,lease_expires_at from platform_jobs where id='${previous.jobs[0]}' and tenant_id='${tenant}'`);check(r.length===1&&r[0].status==='queued'&&r[0].attempt_count===0&&r[0].claimed_by===null&&r[0].lease_expires_at===null,'Denied job was executed or changed');}
const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
check(response.ok,'Existing TEST worker key unavailable');const keys=await response.json(),service=keys.filter(k=>k.name==='service_role');check(service.length===1,'Unique TEST worker key required');
const key=service[0].api_key,claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));check(claims.ref===TEST_PROJECT&&claims.role==='service_role','Key scope differs');
const headers={Authorization:`Bearer ${key}`,apikey:key,'x-serviceos-internal-key':key,'content-type':'application/json'};
const jobs=previous?.jobs??[randomUUID(),randomUUID()];const report={state:'prepared',projectRef:TEST_PROJECT,tenant,startedAt:new Date().toISOString(),jobs,workerVersion:22,before,foreignBefore,queuedBefore,runs:previous?.runs??[],providerRequests:0,aiRequests:0,newAccounts:0,newGrants:0,productionChanged:false};
if(resume){writeFileSync(file+'.resume',JSON.stringify({state:'resuming_denied_unclaimed_job',at:new Date().toISOString(),job:jobs[0]})+'\n',{mode:0o600,flag:'wx'});}else writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
async function run(index,type){
 const source=type==='interactions.sync'?'email':'identity';
 const key=type==='interactions.sync'?`${type}:${tenant}:email`:`${type}:${tenant}`;
 const module=type==='interactions.sync'?'core.interactions':'core.identity';
 const sql=`begin;set local lock_timeout='3s';
 do $$begin if exists(select 1 from platform_jobs where status='running' or (status in('queued','retrying') and job_type in('interactions.sync','identity.resolve'))) then raise exception 'processing_scope_busy';end if;end$$;
 ${index===0?`update feature_flags set value='true'::jsonb where tenant_id='${tenant}' and flag='learn.inputs.email.enabled' and value='false'::jsonb;`:''}
 insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload) values('${jobs[index]}','${tenant}','openfolk-core','${module}','${type}','${key}','queued',50,1,'${JSON.stringify({limit:23,...(source==='email'?{source}:{})})}'::jsonb);commit;`;
 report.state='queue_submission_pending';report.activeStage=index;save();if(resume&&index===0)await q(`update feature_flags set value='true'::jsonb where tenant_id='${tenant}' and flag='learn.inputs.email.enabled' and value='false'::jsonb`,false);else await q(sql,false);
 report.state='worker_submission_pending';save();
 const r=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,{method:'POST',headers,body:JSON.stringify({batch_size:1,job_types:[type]}),redirect:'error',signal:AbortSignal.timeout(60000)});
 const b=await r.json();
 report.runs.push({type,status:r.status,claimed:b.claimed,succeeded:b.succeeded,deadLettered:b.dead_lettered,retrying:b.retrying,unconfirmed:b.unconfirmed});save();
 const rows=await q(`select id,status,records_processed,error_code,result from platform_jobs where id='${jobs[index]}' and tenant_id='${tenant}'`);report.runs.at(-1).settlement=rows[0];save();
 check(r.status===200&&b.claimed===1&&b.unconfirmed===0&&rows.length===1,'Worker response unconfirmed');
 check(index===0?rows[0].status==='succeeded'&&rows[0].records_processed===19:rows[0].status==='dead_letter'&&rows[0].error_code==='identity_review_required'&&rows[0].records_processed===19,'Unexpected durable processing outcome');
}
try{await run(0,'interactions.sync');await run(1,'identity.resolve');report.state='processed_needs_readback';}
catch(e){report.state='requires_inspection';report.error=e.message?.length<180?e.message:'Processing unconfirmed';process.exitCode=1;}
finally{
 await q(`update feature_flags set value='false'::jsonb where tenant_id='${tenant}' and flag='learn.inputs.email.enabled' and value='true'::jsonb`,false);
 const after=await q(snapshot()),foreignAfter=await q(snapshot(true));
 report.foreignAndUnscopedPreserved=JSON.stringify(foreignBefore)===JSON.stringify(foreignAfter);
 report.changedDatasets=after.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(before[i])).map(r=>r.name);
 const allowed=new Set(['public.interactions','public.platform_events','public.platform_jobs','public.people','public.companies','public.customer_cards','public.interaction_match_suggestions','public.recommendations','public.learn_identity_delivery_receipts','public.learn_interaction_projection_receipts','public.learn_processing_publications','public.learn_processing_settlements','public.system_health_checks']);
 report.onlyExpectedDerivedDatasetsChanged=report.changedDatasets.every(n=>allowed.has(n));
 report.existingJobsPreserved=JSON.stringify(queuedBefore)===JSON.stringify(await q(`select id,md5(to_jsonb(j)::text) fingerprint from platform_jobs j where id not in('${jobs[0]}','${jobs[1]}') order by id`));
 report.readback=(await q(`select (select value='false'::jsonb from feature_flags where tenant_id='${tenant}' and flag='learn.inputs.email.enabled') paused,(select count(*) from customer_cards where tenant_id='${tenant}')::int cards,(select count(*) from interactions where tenant_id='${tenant}' and source_table='email_messages')::int email_interactions,(select count(*) from interactions where tenant_id='${tenant}' and processing_status='identity_review')::int held_interactions,(select count(*) from email_messages where tenant_id='${tenant}')::int emails,(select count(*) from platform_jobs where status='running')::int running`))[0];
 if(report.state==='processed_needs_readback'&&report.foreignAndUnscopedPreserved&&report.onlyExpectedDerivedDatasetsChanged&&report.existingJobsPreserved&&report.readback.paused&&report.readback.emails===20&&report.readback.email_interactions===19&&report.readback.held_interactions===2&&report.readback.running===0)report.state='real_retained_email_to_cards_verified_with_slack_holds';else process.exitCode=1;
 report.finishedAt=new Date().toISOString();save();const{before:b,foreignBefore:f,queuedBefore:j,...safe}=report;console.log(JSON.stringify(safe));
}
