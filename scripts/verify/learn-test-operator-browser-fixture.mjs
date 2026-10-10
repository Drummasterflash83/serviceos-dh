/** Temporary reader of retained synthetic Slack evidence. No provider or source mutation. */
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {installedCommunicationContext} from './learn-test-communication-context.mjs';
import {readCommunicationCatalog} from './learn-card-communication-catalog.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';
import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';
const [mode,path]=process.argv.slice(2),check=(v,s)=>{if(!v)throw Error(s);};
check(['create','retire'].includes(mode)&&/^\/private\/tmp\/serviceos-learn-operator-browser-[\w-]+\.json$/.test(path??'')&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit fixed TEST reader fixture required');
const token=savedCliToken();check(installedCommunicationContext(await readCommunicationCatalog({allowProjectRef:TEST_PROJECT,token})),'Verified TEST release 017 and reviewed endpoints required');
const mgmt={Authorization:`Bearer ${token}`,'Content-Type':'application/json'},base=`https://${TEST_PROJECT}.supabase.co`,q=s=>`'${String(s).replaceAll("'","''")}'`;
async function request(url,headers,method='GET',body){const r=await fetch(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});check(r.ok,`TEST reader fixture failed (HTTP ${r.status})`);return r.json();}
const sql=(query,readOnly=false)=>request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,mgmt,'POST',{query,...(readOnly?{}:{read_only:false})});
const contract=await sql(AUTH_CONTRACT_QUERY,true);check(contract.length===1&&actionAuthContractMatches(contract[0].contract),'Auth contract differs');
const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,mgmt),rows=keys.filter(k=>k.name==='service_role');check(rows.length===1,'Unique TEST service key required');
const key=rows[0].api_key,claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());check(claims.ref===TEST_PROJECT&&claims.role==='service_role','Credential target differs');
const admin={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
let plan;
const save=()=>writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
if(mode==='create'){
 const acceptance=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-operator-acceptance-2026-10-10.json',import.meta.url)));
 check(acceptance.projectRef===TEST_PROJECT&&acceptance.state==='passed_retained_synthetic_acceptance'&&acceptance.loginsAndApprovalRevoked,'Retired successful synthetic acceptance required');
 check(acceptance.fixtureManifest===`/private/tmp/serviceos-learn-threads-${acceptance.runId}.json`,'Acceptance manifest path differs');
 const prior=JSON.parse(readFileSync(acceptance.fixtureManifest));check(prior.projectRef===TEST_PROJECT&&prior.runId===acceptance.runId&&prior.accessShutdown,'Prior fixture differs');
 const found=await sql(`select id from tenants where id=${q(prior.tenants[0])} and metadata->>'learn_slack_run'=${q(prior.runId)} and metadata->>'synthetic'='true'`,true);check(found.length===1,'Synthetic company marker differs');
 const password=readFileSync(0,'utf8').trim();check(password.length>=32,'Temporary password required on stdin');
 plan={version:'learn-test-operator-browser/1',projectRef:TEST_PROJECT,runId:randomUUID(),tenant:prior.tenants[0],evidenceRun:prior.runId,account:prior.recoveryAccount,user:randomUUID(),createdAt:new Date().toISOString(),retired:false};
 plan.email=`learn-operator-browser-${plan.runId}@example.invalid`;
 writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
 const made=await request(`${base}/auth/v1/admin/users`,admin,'POST',{id:plan.user,email:plan.email,password,email_confirm:true,app_metadata:{learn_operator_browser:plan.runId}});check(made.id===plan.user,'Synthetic identity differs');
 await sql(`update profiles set tenant_id=${q(plan.tenant)},role='viewer' where id=${q(plan.user)} and email=${q(plan.email)};`);
 save();
}else{
 plan=JSON.parse(readFileSync(path));check(plan.version==='learn-test-operator-browser/1'&&plan.projectRef===TEST_PROJECT&&plan.email===`learn-operator-browser-${plan.runId}@example.invalid`,'Manifest identity differs');
 const user=await request(`${base}/auth/v1/admin/users/${plan.user}`,admin);check(user.id===plan.user&&user.email===plan.email&&user.app_metadata?.learn_operator_browser===plan.runId,'Synthetic actor marker differs');
 const banned=await request(`${base}/auth/v1/admin/users/${plan.user}`,admin,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(Date.parse(banned.banned_until)>Date.now()+86400000,'Ban not verified');
 await sql(`update profiles set role='viewer' where id=${q(plan.user)} and tenant_id=${q(plan.tenant)};`);
 plan.retired=true;plan.retiredAt=new Date().toISOString();save();
}
const state=await sql(`select (select count(*)::int from slack_messages where tenant_id=${q(plan.tenant)}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(plan.tenant)}) as versions,(select count(*)::int from slack_thread_imports where tenant_id=${q(plan.tenant)}) as approvals,(select count(*)::int from platform_jobs where tenant_id=${q(plan.tenant)} and status in ('queued','running','retrying')) as active_jobs,(select count(*)::int from provider_connections where tenant_id=${q(plan.tenant)} and status<>'revoked') as active_connections`,true);
check(state[0].messages===2&&state[0].versions===2&&state[0].approvals===2&&state[0].active_jobs===0&&state[0].active_connections===0,'Retained synthetic fixture differs');
console.log(JSON.stringify({...plan,retained:state[0]},null,2));
