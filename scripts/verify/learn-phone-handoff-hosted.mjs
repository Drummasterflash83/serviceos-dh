/** One hosted synthetic cached-source journey. No login, provider or storage object. */
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {readHandoffCatalog,handoffInstalledSnapshot} from './learn-phone-handoff-catalog.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {edgeInventory} from './learn-test-email-runtime-deploy.mjs';
const prefix='.verification-results/phone-atomic-handoff-hosted';
const check=(v,m)=>{if(!v)throw Error(m);};
const stable=rows=>JSON.stringify([...rows].sort((a,b)=>a.name.localeCompare(b.name)));
let token,tenant,snapshot,before,schema,journaled=false;
const result={projectRef:TEST_PROJECT,state:'unconfirmed',newUsers:0,newAccessGrants:0,productionChanged:false,providerAcceptance:false,checks:[]};
try{
 check(process.argv.slice(2).join(' ')==='--verify --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit TEST verification required');
 const deploy=JSON.parse(readFileSync('.verification-results/phone-handoff-runtime-deploy-result.json'));
 check(deploy.state==='deployed_needs_http_acceptance'&&deploy.endpoints?.[0]?.version===2,'Exact runtime deployment required');
 token=savedCliToken();schema=await readHandoffCatalog(token);
 check(schema.fingerprint==='9780c9f11e60e5219a52088e53a4e6ff','Exact installed schema required');
 const edge=(await edgeInventory(token)).find(x=>x.slug==='phone-process-pipeline');
 check(edge?.version===2&&edge.status==='ACTIVE'&&edge.verify_jwt===true,'Pipeline runtime changed');
 const secretResponse=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/secrets`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 check(secretResponse.ok,'TEST secret names unavailable');const secrets=await secretResponse.json();
 check(Array.isArray(secrets)&&!secrets.some(s=>s.name==='OPENAI_API_KEY'),'Fixture must not have an available TEST OpenAI key');
 tenant=randomUUID();const recording=randomUUID(),transcript=randomUUID(),insight=randomUUID(),call=randomUUID();
 snapshot=handoffInstalledSnapshot(schema.catalog.phone).replace(/from (public\.[a-z_]+) s/g,(_m,n)=>`from ${n} s where to_jsonb(s)->>'tenant_id' is distinct from '${tenant}'${n==='public.tenants'?` and s.id<>'${tenant}'::uuid`:''}`);
 before=await communicationQuery(token,snapshot);check(before.length===115,'Complete preservation baseline required');
 const gate=(await communicationQuery(token,`select (select count(*) from public.platform_jobs where status in('queued','running','retrying'))::int as jobs,(select count(*) from public.tenants where id='${tenant}')::int as existing`))[0];
 check(gate.jobs===0&&gate.existing===0,'Idle TEST queue and new fixture required');
 const journal={projectRef:TEST_PROJECT,tenant,recording,transcript,insight,call,before,startedAt:new Date().toISOString(),schema:schema.fingerprint};
 const fd=openSync(prefix+'-journal.json','wx',0o600);try{writeSync(fd,JSON.stringify(journal,null,2));fsyncSync(fd);}finally{closeSync(fd);}journaled=true;
 const keysResponse=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 check(keysResponse.ok,'Existing TEST key unavailable');const keys=await keysResponse.json(),matches=keys.filter(k=>k.name==='service_role');check(matches.length===1,'Unique TEST service key required');
 const service=matches[0].api_key,claims=JSON.parse(Buffer.from(service.split('.')[1],'base64url'));check(claims.ref===TEST_PROJECT&&claims.role==='service_role','Existing key scope differs');
 const headers={apikey:service,Authorization:`Bearer ${service}`,'x-serviceos-internal-key':service,'x-internal-tenant-id':tenant,'Content-Type':'application/json'};
 const url=`https://${TEST_PROJECT}.supabase.co/functions/v1/phone-process-pipeline`;
 const denied=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000)});check(denied.status===401,'Unsigned request was not denied');result.checks.push({name:'unsigned request denied',status:denied.status});
 // Exactly one insert attempt, with a journal for inspection if its reply is lost.
 await communicationQuery(token,`begin;
 insert into tenants(id,slug,display_name,status,metadata) values('${tenant}','phone-handoff-${tenant}','Synthetic atomic Phone handoff','active','{"synthetic":true,"purpose":"phone-handoff-http"}');
 insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,started_at,from_number,to_number) values('${call}','${tenant}','simwood','synthetic-${call}','IN','2026-10-11T10:00:00Z','+441632960000','+441632960001');
 insert into phone_recordings(id,tenant_id,provider,provider_call_id,provider_recording_id,storage_path,raw_payload) values('${recording}','${tenant}','simwood','synthetic-${call}','synthetic-${recording}','synthetic-no-file/${recording}.wav','{"synthetic":true}');
 insert into phone_transcripts(id,tenant_id,recording_id,status,transcript_text,language,model,source_storage_path,source_sha256) values('${transcript}','${tenant}','${recording}','completed','Synthetic exact cached handoff transcript.','en','synthetic-existing','synthetic-no-file/${recording}.wav',repeat('a',64));
 insert into phone_ai_insights(id,tenant_id,recording_id,transcript_id,summary,source_transcript_sha256,raw_payload) values('${insight}','${tenant}','${recording}','${transcript}','Synthetic exact cached handoff summary.',encode(sha256(convert_to('Synthetic exact cached handoff transcript.','UTF8')),'hex'),'{"synthetic":true}');
 commit;`,{readOnly:false});
 const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({tenant_id:tenant,recording_id:recording}),redirect:'error',signal:AbortSignal.timeout(60000)});
 const data=await response.json();
 result.pipeline={status:response.status,success:data.success===true,downloaded:data.downloaded,transcribed:data.transcribed,analysed:data.analysed,errorCode:data.error?.code??null,interactionReady:data.interaction_ready===true};
 check(response.status===200&&data.success===true&&data.downloaded&&data.transcribed&&data.analysed&&data.transcript_id===transcript&&data.insight_id===insight&&data.interaction_ready===true,'Hosted canonical handoff not confirmed');
 const receipt=data.handoff_receipt;
 check(receipt?.state==='committed'&&receipt.tenantId===tenant&&receipt.recordingId===recording&&receipt.transcriptId===transcript&&receipt.insightId===insight&&receipt.callId===call&&receipt.eventPublished,'Exact hosted receipt required');
 check([receipt.runId,receipt.interactionId,receipt.eventId].every(v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v)),'Invalid receipt identifiers');
 const verified=(await communicationQuery(token,`select
 (select count(*) from phone_sync_runs where tenant_id='${tenant}')::int as runs,
 (select count(*) from phone_sync_runs where tenant_id='${tenant}' and status='success')::int as successful_runs,
 (select count(*) from learn_phone_processing_attempts where tenant_id='${tenant}' and dispatch is not null)::int as provider_dispatches,
 (select count(*) from learn_phone_processing_attempts where tenant_id='${tenant}' and state='succeeded' and dispatch is null)::int as cached_attempts,
 (select count(*) from learn_phone_result_versions where tenant_id='${tenant}')::int as new_versions,
 (select count(*) from interactions where tenant_id='${tenant}' and source_id='${call}' and processing_status='ready')::int as ready_interactions,
 (select count(*) from platform_events where tenant_id='${tenant}' and subject_id='${receipt.interactionId}' and status='pending')::int as pending_events,
 (select count(*) from learn_phone_handoff_receipts where tenant_id='${tenant}')::int as receipts,
 (select receipt from learn_phone_handoff_receipts where tenant_id='${tenant}') as receipt,
 (select metadata->'handoff_receipt' from phone_sync_runs where tenant_id='${tenant}' and id='${receipt.runId}') as run_receipt,
 (select transcript_text='Synthetic exact cached handoff transcript.' from phone_transcripts where id='${transcript}') as transcript_unchanged,
 (select summary='Synthetic exact cached handoff summary.' and call_id='${call}' from phone_ai_insights where id='${insight}') as insight_linked`))[0];
 check(verified.runs===4&&verified.successful_runs===4&&verified.provider_dispatches===0&&verified.cached_attempts===2&&verified.new_versions===0&&verified.ready_interactions===1&&verified.pending_events===1&&verified.receipts===1&&verified.transcript_unchanged&&verified.insight_linked,'Durable handoff state differs');
 check(JSON.stringify(verified.receipt)===JSON.stringify(verified.run_receipt)&&verified.receipt.runId===receipt.runId&&verified.receipt.sourceFingerprint===receipt.sourceFingerprint,'Run and handoff receipt differ');
 result.state='hosted_cached_source_to_ready_event_verified';result.providerRequests=0;result.terminalRuns=4;result.readyInteractions=1;result.pendingEvents=1;result.handoffReceipts=1;
}catch(e){result.state='requires_inspection';result.failure=typeof e?.message==='string'&&e.message.length<220?e.message:'Hosted check unconfirmed';process.exitCode=1;}
finally{
 if(journaled){
  try{
   await communicationQuery(token,`update public.tenants set status='archived' where id='${tenant}' and metadata->>'purpose'='phone-handoff-http'`,{readOnly:false});
   const archived=(await communicationQuery(token,`select status='archived' as archived from public.tenants where id='${tenant}'`))[0]?.archived;
   const after=await communicationQuery(token,snapshot),afterSchema=await readHandoffCatalog(token);
   check(archived===true&&stable(before)===stable(after)&&afterSchema.fingerprint===schema.fingerprint,'Fixture retirement or non-fixture preservation unconfirmed');
   result.fixtureArchived=true;result.preservedNonFixtureDatasets=115;result.schemaUnchanged=true;
  }catch{result.state='requires_inspection';result.retirementOrPreservationUnconfirmed=true;process.exitCode=1;}
 }
 result.observedAt=new Date().toISOString();result.limitations=['Synthetic cached source data and existing internal TEST authority; no real provider, storage-file or signed-in browser acceptance.','Only interaction/event publication is accepted here. Identity resolution and card delivery remain unverified.','Synthetic rows and receipts are retained in an archived fixture tenant.'];
 writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
}
