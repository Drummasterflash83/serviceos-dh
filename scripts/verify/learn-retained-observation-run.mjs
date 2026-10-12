/** One bounded run on the already-retained Drummonds TEST sample. No providers/AI. */
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {edgeInventory} from './learn-test-email-runtime-deploy.mjs';
if(process.argv.slice(2).join(' ')!=='--apply --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Fixed retained TEST scope required');
const tenant='f8c114fa-fee7-4983-8970-f6e7f5fd3129',file='.verification-results/retained-observation-run-20261013.json';
const token=savedCliToken(),q=(sql,readOnly=true)=>communicationQuery(token,sql,{readOnly}),check=(v,m)=>{if(!v)throw Error(m);};
const deployed=JSON.parse(readFileSync('.verification-results/observation-runtime-deploy-result.json'));
const worker=(await edgeInventory(token)).find(e=>e.slug==='platform-worker');
check(deployed.state==='deployed_needs_http_acceptance'&&worker?.version===23&&worker.ezbr_sha256===deployed.endpoints[0].ezbr_sha256,'Exact worker required');
const pre=(await q(`select (select count(*) from interactions where tenant_id='${tenant}')::int interactions,
 (select count(*) from interactions where tenant_id='${tenant}' and processing_status='enriched')::int enriched,
 (select count(*) from intelligence_ingestions where tenant_id='${tenant}')::int ingestions,
 (select count(*) from platform_jobs where status='running' or(status in('queued','retrying') and job_type in('intelligence.ingest_interaction','intelligence.observe')))::int conflicts,
 not exists(select 1 from feature_flags where tenant_id='${tenant}' and flag in('learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled') and value='true') paused,
 to_regclass('cron.job') is null no_schedules`))[0];
check(pre.interactions===21&&pre.enriched===21&&pre.ingestions===0&&pre.conflicts===0&&pre.paused&&pre.no_schedules,'Bounded sample or idle state differs');
const ids=(await q(`select id from interactions where tenant_id='${tenant}' order by id`)).map(r=>r.id);
const tables=await q("select n.nspname||'.'||c.relname name,exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped) scoped from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in('public','storage','vault') or (n.nspname='auth' and c.relname in('users','identities'))) and c.relkind in('r','p') and not c.relispartition order by 1");
check(tables.length===201&&tables.every(t=>/^(public|storage|vault|auth)\.[a-z][a-z0-9_]*$/.test(t.name)),'Complete dataset inventory required');
const snapshot=(foreign=false)=>tables.map(t=>`select '${t.name}' name,count(*)::int count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) fingerprint from ${t.name} s${foreign&&t.scoped?` where tenant_id is distinct from '${tenant}'::uuid`:''}`).join(' union all ');
const before=await q(snapshot()),foreignBefore=await q(snapshot(true)),oldJobs=await q('select id,md5(to_jsonb(j)::text) fingerprint from platform_jobs j order by id');
const keyResponse=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
check(keyResponse.ok,'Existing TEST key unavailable');const keys=await keyResponse.json(),key=keys.find(k=>k.name==='service_role')?.api_key;
const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));check(claims.ref===TEST_PROJECT&&claims.role==='service_role','TEST key scope differs');
const headers={Authorization:`Bearer ${key}`,apikey:key,'x-serviceos-internal-key':key,'content-type':'application/json'};
const job=randomUUID(),retryJob=randomUUID();
const report={state:'prepared',project:TEST_PROJECT,startedAt:new Date().toISOString(),tenant,job,retryJob,before,foreignBefore,oldJobs,runs:[],providerRequests:0,paidAIRequests:0,newAccounts:0,newGrants:0,productionChanged:false};
const fd=openSync(file,'wx',0o600);try{writeSync(fd,JSON.stringify(report));fsyncSync(fd);}finally{closeSync(fd);}
const save=()=>writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
async function invoke(type,batch){
 report.state='worker_submission_pending';save();
 const r=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,{method:'POST',headers,body:JSON.stringify({job_types:[type],batch_size:batch}),redirect:'error',signal:AbortSignal.timeout(60000)});
 const b=await r.json();report.runs.push({type,status:r.status,claimed:b.claimed,succeeded:b.succeeded,retrying:b.retrying,dead_lettered:b.dead_lettered,unconfirmed:b.unconfirmed});save();
 check(r.status===200&&b.claimed===batch&&b.succeeded===batch&&!b.retrying&&!b.dead_lettered&&!b.unconfirmed,'Worker result requires inspection');
}
async function enqueue(id,suffix){
 report.state='enqueue_pending';save();
 await q(`begin;set local lock_timeout='3s';
 do $$begin if exists(select 1 from platform_jobs where status='running' or(status in('queued','retrying') and job_type in('intelligence.ingest_interaction','intelligence.observe'))) then raise exception 'analysis_busy';end if;end$$;
 insert into platform_jobs(id,tenant_id,job_type,job_key,status,max_attempts,payload) values('${id}','${tenant}','intelligence.ingest_interaction','retained-observation-${suffix}-${job}','queued',1,'${JSON.stringify({interaction_ids:ids})}'::jsonb);commit;`,false);
}
try{
 await enqueue(job,'initial');await invoke('intelligence.ingest_interaction',1);
 const ready=(await q(`select (select count(*) from intelligence_ingestions where tenant_id='${tenant}' and status='enqueued')::int enqueued,(select count(*) from intelligence_ingestions where tenant_id='${tenant}' and status='skipped')::int skipped,(select count(*) from platform_jobs where tenant_id='${tenant}' and job_type='intelligence.observe' and status='queued')::int queued`))[0];
 report.eligibility=ready;save();check(ready.enqueued===17&&ready.skipped===4&&ready.queued===17,'Actual eligibility differs; inspect without processing');
 await invoke('intelligence.observe',17);
 const linked=(await q(`select count(*)::int n from intelligence_ingestions g join intelligence_objects o on o.id=g.observation_id and o.tenant_id=g.tenant_id join decision_log d on d.object_id=o.id and d.tenant_id=o.tenant_id join learn_observation_receipts r on r.job_id=g.observe_job_id and r.tenant_id=g.tenant_id and r.observation_id=o.id where g.tenant_id='${tenant}' and g.status='observed'`))[0];
 check(linked.n===17,'Observation lineage incomplete');
 // Repeat the exact ingestion ids: existing observations must be reused, not republished.
 await enqueue(retryJob,'repeat');await invoke('intelligence.ingest_interaction',1);
 report.state='processed_needs_readback';
}catch(e){report.state='requires_inspection';report.error=e.message?.length<180?e.message:'Unconfirmed run';process.exitCode=1;}
finally{
 const after=await q(snapshot()),foreignAfter=await q(snapshot(true));
 report.foreignAndUnscopedPreserved=JSON.stringify(foreignBefore)===JSON.stringify(foreignAfter);
 report.changedDatasets=after.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(before[i])).map(r=>r.name);
 const allowed=new Set(['public.intelligence_ingestions','public.platform_jobs','public.intelligence_objects','public.decision_log','public.learn_observation_receipts','public.graph_nodes','public.graph_edges','public.object_state_history','public.platform_events','public.system_health_checks']);
 report.onlyExpectedDerivedDataChanged=report.changedDatasets.every(n=>allowed.has(n));
 report.oldJobsPreserved=JSON.stringify(oldJobs)===JSON.stringify(await q(`select id,md5(to_jsonb(j)::text) fingerprint from platform_jobs j where id in (${oldJobs.map(j=>`'${j.id}'`).join(',')||'null'}) order by id`));
 report.readback=(await q(`select (select count(*) from intelligence_ingestions where tenant_id='${tenant}' and status='observed')::int observed,(select count(*) from intelligence_ingestions where tenant_id='${tenant}' and status='skipped')::int skipped,(select count(*) from intelligence_objects where tenant_id='${tenant}' and created_from='intelligence.ingest_interaction')::int objects,(select count(*) from learn_observation_receipts where tenant_id='${tenant}')::int receipts,(select count(*) from graph_nodes where tenant_id='${tenant}')::int graph_nodes,(select count(*) from graph_edges where tenant_id='${tenant}')::int graph_edges,(select count(*) from platform_jobs where status='running' or(status in('queued','retrying') and job_type in('intelligence.ingest_interaction','intelligence.observe')))::int pending,not exists(select 1 from feature_flags where tenant_id='${tenant}' and flag in('learn.inputs.email.enabled','learn.inputs.phone.enabled','learn.inputs.slack.enabled') and value='true') paused,(select result->>'reused' from platform_jobs where id='${retryJob}')::int reused`))[0];
 const r=report.readback;
 if(report.state==='processed_needs_readback'&&report.foreignAndUnscopedPreserved&&report.onlyExpectedDerivedDataChanged&&report.oldJobsPreserved&&r.observed===17&&r.objects===17&&r.receipts===17&&r.skipped===4&&r.pending===0&&r.paused&&r.reused===17)report.state='retained_inputs_to_observations_verified';else process.exitCode=1;
 report.finishedAt=new Date().toISOString();save();const{before:b,foreignBefore:f,oldJobs:o,...safe}=report;console.log(JSON.stringify(safe));
}
