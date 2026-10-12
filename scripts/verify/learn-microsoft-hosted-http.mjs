/** Hosted RPC + actual local handler/ports/readers. Synthetic data; no provider calls or human access. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {readMicrosoftCatalog,microsoftSnapshot} from './learn-microsoft-catalog.mjs';
import {handleMicrosoftCapture} from '../../supabase/functions/_shared/microsoft_capture_handler.ts';
import {runMicrosoftCaptureJob} from '../../supabase/functions/_shared/microsoft_capture_job.ts';
import {createMicrosoftCapturePorts} from '../../supabase/functions/_shared/microsoft_capture_ports.ts';
const prefix='.verification-results/microsoft-hosted-http-v1';
const id=n=>`ea780120-aaaa-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),account=id(2),mailbox=id(3),binding=id(4),directory=id(5),client=id(6),tokenId=id(7),job=id(10),identityJob=id(20);
const q=s=>"'"+String(s).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const stable=r=>JSON.stringify([...r].sort((a,b)=>a.name.localeCompare(b.name)));
assert.equal(process.argv.slice(2).join(' '),'--run --existing-cli-login');assert.equal(process.env.LEARN_TEST_ALLOW_PROJECT_REF,TEST_PROJECT);
const token=savedCliToken(),sql=(query,readOnly=true)=>communicationQuery(token,query,{readOnly});
const installed=JSON.parse(readFileSync('.verification-results/microsoft-release-apply-result.json'));
assert.equal(installed.state,'installed_microsoft_schema_verified');
const catalog=await readMicrosoftCatalog(token);assert.equal(catalog.fingerprint,installed.afterFingerprint);
assert.equal((await sql(`select not exists(select 1 from tenants where id=${q(tenant)}) as absent`))[0].absent,true);
const inventory=await sql(microsoftSnapshot(catalog.catalog.phone));assert.equal(inventory.length,148);
// Preserve the existing special role/membership/bucket queries verbatim. Only
// tenant-scoped table snapshots exclude this newly created synthetic fixture.
const snapshot=microsoftSnapshot(catalog.catalog.phone).split(' union all ').map(part=>
 part.replace(/from ((?:public|auth|vault|storage)\.[a-z_]+) s\s*$/,(_,name)=>
  `from ${name} s where coalesce(to_jsonb(s)->>'tenant_id','')<>${q(tenant)} ${name==='public.tenants'?`and id<>${q(tenant)}`:''}`)
).join(' union all ');
const before=await sql(snapshot);
const keyResponse=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
assert.equal(keyResponse.ok,true);const keys=await keyResponse.json();
const key=role=>{const found=keys.filter(k=>k.name===role);assert.equal(found.length,1);const value=found[0].api_key;const c=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));assert.equal(c.ref,TEST_PROJECT);assert.equal(c.role,role);return value;};
const service=key('service_role'),anon=key('anon');
const journal={state:'prepared',projectRef:TEST_PROJECT,tenant,account,job,identityJob,startedAt:new Date().toISOString(),before,schema:catalog.fingerprint,scope:'One synthetic tenant, no Auth users or grants; at most 60 RPC/storage requests; no Microsoft/other provider network; cleanup pauses, revokes and archives the synthetic fixture.'};
const saveJournal=exclusive=>{const fd=openSync(prefix+'-journal.json',exclusive?'wx':'w',0o600);try{writeSync(fd,JSON.stringify(journal,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};saveJournal(true);
let requests=0,fetches=0,refreshes=0,submitted=false,failure=null;const trace=[],checks=[];
async function rpc(name,args,role='service_role'){
 assert.ok(++requests<=60);assert.match(name,/^(learn_microsoft_|learn_identity_pending$|learn_processing_publish$|learn_processing_settle$)/);
 const credential=role==='service_role'?service:role==='anon'?anon:null;
 const response=await fetch(`https://${TEST_PROJECT}.supabase.co/rest/v1/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(credential?{apikey:credential,Authorization:`Bearer ${credential}`}:{})},body:JSON.stringify(args),redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await response.json();trace.push({name,role,status:response.status});
 return {data:response.ok?data:null,error:response.ok?null:{code:data.code??'http_error'},status:response.status};
}
const db={rpc};
const claim={claimedBy:'microsoft-http-v1',attemptCount:1};
const credentialArgs={p_tenant:tenant,p_account:account,p_mailbox:mailbox,p_binding:binding,p_kind:'messages',p_folder:'HttpFolder',p_job:job,p_worker:claim.claimedBy,p_claim:1,p_client:client};
const raw={id:'HttpMessage',changeKey:'HttpVersion1',conversationId:'HttpConversation',subject:'Synthetic hosted Microsoft email',body:{contentType:'text',content:'Synthetic hosted content for durable card acceptance'},bodyPreview:'Synthetic hosted card preview',from:{emailAddress:{address:'http-customer@example.invalid',name:'Synthetic customer'}},toRecipients:[{emailAddress:{address:'http-mailbox@example.invalid'}}],ccRecipients:[],sentDateTime:'2026-10-12T02:00:00Z',receivedDateTime:'2026-10-12T02:00:01Z',lastModifiedDateTime:'2026-10-12T02:00:02Z',isDraft:false,hasAttachments:false};
const ports=()=>({...createMicrosoftCapturePorts(db,{config:()=>({clientId:client,clientSecret:'SYNTHETIC-CLIENT'}),refresh:async(config,d,r)=>{
 assert.equal(config.clientId,client);assert.equal(d,directory);assert.equal(r,'SYNTHETIC-REFRESH');refreshes++;
 return{accessToken:'SYNTHETIC-FRESH',refreshToken:'SYNTHETIC-ROTATED',expiresIn:3600,scope:'Mail.Read'};
}}),fetcher:async(url,options)=>{
 fetches++;assert.equal(fetches,1);assert.ok(String(url).startsWith(`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/HttpFolder/messages/delta`));
 assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer SYNTHETIC-FRESH');
 return Response.json({value:[raw],'@odata.deltaLink':`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/HttpFolder/messages/delta?$deltatoken=SYNTHETIC-HTTP`});
}});
const context={supabaseAdmin:db,tenantId:tenant,jobId:job,jobType:'email.microsoft_sync',payload:{},claim};
try{
 journal.state='submitted';saveJournal(false);submitted=true;
 await sql(`begin;
 insert into tenants(id,slug,display_name,status,metadata) values(${q(tenant)},'microsoft-http-v1','Synthetic Microsoft HTTP acceptance','active','{"microsoft_http_fixture":true}');
 insert into email_accounts(id,tenant_id,provider,email_address,status,auth_state) values(${q(account)},${q(tenant)},'microsoft_365','http-mailbox@example.invalid','active','ok');
 insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(binding)},${q(tenant)},${q(account)},${q(directory)},${q(mailbox)},true);
 insert into email_oauth_tokens(id,tenant_id,email_account_id,provider,access_token,refresh_token,expires_at,scope,token_type,raw_payload) values(${q(tokenId)},${q(tenant)},${q(account)},'microsoft_365','SYNTHETIC-OLD','SYNTHETIC-REFRESH',clock_timestamp()-interval '1 second','Mail.Read','Bearer',${j({learnMicrosoft:{contract:'microsoft-delegated-credential/1',microsoftTenantId:directory,mailboxId:mailbox,bindingId:binding,clientId:client}})});
 insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at) values(${q(job)},${q(tenant)},'microsoft-365','communications.email','email.microsoft_sync',${q('email.microsoft_sync:'+binding+':HttpFolder')},'running',${j({email_account_id:account,mailbox_id:mailbox,binding_id:binding,kind:'messages',folder_id:'HttpFolder'})},${q(claim.claimedBy)},1,clock_timestamp()+interval '10 minutes');
 commit;`,false);
 for(const role of ['anon','none']){const r=await rpc('learn_microsoft_credential_read',credentialArgs,role);assert.ok([401,403].includes(r.status));}
 const foreign=await rpc('learn_microsoft_credential_read',{...credentialArgs,p_client:id(99)});assert.equal(foreign.status,409);checks.push('unsigned_anonymous_and_foreign_application_denied');
 const completed=await handleMicrosoftCapture(context,{run:runMicrosoftCaptureJob,ports});
 assert.equal(completed.success,true);assert.equal(completed.queueOutcome?.state,'completed');assert.equal(completed.recordsProcessed,1);assert.equal(completed.result?.coverage_complete,false);assert.equal(refreshes,1);assert.equal(fetches,1);
 const repeated=await handleMicrosoftCapture(context,{run:runMicrosoftCaptureJob,ports});assert.deepEqual(repeated,completed);assert.equal(fetches,1);assert.equal(refreshes,1);checks.push('actual_handler_refresh_storage_settlement_and_replay');
 await sql(`insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at) values(${q(identityJob)},${q(tenant)},'openfolk-core','core.identity','identity.resolve',${q('identity.resolve:'+tenant)},'running','{"limit":20}','microsoft-http-identity',1,clock_timestamp()+interval '10 minutes');`,false);
 const pending=await rpc('learn_identity_pending',{p_tenant:tenant,p_limit:20});assert.equal(pending.error,null);assert.equal(pending.data.length,1);const selected=pending.data[0];
 const publish={p_tenant:tenant,p_job:identityJob,p_worker:'microsoft-http-identity',p_attempt:1,p_request:id(21),p_source:'identity',p_source_id:selected.interaction_id,p_revision:selected.source_revision,p_phase:'publish'};
 const published=await rpc('learn_processing_publish',publish);assert.equal(published.error,null);assert.equal(published.data.state,'committed');assert.equal(published.data.cardEnriched,true);
 const replay=await rpc('learn_processing_publish',{...publish,p_phase:'inspect'});assert.deepEqual(replay.data,published.data);
 const settled=await rpc('learn_processing_settle',{p_tenant:tenant,p_job:identityJob,p_worker:'microsoft-http-identity',p_attempt:1,p_request:id(22),p_definition:{success:true,records_processed:1,result:{resolved:1,cards_enriched:1,events_consumed:1,review_required:0,failed:0},continue:false,retryable:false,error_code:null},p_phase:'settle'});
 assert.equal(settled.error,null);assert.equal(settled.data.state,'succeeded');checks.push('hosted_identity_publication_creates_card_once');
 const evidence=(await sql(`select
 (select count(*)::int from email_messages where tenant_id=${q(tenant)} and body_text='Synthetic hosted content for durable card acceptance') as messages,
 (select count(*)::int from customer_cards where tenant_id=${q(tenant)} and summary='Synthetic hosted card preview') as cards,
 (select count(*)::int from interactions where tenant_id=${q(tenant)} and processing_status='enriched') as enriched,
 (select count(*)::int from platform_events where tenant_id=${q(tenant)} and status='consumed') as consumed,
 (select count(*)::int from learn_microsoft_source_pages where tenant_id=${q(tenant)}) as source_pages,
 (select bool_and(access_token='SYNTHETIC-FRESH' and refresh_token='SYNTHETIC-ROTATED') from email_oauth_tokens where id=${q(tokenId)}) as rotated`))[0];
 assert.deepEqual(evidence,{messages:1,cards:1,enriched:1,consumed:1,source_pages:1,rotated:true});checks.push('durable_source_email_interaction_card_relationship_confirmed');
}catch(e){failure='Hosted acceptance failed; inspect private diagnostics';writeFileSync(prefix+'-error-private.txt',String(e.stack??e),{flag:'wx',mode:0o600});}
finally{if(submitted){try{
 await sql(`begin;
 insert into feature_flags(tenant_id,flag,value) select ${q(tenant)},'learn.inputs.email.enabled','false' where exists(select 1 from tenants where id=${q(tenant)}) on conflict(coalesce(tenant_id,'00000000-0000-0000-0000-000000000000'::uuid),flag) do update set value='false';
 update learn_microsoft_mailbox_bindings set enabled=false where id=${q(binding)} and tenant_id=${q(tenant)};
 update email_accounts set status='disabled',auth_state='revoked' where id=${q(account)} and tenant_id=${q(tenant)};
 delete from email_oauth_tokens where id=${q(tokenId)} and tenant_id=${q(tenant)};
 update platform_jobs set status='cancelled',cancelled_at=clock_timestamp(),claimed_by=null,lease_expires_at=null where tenant_id=${q(tenant)} and status in('queued','retrying','running');
 update tenants set status='archived' where id=${q(tenant)};commit;`,false);
 }catch(e){failure='Cleanup unconfirmed; inspect private diagnostics';writeFileSync(prefix+'-cleanup-error-private.txt',String(e.message),{flag:'wx',mode:0o600});}}}
const after=await sql(snapshot),afterCatalog=await readMicrosoftCatalog(token);
const cleanup=(await sql(`select exists(select 1 from tenants where id=${q(tenant)} and status='archived') as archived,
 not exists(select 1 from email_accounts where tenant_id=${q(tenant)} and (status<>'disabled' or auth_state<>'revoked')) as accounts_revoked,
 not exists(select 1 from learn_microsoft_mailbox_bindings where tenant_id=${q(tenant)} and enabled) as bindings_disabled,
 not exists(select 1 from platform_jobs where tenant_id=${q(tenant)} and status in('queued','retrying','running')) as no_active_jobs,
 not exists(select 1 from email_oauth_tokens where tenant_id=${q(tenant)}) as no_credentials,
 not exists(select 1 from profiles where tenant_id=${q(tenant)}) as no_human_access,
 exists(select 1 from feature_flags where tenant_id=${q(tenant)} and flag='learn.inputs.email.enabled' and value='false') as capture_paused`))[0];
const preserved=stable(before)===stable(after),schemaUnchanged=afterCatalog.fingerprint===catalog.fingerprint;
const ok=!failure&&preserved&&schemaUnchanged&&Object.values(cleanup).every(v=>v===true);
const report={state:ok?'hosted_rpc_source_to_card_verified':'requires_inspection',observedAt:new Date().toISOString(),projectRef:TEST_PROJECT,checks,trace,requests,syntheticFetches:fetches,syntheticRefreshes:refreshes,cleanup,preservedDatasets:preserved?148:null,schemaUnchanged,newAuthUsers:0,newGrants:0,providerRequests:0,productionChanged:false,failure,limitations:['Actual handler/ports/readers ran locally against hosted RPCs with synthetic provider responses. No deployed Edge worker, Microsoft network, real credentials, real mailbox or signed-in acceptance.','Synthetic source/card evidence retained in an archived fixture company; its binding/account revoked, credential deleted and successor jobs cancelled.']};
journal.state=report.state;journal.finishedAt=report.observedAt;saveJournal(false);
writeFileSync(prefix+'-result.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));if(!ok)process.exitCode=1;
