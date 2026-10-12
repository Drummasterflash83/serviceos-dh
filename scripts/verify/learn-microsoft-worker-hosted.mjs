/** Deployed TEST worker recovers retained Microsoft input while paused. No credentials/provider calls. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {savedCliToken,TEST_PROJECT} from './learn-test-readiness.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {readMicrosoftCatalog,microsoftSnapshot} from './learn-microsoft-catalog.mjs';
import {readMicrosoftMailPage} from '../../supabase/functions/_shared/microsoft_mail_page.ts';
import {edgeInventory} from './learn-test-email-runtime-deploy.mjs';
const prefix='.verification-results/microsoft-worker-hosted-v1';
const id=n=>`ea780220-aaaa-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),account=id(2),mailbox=id(3),binding=id(4),directory=id(5),client=id(6),tokenId=id(7),job=id(10),freshJob=id(11),identityJob=id(20);
const q=s=>"'"+String(s).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const stable=r=>JSON.stringify([...r].sort((a,b)=>a.name.localeCompare(b.name)));
assert.equal(process.argv.slice(2).join(' '),'--run --existing-cli-login');assert.equal(process.env.LEARN_TEST_ALLOW_PROJECT_REF,TEST_PROJECT);
const token=savedCliToken(),sql=(query,readOnly=true)=>communicationQuery(token,query,{readOnly});
const installed=JSON.parse(readFileSync('.verification-results/microsoft-release-apply-result.json'));
assert.equal(installed.state,'installed_microsoft_schema_verified');
const catalog=await readMicrosoftCatalog(token);assert.equal(catalog.fingerprint,installed.afterFingerprint);
const endpoint=(await edgeInventory(token)).find(e=>e.slug==='platform-worker');assert.equal(endpoint.version,20);assert.equal(endpoint.status,'ACTIVE');assert.equal(endpoint.verify_jwt,false);
const idle=(await sql("select count(*)::int as count from platform_jobs where (job_type in('email.microsoft_sync','email.microsoft_discovery','identity.resolve') and status in('queued','retrying','running')) or (status='running' and (lease_expires_at is null or lease_expires_at<clock_timestamp()+interval '3 minutes'))"))[0];assert.equal(idle.count,0);

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
const journal={state:'prepared',projectRef:TEST_PROJECT,tenant,account,job,identityJob,startedAt:new Date().toISOString(),before,schema:catalog.fingerprint,scope:'One synthetic tenant with retained source page and fresh paused job. No credentials, Auth users or grants. At most five worker calls; exact job types; preflight excludes unrelated claim/recovery work. Cleanup cancels jobs and archives fixture.'};
const saveJournal=exclusive=>{const fd=openSync(prefix+'-journal.json',exclusive?'wx':'w',0o600);try{writeSync(fd,JSON.stringify(journal,null,2)+'\n');fsyncSync(fd);}finally{closeSync(fd);}};saveJournal(true);
let requests=0,submitted=false,failure=null;const checks=[];
const scope={tenantId:tenant,accountId:account,mailboxId:mailbox,folderId:'RetainedFolder'};
const initial={contract:'microsoft-message-checkpoint/1',scope,pageSize:25,continuation:null,visitedRequests:[]};
const raw={id:'WorkerRecoveryMessage',changeKey:'WorkerRecoveryVersion',conversationId:'WorkerRecoveryConversation',subject:'Synthetic deployed recovery email',body:{contentType:'text',content:'Synthetic deployed recovery content'},bodyPreview:'Synthetic deployed recovery card',from:{emailAddress:{address:'worker-customer@example.invalid'}},toRecipients:[{emailAddress:{address:'worker-mailbox@example.invalid'}}],ccRecipients:[],sentDateTime:'2026-10-12T02:00:00Z',receivedDateTime:'2026-10-12T02:00:01Z',lastModifiedDateTime:'2026-10-12T02:00:02Z',isDraft:false,hasAttachments:false};
const page=await readMicrosoftMailPage('SYNTHETIC-UNUSED',{...scope,pageSize:25,continuation:null},async()=>Response.json({value:[raw],'@odata.deltaLink':`https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/RetainedFolder/messages/delta?$deltatoken=SYNTHETIC-RECOVERY`}),()=>Date.parse('2026-10-12T02:00:03Z'));
function seedJob(n,folder,status){return `insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,claimed_by,attempt_count,lease_expires_at,available_at) values(${q(n)},${q(tenant)},'microsoft-365','communications.email','email.microsoft_sync',${q('email.microsoft_sync:'+binding+':'+folder)},${q(status)},${j({email_account_id:account,mailbox_id:mailbox,binding_id:binding,kind:'messages',folder_id:folder})},${status==='running'?"'synthetic-source-writer'":'null'},${status==='running'?1:0},${status==='running'?"clock_timestamp()+interval '10 minutes'":'null'},clock_timestamp());`;}
async function worker(types,auth='service_role'){
 assert.ok(++requests<=5);const k=auth==='service_role'?service:auth==='anon'?anon:null;
 const response=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,{method:'POST',headers:{'Content-Type':'application/json',...(k?{apikey:k,Authorization:`Bearer ${k}`}:{}),...(auth==='service_role'?{'x-serviceos-internal-key':service}:{})},body:JSON.stringify({job_types:types,batch_size:2}),redirect:'error',signal:AbortSignal.timeout(45000)});
 const data=await response.json();checks.push({types,auth,status:response.status,claimed:data.claimed??null,succeeded:data.succeeded??null,waiting:data.waiting??null,unconfirmed:data.unconfirmed??null,code:data.error?.code??null});
 return {status:response.status,data};
}
try{
 journal.state='submitted';saveJournal(false);submitted=true;
 await sql(`begin;
 insert into tenants(id,slug,display_name,status,metadata) values(${q(tenant)},'microsoft-worker-v1','Synthetic Microsoft deployed worker acceptance','active','{"microsoft_worker_fixture":true}');
 insert into email_accounts(id,tenant_id,provider,email_address,status,auth_state) values(${q(account)},${q(tenant)},'microsoft_365','worker-mailbox@example.invalid','active','ok');
 insert into learn_microsoft_mailbox_bindings(id,tenant_id,email_account_id,microsoft_tenant_id,mailbox_id,enabled) values(${q(binding)},${q(tenant)},${q(account)},${q(directory)},${q(mailbox)},true);
 ${seedJob(job,'RetainedFolder','running')}
 ${seedJob(freshJob,'FreshPausedFolder','queued')}
 set local role service_role;
 do $$declare s jsonb;begin
 s:=learn_microsoft_journal_open(${q(tenant)},${q(account)},${q(mailbox)},${q(binding)},'messages','RetainedFolder',${j(initial)},${q(job)},'synthetic-source-writer',1);
 perform learn_microsoft_journal_commit(${q(tenant)},(s->>'streamId')::uuid,${q(id(12))},0,${j(initial)},${j(page)},${j({...initial,continuation:page.continuation})},${q(job)},'synthetic-source-writer',1);
 end$$;reset role;
 insert into feature_flags(tenant_id,flag,value) values(${q(tenant)},'learn.inputs.email.enabled','false');
 update email_accounts set auth_state='revoked',status='disabled' where id=${q(account)};
 update learn_microsoft_mailbox_bindings set enabled=false where id=${q(binding)};
 update platform_jobs set status='queued',claimed_by=null,lease_expires_at=null where id=${q(job)};
 commit;`,false);
 for(const role of ['none','anon']){const denied=await worker(['email.microsoft_sync'],role);assert.equal(denied.status,403);assert.equal(denied.data.error?.code,'forbidden');}
 const recovered=await worker(['email.microsoft_sync']);assert.equal(recovered.status,200);assert.equal(recovered.data.claimed,1);assert.equal(recovered.data.succeeded,1);assert.equal(recovered.data.unconfirmed,0);assert.equal(recovered.data.retrying,0);assert.equal(recovered.data.dead_lettered,0);
 const progress=(await sql(`select
 (select count(*)::int from email_messages where tenant_id=${q(tenant)} and body_text='Synthetic deployed recovery content') as messages,
 (select count(*)::int from learn_microsoft_source_pages where tenant_id=${q(tenant)}) as pages,
 exists(select 1 from platform_jobs where id=${q(job)} and status='succeeded' and attempt_count=2 and result->>'mailboxCoverage'='unverified') as recovered,
 exists(select 1 from platform_jobs where id=${q(freshJob)} and status='queued' and attempt_count=0) as fresh_untouched,
 not exists(select 1 from email_oauth_tokens where tenant_id=${q(tenant)}) as no_credentials`))[0];
 assert.deepEqual(progress,{messages:1,pages:1,recovered:true,fresh_untouched:true,no_credentials:true});
 // Only this newly queued identity job may be claimed; preserve all other clients.
 assert.equal((await sql("select count(*)::int as count from platform_jobs where job_type='identity.resolve' and status in('queued','retrying','running')"))[0].count,0);
 await sql(`insert into platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,payload,attempt_count,available_at) values(${q(identityJob)},${q(tenant)},'openfolk-core','core.identity','identity.resolve',${q('identity.resolve:'+tenant)},'queued','{"limit":20}',0,clock_timestamp());`,false);
 const published=await worker(['identity.resolve']);assert.equal(published.status,200);assert.equal(published.data.claimed,1);assert.equal(published.data.succeeded,1);assert.equal(published.data.unconfirmed,0);
 const idle=await worker(['email.microsoft_sync']);assert.equal(idle.status,200);assert.equal(idle.data.claimed,0);assert.equal(idle.data.succeeded,0);
 const evidence=(await sql(`select
 (select count(*)::int from customer_cards where tenant_id=${q(tenant)} and summary='Synthetic deployed recovery card') as cards,
 (select count(*)::int from interactions where tenant_id=${q(tenant)} and processing_status='enriched') as enriched,
 (select count(*)::int from platform_events where tenant_id=${q(tenant)} and status='consumed') as consumed,
 exists(select 1 from platform_jobs where id=${q(freshJob)} and status='queued' and attempt_count=0) as paused_fresh_untouched`))[0];
 assert.deepEqual(evidence,{cards:1,enriched:1,consumed:1,paused_fresh_untouched:true});
}catch(e){failure='Worker acceptance unconfirmed; inspect private diagnostics';writeFileSync(prefix+'-error-private.txt',String(e.stack??e),{flag:'wx',mode:0o600});}
finally{if(submitted){try{
 await sql(`begin;
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
const report={state:ok?'deployed_worker_recovery_to_card_verified':'requires_inspection',observedAt:new Date().toISOString(),projectRef:TEST_PROJECT,workerVersion:20,checks,requests,cleanup,preservedDatasets:preserved?148:null,schemaUnchanged,newAuthUsers:0,newGrants:0,providerRequests:0,productionChanged:false,failure,limitations:['Deployed Edge worker recovered a synthetic retained page without provider credentials while capture was paused, then delivered its card. Does not prove fresh Graph fetch, consent, real-mailbox coverage or signed-in acceptance.','Synthetic source/card evidence retained in an archived fixture company; its binding/account revoked, no credentials, capture paused and successor jobs cancelled.']};
journal.state=report.state;journal.finishedAt=report.observedAt;saveJournal(false);
writeFileSync(prefix+'-result.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));if(!ok)process.exitCode=1;
