/** Actual TEST Auth/RPC acceptance with retained synthetic evidence, no provider token or fetch. */
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {readSlackCatalog} from './learn-slack-catalog.mjs';
import {installedSlack} from './learn-test-slack-release.mjs';
import {SOURCE_SHA256} from './learn-test-slack-rehearsal.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';
import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';
import {readAcceptanceResponse} from './learn-test-launch-acceptance.mjs';
const q=s=>`'${String(s).replaceAll("'","''")}'`,check=(ok,s)=>{if(!ok)throw Error(s);},base=`https://${TEST_PROJECT}.supabase.co`;
export async function acceptSlack({allowProjectRef,token,fetcher=fetch}){
 const pre=await readSlackCatalog({allowProjectRef,token,fetcher});check(installedSlack(pre),'Exact installed TEST Slack release required');
 check(pre.base.functions.every(f=>['learn-launch-status','work-transition'].includes(f.slug)),'Inspect TEST worker activity before creating queued fixtures');
 async function request(url,headers,method='GET',body){const r=await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});return readAcceptanceResponse(r);}
 const mgmt={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 async function sql(query,readOnly=false){const r=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,mgmt,'POST',{query,...(readOnly?{}:{read_only:false})});check(r.ok,`Synthetic Slack SQL failed (HTTP ${r.status})`);return r.data;}
 const contract=await sql(AUTH_CONTRACT_QUERY,true);check(contract?.length===1&&actionAuthContractMatches(contract[0].contract),'Auth fixture contract differs');
 const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,mgmt);check(keys.ok&&Array.isArray(keys.data),'Existing TEST keys unavailable');
 function keyFor(role){const rows=keys.data.filter(k=>k.name===role);check(rows.length===1,'Unique TEST key required');const key=rows[0].api_key,c=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());check(c.ref===TEST_PROJECT&&c.role===role,'Key target differs');return key;}
 const anon=keyFor('anon'),service=keyFor('service_role'),userHeaders=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})}),admin={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
 const plan={version:'learn-test-slack-fixtures/1',projectRef:TEST_PROJECT,runId:randomUUID(),tenants:[randomUUID(),randomUUID()],connection:randomUUID(),request:randomUUID(),secretRef:randomUUID(),users:[],accessShutdown:false};
 plan.users=[['owner',0],['viewer',0],['owner',1]].map(([role,t],i)=>({id:randomUUID(),role,tenant:plan.tenants[t],email:`learn-slack-${plan.runId}-${i}@example.invalid`}));
 const path=`/private/tmp/serviceos-learn-slack-${plan.runId}.json`,save=()=>writeFileSync(path,JSON.stringify(plan,null,2),{mode:0o600}),sessions=[],checks=[],cleanupErrors=[];save();
 const rpc=(jwt,name,args)=>request(`${base}/rest/v1/rpc/${name}`,userHeaders(jwt),'POST',args);
 let failure=null,retained=null;
 try{
  for(const u of plan.users){const password=randomBytes(32).toString('base64url');const made=await request(`${base}/auth/v1/admin/users`,admin,'POST',{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_slack_run:plan.runId}});check(made.ok&&made.data?.id===u.id,'Synthetic Auth creation failed');const login=await request(`${base}/auth/v1/token?grant_type=password`,userHeaders(),'POST',{email:u.email,password});check(login.ok&&login.data?.user?.id===u.id&&typeof login.data.access_token==='string','Synthetic sign-in failed');sessions.push(login.data.access_token);}
  let seed='begin;';
  for(const [i,t] of plan.tenants.entries())seed+=`insert into tenants(id,slug,display_name,metadata) values(${q(t)},${q('learn-slack-qa-'+plan.runId+'-'+i)},'SYNTHETIC retained Slack QA',jsonb_build_object('learn_slack_run',${q(plan.runId)},'synthetic',true));`;
  for(const u of plan.users)seed+=`update profiles set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=profiles.id and a.raw_app_meta_data->>'learn_slack_run'=${q(plan.runId)});`;
  seed+=`insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values(${q(plan.connection)},${q(plan.tenants[0])},'slack','configured','{"team_id":"TTEST","team_name":"SYNTHETIC NO CREDENTIAL"}',array['bot_token'],jsonb_build_object('bot_token',${q(plan.secretRef)}));commit;`;
  await sql(seed);
  const connection=await request(`${base}/rest/v1/provider_connections?select=id,updated_at&id=eq.${plan.connection}`,userHeaders(sessions[0]));check(connection.ok&&connection.data?.length===1,'Owner could not read synthetic connection metadata');
  const input={p_tenant_id:plan.tenants[0],p_request_id:plan.request,p_connection_id:plan.connection,p_expected_revision:connection.data[0].updated_at,p_channel_id:'CTEST',p_start:'2026-01-01T00:00:00Z',p_end:'2026-01-02T00:00:00Z',p_max_pages:2,p_reason:'Synthetic signed-in Slack setup'};
  const first=await rpc(sessions[0],'learn_slack_start_import',input);check(first.ok&&first.data?.requestId===plan.request&&!first.data.reused,'Owner approval failed');plan.account=first.data.accountId;plan.job=first.data.jobId;save();
  const again=await rpc(sessions[0],'learn_slack_start_import',input);check(again.ok&&again.data?.reused&&again.data.jobId===plan.job,'Retry duplicated approval/job');
  const conflict=await rpc(sessions[0],'learn_slack_start_import',{...input,p_channel_id:'COTHER'});check(conflict.status===409&&conflict.data?.code==='PT409','Business conflict did not return HTTP 409');
  for(const jwt of sessions.slice(1)){const denied=await rpc(jwt,'learn_slack_start_import',{...input,p_request_id:randomUUID()});check(denied.status===403&&denied.data?.code==='42501','Viewer/foreign owner was not denied');}
  checks.push('Real owner setup, idempotent retry, HTTP 409, viewer and foreign-owner denial');
  await sql(`update platform_jobs set status='running' where id=${q(plan.job)} and tenant_id=${q(plan.tenants[0])};`);
  const a=await sql(`select settings->'slack_history' as scope from connector_accounts where id=${q(plan.account)} and tenant_id=${q(plan.tenants[0])}`,true),s=a[0].scope;
  const expected={scopeKey:JSON.stringify([plan.tenants[0],s.teamId,s.channelId,s.oldest,s.latest,s.consentReference]),cursor:null,pages:0,complete:false};
  const payload={p_tenant_id:plan.tenants[0],p_job_id:plan.job,p_account_id:plan.account,p_expected:expected,p_next:{...expected,pages:1,complete:true},p_records:[{tenant_id:plan.tenants[0],channel_id:'CTEST',source_external_id:'TTEST:CTEST:1767225700.000001',provider_timestamp:'1767225700.000001',thread_timestamp:null,text:'SYNTHETIC retained source',provider_payload:{ts:'1767225700.000001',text:'SYNTHETIC retained source'}}]};
  const browserDenied=await rpc(sessions[0],'slack_history_commit_page',payload);check(!browserDenied.ok&&[403,404].includes(browserDenied.status),'Browser could call privileged publication');
  const page=await request(`${base}/rest/v1/rpc/slack_history_commit_page`,admin,'POST',payload);check(page.ok&&page.data===true,'Service publication failed');
  const replay=await request(`${base}/rest/v1/rpc/slack_history_commit_page`,admin,'POST',payload);check(!replay.ok,'Stale checkpoint accepted');
  for(const table of ['slack_messages','slack_message_versions','slack_history_imports']){
   const owner=await request(`${base}/rest/v1/${table}?select=id&tenant_id=eq.${plan.tenants[0]}`,userHeaders(sessions[0]));check(owner.ok&&owner.data?.length===1,'Owner retained source read failed');
   const foreign=await request(`${base}/rest/v1/${table}?select=id&tenant_id=eq.${plan.tenants[0]}`,userHeaders(sessions[2]));check(foreign.ok&&foreign.data?.length===0,'Foreign tenant saw retained Slack evidence');
  }
  checks.push('Actual service RPC atomically stores a source page/version/interaction and checkpoint; browser writer denied, stale cursor refused, foreign reads isolated');
 }catch(e){failure=e.message;}
 finally{
  try{await sql(`begin;update platform_jobs set status='cancelled',cancelled_at=clock_timestamp() where tenant_id=${q(plan.tenants[0])} and payload->>'connector_account_id' in (select id::text from connector_accounts where tenant_id=${q(plan.tenants[0])});update connector_accounts set status='disabled' where tenant_id=${q(plan.tenants[0])};update tenant_connectors set enabled=false,status='disabled' where tenant_id=${q(plan.tenants[0])};update provider_connections set status='revoked',revoked_at=clock_timestamp() where id=${q(plan.connection)} and tenant_id=${q(plan.tenants[0])};commit;`);}catch{cleanupErrors.push('Synthetic queue/connection shutdown requires inspection');}
  for(const u of plan.users){try{
   const found=await request(`${base}/auth/v1/admin/users/${u.id}`,admin);if(found.status===404)continue;check(found.ok&&found.data?.email===u.email&&found.data.app_metadata?.learn_slack_run===plan.runId,'Synthetic identity marker differs');
   await sql(`update profiles set role='viewer' where id=${q(u.id)} and email=${q(u.email)};`);
   const ban=await request(`${base}/auth/v1/admin/users/${u.id}`,admin,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(ban.ok&&Date.parse(ban.data?.banned_until)>Date.now()+86400000,'Synthetic login ban not verified');
  }catch{cleanupErrors.push(`Synthetic actor shutdown requires inspection: ${u.id}`);}}
  try{
   const rows=await sql(`select (select count(*)::int from slack_messages where tenant_id=${q(plan.tenants[0])}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(plan.tenants[0])}) as versions,(select count(*)::int from slack_history_imports where tenant_id=${q(plan.tenants[0])}) as approvals,(select count(*)::int from interactions where tenant_id=${q(plan.tenants[0])} and source_table='slack_messages') as interactions,(select count(*)::int from platform_jobs where tenant_id=${q(plan.tenants[0])} and status in ('queued','running','retrying')) as active_jobs,(select count(*)::int from provider_connections where id=${q(plan.connection)} and (status<>'revoked' or revoked_at is null)) as active_connections`,true);
   retained=rows[0];check(retained.active_jobs===0&&retained.active_connections===0,'Synthetic work remains enabled');if(!failure)check(retained.messages===1&&retained.versions===1&&retained.approvals===1&&retained.interactions===1,'Retained acceptance counts differ');
   if(sessions[0]){const denied=await rpc(sessions[0],'learn_slack_start_import',{p_tenant_id:plan.tenants[0],p_request_id:randomUUID(),p_connection_id:plan.connection,p_expected_revision:new Date().toISOString(),p_channel_id:'CTEST',p_start:'2026-01-01',p_end:'2026-01-02',p_max_pages:1,p_reason:'Revoked fixture check'});check(denied.status===403||denied.status===401,'Old JWT retained approval access');}
  }catch{cleanupErrors.push('Final retained evidence or revocation requires inspection');}
  plan.accessShutdown=cleanupErrors.length===0;plan.retained=retained;save();
 }
 return {version:'learn-test-slack-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,observedAt:new Date().toISOString(),runId:plan.runId,state:!failure&&!cleanupErrors.length?'passed_retained_synthetic_acceptance':'requires_inspection',checks,failure,cleanupErrors,loginsAndApprovalRevoked:plan.accessShutdown,retained,fixtureManifest:path,limitations:['No real Slack token, Vault secret, provider fetch or production change. Synthetic provider metadata explicitly has no credential.','Source publication was supplied directly to the real service RPC; worker/queue deployment, real provider permission and complete ingestion remain pending.','Synthetic actors and evidence retained; queue cancelled, connections disabled, logins banned/passwords rotated and owner roles revoked. Tenant-level source read policy is unchanged; this is not proof of immediate invalidation of all old JWT reads.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{check(process.argv.slice(2).join(' ')==='--retained-synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit retained synthetic TEST acceptance required');const r=await acceptSlack({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed_retained_synthetic_acceptance')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
