/** TEST-only HTTP acceptance using retained synthetic results in an archived tenant.
 * No users, access grants, storage files, provider credentials or capture activation.
 * An archived tenant prevents new provider work if retained-result reuse fails. */
import { readFileSync, openSync, writeSync, fsyncSync, closeSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { TEST_PROJECT, savedCliToken } from './learn-test-readiness.mjs';
import { readPhoneProcessingCatalog, phoneProcessingSourceQuery, PHONE_PROCESSING_TABLES } from './learn-phone-processing-catalog.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';
import { PHONE_PROCESSING_SCHEMA } from './learn-phone-processing-runtime-deploy.mjs';
const check=(v,m)=>{if(!v)throw Error(m);};
const ordered=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
const prefix='.verification-results/phone-processing-http-v2';
let result={state:'unconfirmed',projectRef:TEST_PROJECT,checks:[],providerAcceptance:false};
try {
 check(process.argv.slice(2).join(' ')==='--verify --existing-cli-login' && process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit TEST verification required');
 const deployment=JSON.parse(readFileSync('.verification-results/phone-processing-runtime-deploy-result.json'));
 check(deployment.state==='deployed_needs_http_acceptance'&&deployment.phoneProcessingSchema===PHONE_PROCESSING_SCHEMA,'Exact deployed runtime required');
 const token=savedCliToken(),tenant=randomUUID(),recording=randomUUID(),transcript=randomUUID(),insight=randomUUID();
 const schema=await readPhoneProcessingCatalog(token);check(schema.fingerprint===PHONE_PROCESSING_SCHEMA,'Schema differs');
 const newTables=PHONE_PROCESSING_TABLES.slice(3).map(n=>'public.'+n);
 const snapshot=(phoneProcessingSourceQuery(schema.catalog.phone)+' union all '+newTables.map(n=>`select '${n}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${n} s`).join(' union all '))
  .replace(/from (public\.[a-z_]+) s/g,(_m,n)=>`from ${n} s where to_jsonb(s)->>'tenant_id' is distinct from '${tenant}'${n==='public.tenants'?` and s.id<>'${tenant}'::uuid`:''}`);
 const before=await communicationQuery(token,snapshot);check(before.length===108,'Full source snapshot required');
 const gate=(await communicationQuery(token,`select (select count(*) from public.platform_jobs where status in ('queued','running','retrying'))::int as jobs,(select count(*) from public.tenants where id='${tenant}')::int as existing`))[0];
 check(gate.jobs===0&&gate.existing===0,'Idle queue and new fixture required');
 const journal={version:'learn-phone-processing-http/1',projectRef:TEST_PROJECT,tenant,recording,transcript,insight,observedAt:new Date().toISOString(),before};
 const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}
 const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 check(keysResponse.ok,'TEST keys unavailable');const keys=await keysResponse.json();
 const keyFor=role=>{const values=keys.filter(k=>k.name===role);check(values.length===1,'Unique key required');const key=values[0].api_key;const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url'));check(claims.ref===TEST_PROJECT&&claims.role===role,'Key scope differs');return key;};
 const service=keyFor('service_role'),anon=keyFor('anon');
 const headers={apikey:service,Authorization:`Bearer ${service}`,'x-serviceos-internal-key':service,'x-internal-tenant-id':tenant};
 const request=async(endpoint,body,h=headers,method='POST')=>{
  const r=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/${endpoint}`,{method,headers:{...h,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(60000)});
  const data=await r.json();return {status:r.status,data};
 };
 const targets=['simwood-download-recording','phone-transcribe-recording','phone-analyse-transcript','phone-process-pipeline'];
 for(const endpoint of targets){
  const body={tenant_id:tenant,recording_id:recording,transcript_id:transcript};
  for(const [name,h,status,method] of [['missing authority',{},401,'POST'],['anonymous denied',{apikey:anon,Authorization:`Bearer ${anon}`},401,'POST'],['wrong method',{apikey:anon,Authorization:`Bearer ${anon}`},405,'GET'],['tenant mismatch',{...headers,'x-internal-tenant-id':randomUUID()},403,'POST']]){
   const r=await request(endpoint,body,h,method);check(r.status===status,`${endpoint}: ${name} returned ${r.status}`);
   result.checks.push({endpoint,name,status:r.status,passed:true});
  }
 }
 // One bounded fixture transaction. Any unknown acknowledgement is inspected, never resent.
 await communicationQuery(token,`begin;
 insert into public.tenants(id,slug,display_name,status,metadata) values('${tenant}','phone-http-${tenant}','Synthetic retained Phone HTTP check','archived','{"synthetic":true,"purpose":"phone-processing-http"}');
 insert into public.phone_recordings(id,tenant_id,provider,provider_recording_id,storage_path,raw_payload) values('${recording}','${tenant}','simwood','synthetic-retained-${recording}','synthetic-no-file/${recording}.wav','{"synthetic":true}');
 insert into public.phone_transcripts(id,tenant_id,recording_id,status,transcript_text,language,model) values('${transcript}','${tenant}','${recording}','completed','Synthetic retained transcript. No customer communication.','en','synthetic-existing');
 insert into public.phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary,raw_payload) values('${insight}','${tenant}','${recording}','${transcript}','Synthetic retained summary.','{"synthetic":true}');
 commit;`,{readOnly:false});
 const cached=await request('phone-process-pipeline',{tenant_id:tenant,recording_id:recording});
 result.pipeline={status:cached.status,success:cached.data.success===true,downloaded:cached.data.downloaded,transcribed:cached.data.transcribed,analysed:cached.data.analysed,errorCode:cached.data.error?.code??null,interactionReady:cached.data.interaction_ready===true};
 check(cached.status===200&&cached.data.success===true&&cached.data.transcript_id===transcript&&cached.data.insight_id===insight&&cached.data.downloaded&&cached.data.transcribed&&cached.data.analysed,'Retained pipeline did not complete');
 const runs=await communicationQuery(token,`select id,provider,sync_type,status,records_processed,metadata->>'already_processed' as cached from public.phone_sync_runs where tenant_id='${tenant}' order by sync_type`);
 check(runs.length===4&&runs.every(r=>r.status==='success'),'Four terminal child/parent runs required');
 const children=runs.filter(r=>r.provider==='openai');check(children.length===2&&children.every(r=>r.cached==='true'&&r.records_processed===0),'Cached OpenAI stages required');
 for(const run of children){
  const endpoint=run.sync_type==='transcription'?'phone-transcribe-recording':'phone-analyse-transcript';
  const r=await request(endpoint,{tenant_id:tenant,recording_id:recording,transcript_id:transcript,resume_run_id:run.id});
  check(r.status===200&&r.data.success===true,'Receipt reconciliation failed');
  result.checks.push({endpoint,name:'exact cached receipt reconciliation',status:r.status,passed:true});
 }
 const paused=await request('phone-process-pipeline',{tenant_id:tenant,recording_id:recording,force:true});
 check(paused.status===409&&paused.data.error?.code==='learn_capture_paused','Archived tenant admitted new processing');
 result.checks.push({endpoint:'phone-process-pipeline',name:'archived tenant refuses forced work',status:paused.status,passed:true});
 const saved=(await communicationQuery(token,`select
 (select count(*)::int from public.phone_sync_runs where tenant_id='${tenant}') as runs,
 (select count(*)::int from public.learn_phone_processing_attempts where tenant_id='${tenant}' and state='succeeded' and dispatch is null) as cached_attempts,
 (select count(*)::int from public.learn_phone_result_versions where tenant_id='${tenant}') as new_versions,
 (select status='archived' from public.tenants where id='${tenant}') as archived,
 (select transcript_text='Synthetic retained transcript. No customer communication.' from public.phone_transcripts where id='${transcript}') as transcript_preserved,
 (select summary='Synthetic retained summary.' from public.phone_ai_insights where id='${insight}') as insight_preserved`))[0];
 check(saved.runs===4&&saved.cached_attempts===2&&saved.new_versions===0&&saved.archived&&saved.transcript_preserved&&saved.insight_preserved,'Durable fixture results differ');
 const after=await communicationQuery(token,snapshot),afterSchema=await readPhoneProcessingCatalog(token);
 check(ordered(before)===ordered(after)&&afterSchema.fingerprint===schema.fingerprint,'Non-fixture retained data or schema changed');
 result={...result,state:'synthetic_retained_pipeline_verified',observedAt:new Date().toISOString(),schemaFingerprint:schema.fingerprint,preservedDataSets:108,cachedAttempts:2,terminalRuns:4,newProviderDispatches:0,providerAcceptance:false,fixtureArchived:true,newUsers:0,newAccessGrants:0};
 writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));
}catch(error){
 result={...result,state:'requires_inspection',observedAt:new Date().toISOString(),failure:typeof error?.message==='string'&&error.message.length<250?error.message:'HTTP acceptance unconfirmed'};
 writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));process.exitCode=1;
}
