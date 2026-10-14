/** Read only exact selected LIVE interactions and their durable queue lineage. */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {savedCliToken} from './learn-test-readiness.mjs';
const root=resolve(process.argv[2]??'');
if(process.argv.length!==3||!root.startsWith(resolve('.verification-results')+'/'))throw Error('Private release journal required');
const journal=JSON.parse(readFileSync(join(root,'journal.json')));
if(journal.project!=='tgbnakbxwcqjeimygroz'||!Array.isArray(journal.selectedInteractions)||
 journal.selectedInteractions.length>25||journal.selectedInteractions.some(x=>! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x.interaction_id)))
 throw Error('Exact bounded LIVE selection required');
const tenant='00000000-0000-0000-0000-000000000001',token=savedCliToken();
const ids=journal.selectedInteractions.map(x=>`'${x.interaction_id}'::uuid`).join(',');
if(!ids)throw Error('No retained selection to follow');
const query=`select i.id,i.source_connector_id,i.processing_status,i.direction,i.related_person_id,i.related_company_id,i.related_job_id,
 md5(coalesce(i.body_preview,'')) body_fingerprint,i.metadata->>'source_version' source_version,
 g.status ingestion_status,g.observe_job_id,j.status observe_job_status,j.error_code,j.attempt_count,
 r.observation_id,r.receipt->>'state' receipt_state,r.receipt->'can_execute' can_execute,
 r.receipt->'action_ids' action_ids,o.attributes->'retained_source_context' retained_source_context
 from public.interactions i left join public.intelligence_ingestions g
 on g.tenant_id=i.tenant_id and g.interaction_id=i.id and g.mapper_version='obs-ingest/2'
 left join public.platform_jobs j on j.tenant_id=i.tenant_id and j.id=g.observe_job_id
 left join public.learn_observation_receipts r on r.tenant_id=i.tenant_id and r.job_id=j.id
 left join public.intelligence_objects o on o.tenant_id=i.tenant_id and o.id=r.observation_id
 where i.tenant_id='${tenant}'::uuid and i.id in(${ids}) order by i.id`;
const response=await fetch(`https://api.supabase.com/v1/projects/${journal.project}/database/query/read-only`,{
 method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
 body:JSON.stringify({query}),redirect:'error',signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Lineage read HTTP '+response.status+'; raw response withheld');
const rows=await response.json();
if(!Array.isArray(rows)||rows.length!==journal.selectedInteractions.length)throw Error('Selected source coverage changed');
const slack=rows.filter(x=>x.source_connector_id==='slack');
const committed=slack.filter(x=>x.receipt_state==='committed'&&x.observe_job_status==='succeeded'&&
 x.ingestion_status==='observed'&&x.can_execute===false&&Array.isArray(x.action_ids)&&x.action_ids.length===0&&
 x.retained_source_context?.scope==='company_source'&&x.retained_source_context?.attribution==='unresolved'&&
 x.processing_status==='identity_review'&&x.direction==='unknown'&&x.related_person_id===null&&
 x.related_company_id===null&&x.related_job_id===null);
const states=Object.fromEntries([...new Set(slack.map(x=>x.observe_job_status??x.ingestion_status??'not_dispatched'))]
 .map(k=>[k,slack.filter(x=>(x.observe_job_status??x.ingestion_status??'not_dispatched')===k).length]));
const report={observedAt:new Date().toISOString(),state:committed.length?'retained_public_source_observation_verified':'awaiting_normal_queue',
 selectedSlack:slack.length,committedSourceOnly:committed.length,states,providerCalls:0,productionChanged:false,rows};
writeFileSync(join(root,'observation-monitor-'+Date.now()+'.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({observedAt:report.observedAt,state:report.state,selectedSlack:slack.length,
 committedSourceOnly:committed.length,states,providerCalls:0,productionChanged:false}));
