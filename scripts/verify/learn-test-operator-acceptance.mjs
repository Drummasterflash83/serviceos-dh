/** Reuse retained real Auth/RPC fixtures; check the additive readers with real JWTs. */
import {pathToFileURL} from 'node:url';
import {acceptThreads} from './learn-test-threads-acceptance.mjs';
import {readOperatorCatalog} from './learn-slack-operator-catalog.mjs';
import {installedOperator,SOURCE_SHA256} from './learn-test-operator-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
const check=(v,s)=>{if(!v)throw Error(s);};
export async function inspectOperator({plan,sessions,rpc,request,userHeaders,admin,sql,checks}){
 const tenant=plan.tenants[0],account=plan.recoveryAccount;
 const args={p_tenant_id:tenant,p_account_id:account};
 for(const jwt of sessions.slice(0,2)){
  const accounts=await rpc(jwt,'learn_slack_accounts_read',{p_tenant_id:tenant});
  check(accounts.ok&&accounts.data?.version==='learn-slack-accounts/1'&&accounts.data.accounts.length===2,'Company stored-channel list differs');
  check(accounts.data.accounts.some(a=>a.id===account&&a.channelId==='CRECOVER'),'Retained channel absent');
  const read=await rpc(jwt,'learn_slack_threads_read',args),r=read.data,t=r?.threads?.[0];
  check(read.ok&&r.version==='learn-slack-threads/1'&&r.tenantId===tenant&&r.accountId===account&&r.canImport&&r.coverage==='observed_threads_only'&&r.threads.length===1,'Owner/viewer observed-thread read failed');
  check(t.parentTimestamp==='1767225700.000001'&&t.excerpt==='SYNTHETIC retained worker recovery source'&&t.latestImport.id===plan.threadRequest&&t.latestImport.status==='queued'&&t.latestImport.pages===1&&!t.latestImport.complete,'Latest retained checkpoint/queue status differs');
  const serialized=JSON.stringify(r);check(!serialized.includes(plan.secretRef)&&!serialized.includes('secret_refs')&&!serialized.includes('provider_payload')&&!serialized.includes('claimed_by'),'Reader disclosed infrastructure metadata');
 }
 for(const name of ['learn_slack_accounts_read','learn_slack_threads_read']){
  const input=name==='learn_slack_accounts_read'?{p_tenant_id:tenant}:args;
  const foreign=await rpc(sessions[2],name,input);check(foreign.status===403&&foreign.data.code==='42501','Foreign company read was not denied');
  const anonymous=await rpc(undefined,name,input);check([401,403,404].includes(anonymous.status),'Anonymous reader was not denied');
  const service=await request(`https://${TEST_PROJECT}.supabase.co/rest/v1/rpc/${name}`,admin,'POST',input);check([403,404].includes(service.status),'Infrastructure role unexpectedly had reader execute access');
 }
 const empty=await rpc(sessions[2],'learn_slack_accounts_read',{p_tenant_id:plan.tenants[1]});check(empty.ok&&empty.data.accounts.length===0,'Foreign company listing leaked accounts');
 const wrong=await rpc(sessions[2],'learn_slack_threads_read',{...args,p_tenant_id:plan.tenants[1]});check(wrong.status===403,'Foreign account accepted in own-company request');
 const invalid=await rpc(sessions[0],'learn_slack_threads_read',{...args,p_before_parent:'not-a-timestamp'});check(invalid.status===400&&invalid.data.code==='22023','Invalid cursor did not fail closed');
 const raw=await request(`https://${TEST_PROJECT}.supabase.co/rest/v1/platform_jobs?select=id&tenant_id=eq.${tenant}`,userHeaders(sessions[0]));check(raw.status===403,'Reader release widened raw queue privileges');
 await sql(`update connector_accounts set status='disabled' where id='${account}' and tenant_id='${tenant}';`);
 const disabled=await rpc(sessions[0],'learn_slack_threads_read',args);check(disabled.ok&&!disabled.data.canImport&&disabled.data.threads.length===1&&disabled.data.threads[0].latestImport.pages===1,'Disabled connection lost retained evidence or remained importable');
 checks.push('Actual owner/viewer stored-channel and deduplicated-thread reads, latest queued successor/checkpoint, safe field allowlist, anonymous/service/foreign denial, invalid cursor rejection, raw queue denial and disabled-channel retention');
}
export async function acceptOperator(args){
 const result=await acceptThreads({...args,readCatalog:readOperatorCatalog,isInstalled:installedOperator,inspectOperator});
 return {...result,version:'learn-test-operator-acceptance/1',sourceSha256:SOURCE_SHA256};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 check(process.argv.slice(2).join(' ')==='--retained-synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit retained TEST acceptance required');
 const r=await acceptOperator({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed_retained_synthetic_acceptance')process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}}
