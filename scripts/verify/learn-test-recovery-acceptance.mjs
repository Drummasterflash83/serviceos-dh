/** Actual TEST Auth/RPC/Edge recovery acceptance. Retain evidence; retire fixture access. */
import {randomUUID,randomBytes} from 'node:crypto';
import {loadSlackHistoryState,resumeSlackHistory} from '../../src/lib/learn-slack-history-recovery.ts';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {readRecoveryCatalog} from './learn-slack-recovery-catalog.mjs';
import {installedRecovery,SOURCE_SHA256} from './learn-test-recovery-release.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';
import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';
import {readAcceptanceResponse} from './learn-test-launch-acceptance.mjs';
const check=(v,s)=>{if(!v)throw Error(s);},q=s=>`'${String(s).replaceAll("'","''")}'`,base=`https://${TEST_PROJECT}.supabase.co`;
export async function acceptRecovery({allowProjectRef,token,fetcher=fetch}){
 const pre=await readRecoveryCatalog({allowProjectRef,token,fetcher});check(installedRecovery(pre),'Exact installed TEST recovery release required');
 async function request(url,headers,method='GET',body){const r=await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});return readAcceptanceResponse(r);}
 const mgmt={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 async function sql(query,readOnly=false){const r=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,mgmt,'POST',{query,...(readOnly?{}:{read_only:false})});check(r.ok,`Synthetic recovery SQL failed (HTTP ${r.status})`);return r.data;}
 const active=await sql("select count(*)::int as n from platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')",true);check(active[0].n===0,'Existing Slack work requires inspection before acceptance');
 const grants=await sql("select not has_table_privilege('authenticated','slack_workspace_pacing','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('anon','slack_workspace_pacing','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') and not has_table_privilege('service_role','slack_workspace_pacing','DELETE,TRUNCATE') as restricted",true);check(grants[0].restricted,'Recovery grants differ');
 const auth=await sql(AUTH_CONTRACT_QUERY,true);check(auth?.length===1&&actionAuthContractMatches(auth[0].contract),'Auth fixture contract differs');
 const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,mgmt);check(keys.ok&&Array.isArray(keys.data),'Existing TEST keys unavailable');
 function keyFor(role){const rows=keys.data.filter(k=>k.name===role);check(rows.length===1,'Unique existing TEST key required');const key=rows[0].api_key,c=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());check(c.ref===TEST_PROJECT&&c.role===role,'Credential target differs');return key;}
 const anon=keyFor('anon'),service=keyFor('service_role'),userHeaders=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})}),admin={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
 const rpc=(headers,name,args)=>request(`${base}/rest/v1/rpc/${name}`,headers,'POST',args);
 const edge=()=>request(`${base}/functions/v1/learn-slack-worker`,{...admin,'x-serviceos-worker-key':service},'POST');
 const idle=await edge();check(idle.ok&&idle.data?.result?.claimed===0,'Empty-queue worker preflight failed');
 const plan={version:'learn-test-recovery-fixtures/1',projectRef:TEST_PROJECT,runId:randomUUID(),tenants:[randomUUID(),randomUUID()],team:'T'+randomUUID().replaceAll('-','').toUpperCase(),connection:randomUUID(),secretRef:randomUUID(),users:[],approvals:[],requests:[],accessShutdown:false};
 plan.users=plan.tenants.map((tenant,i)=>({id:randomUUID(),tenant,email:`learn-recovery-${plan.runId}-${i}@example.invalid`}));
 const path=`/private/tmp/serviceos-learn-recovery-${plan.runId}.json`,save=()=>writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600}),sessions=[],checks=[],cleanupErrors=[];save();
 const tenant=plan.tenants[0],tenantList=plan.tenants.map(q).join(',');let failure=null,retained=null,sourceBefore=null,completionRefusal=null;
 async function sourceSnapshot(){const tables=['email_messages','phone_calls','phone_recordings','phone_transcripts','slack_messages','slack_message_versions','interactions'];return (await sql(tables.map(t=>`select ${q(t)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${t} s where tenant_id not in (${tenantList})`).join(' union all '),true)).sort((a,b)=>a.name.localeCompare(b.name));}
 const client=i=>({rpc:async(name,args)=>{const r=await rpc(userHeaders(sessions[i]),name,args);return {data:r.ok?r.data:null,error:r.ok?null:{code:r.data?.code}};}});
 async function state(){return loadSlackHistoryState(client(0),tenant,plan.account);}
 function approval(review,mode='continue',maxPages=1){const r={tenantId:tenant,accountId:plan.account,requestId:randomUUID(),stateVersion:review.stateVersion,mode,maxPages,reason:'Synthetic reviewed channel recovery'};plan.requests.push(r);save();return r;}
 const args=r=>({p_tenant_id:r.tenantId,p_account_id:r.accountId,p_request_id:r.requestId,p_expected_state_version:r.stateVersion,p_mode:r.mode,p_max_pages:r.maxPages,p_reason:r.reason});
 async function advance(jobId){await sql(`begin;update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity' where team_id=${q(plan.team)};update platform_jobs set available_at='-infinity' where id=${q(jobId)} and tenant_id=${q(tenant)};commit;`);}
 async function checkpoint(){return (await sql(`select sync_cursor,settings->'slack_history' as scope from connector_accounts where id=${q(plan.account)} and tenant_id=${q(tenant)}`,true))[0];}
 async function publish(jobId,records,cursor,complete=false){
  await advance(jobId);const claim=await rpc(admin,'learn_slack_claim_jobs',{p_worker:randomUUID(),p_batch:1});check(claim.ok&&claim.data?.length===1&&claim.data[0].id===jobId,'Fixture recovery claim differs');const j=claim.data[0],a=await checkpoint(),s=a.scope;
  const cp=Object.keys(a.sync_cursor).length?a.sync_cursor:{scopeKey:JSON.stringify([tenant,s.teamId,s.channelId,s.oldest,s.latest,s.consentReference]),cursor:null,pages:0,complete:false};
  const page=await rpc(admin,'slack_history_commit_page',{p_tenant_id:tenant,p_job_id:j.id,p_account_id:plan.account,p_claimed_by:j.claimed_by,p_attempt_count:j.attempt_count,p_expected:cp,p_next:{...cp,pages:cp.pages+1,cursor,complete},p_records:records});check(page.ok&&page.data===true,'Recovered page publication failed');
  const finish=await rpc(admin,'learn_slack_finish_job',{p_tenant_id:tenant,p_job_id:j.id,p_claimed_by:j.claimed_by,p_attempt_count:j.attempt_count,p_outcome:{success:true}});check(finish.ok&&finish.data?.status==='succeeded','Recovered page settlement failed');
 }
 const record=(ts,text)=>({tenant_id:tenant,channel_id:'CRECOVERY',source_external_id:`${plan.team}:CRECOVERY:${ts}`,provider_timestamp:ts,thread_timestamp:null,text,provider_payload:{ts,text}});
 try{
  sourceBefore=await sourceSnapshot();
  for(const u of plan.users){const password=randomBytes(36).toString('base64url');const made=await request(`${base}/auth/v1/admin/users`,admin,'POST',{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_recovery_run:plan.runId}});check(made.ok&&made.data?.id===u.id,'Synthetic Auth creation failed');const login=await request(`${base}/auth/v1/token?grant_type=password`,userHeaders(),'POST',{email:u.email,password});check(login.ok&&login.data?.user?.id===u.id,'Synthetic sign-in failed');sessions.push(login.data.access_token);}
  let seed='begin;';
  for(const [i,t] of plan.tenants.entries())seed+=`insert into tenants(id,slug,display_name,metadata) values(${q(t)},${q('learn-recovery-'+plan.runId+'-'+i)},'SYNTHETIC recovery acceptance',jsonb_build_object('learn_recovery_run',${q(plan.runId)},'synthetic',true));`;
  for(const u of plan.users)seed+=`update profiles set tenant_id=${q(u.tenant)},role='owner' where id=${q(u.id)} and email=${q(u.email)};`;
  seed+=`insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values(${q(plan.connection)},${q(tenant)},'slack','configured',jsonb_build_object('team_id',${q(plan.team)},'team_name','SYNTHETIC NO CREDENTIAL'),array['bot_token'],jsonb_build_object('bot_token',${q(plan.secretRef)}));commit;`;
  await sql(seed);
  const revision=(await sql(`select updated_at from provider_connections where id=${q(plan.connection)}`,true))[0].updated_at;
  const initial=await rpc(userHeaders(sessions[0]),'learn_slack_start_import',{p_tenant_id:tenant,p_request_id:randomUUID(),p_connection_id:plan.connection,p_expected_revision:revision,p_channel_id:'CRECOVERY',p_start:'2026-01-01T00:00:00Z',p_end:'2026-01-02T00:00:00Z',p_max_pages:1,p_reason:'Synthetic bounded channel recovery'});check(initial.ok&&initial.data?.jobId,'Initial owner approval failed');plan.account=initial.data.accountId;plan.approvals.push(initial.data);save();
  const first=record('1767225700.000001','SYNTHETIC retained recovery first page'),second=record('1767225601.000001','SYNTHETIC retained recovery next page');
  await publish(initial.data.jobId,[first],'synthetic-saved-cursor');
  await sql(`begin;update connector_accounts set settings=jsonb_set(settings,'{slack_history,expiresAt}',to_jsonb(clock_timestamp()-interval '1 hour')) where id=${q(plan.account)} and tenant_id=${q(tenant)};update profiles set role='viewer' where id=${q(plan.users[0].id)};commit;`);
  let s=await state();check(s.progress.pagesThisApproval===1&&s.progress.hasCursor&&s.canContinue&&s.latestJob.stopReason==='page_budget_exhausted','Viewer progress differs');
  const privateRead=await rpc(userHeaders(sessions[0]),'learn_slack_history_state',{p_tenant_id:tenant,p_account_id:plan.account});check([401,403,404].includes(privateRead.status),'Private checkpoint helper exposed');
  const rawRead=await rpc(userHeaders(sessions[0]),'learn_slack_history_read',{p_tenant_id:tenant,p_account_id:plan.account});check(!JSON.stringify(rawRead.data).includes('synthetic-saved-cursor')&&!('checkpoint' in rawRead.data)&&!('scope' in rawRead.data),'Reader exposed private checkpoint');
  const denied=await rpc(userHeaders(sessions[0]),'learn_slack_resume_history',args(approval(s)));check(denied.status===403,'Viewer approved recovery');
  for(const headers of [userHeaders(),userHeaders(sessions[1]),admin]){const read=await rpc(headers,'learn_slack_history_read',{p_tenant_id:tenant,p_account_id:plan.account});check([401,403,404].includes(read.status),'Anonymous/foreign/service read exposed channel');}
  await sql(`update profiles set role='owner' where id=${q(plan.users[0].id)}`);
  s=await state();const competing=[approval(s),approval(s)];
  const attempts=await Promise.all(competing.map(r=>rpc(userHeaders(sessions[0]),'learn_slack_resume_history',args(r))));
  check(attempts.filter(r=>r.ok).length===1&&attempts.filter(r=>r.status===409).length===1,'Competing reviews queued more than one job');
  const win=attempts.findIndex(r=>r.ok),continued=attempts[win].data,continuedRequest=competing[win];plan.approvals.push(continued);save();
  const replay=await resumeSlackHistory(client(0),continuedRequest);check(replay.reused&&replay.jobId===continued.jobId,'Exact recovery retry differs');
  const changed=await rpc(userHeaders(sessions[0]),'learn_slack_resume_history',{...args(continuedRequest),p_mode:'restart'});check(changed.status===409,'Changed request ID reused');
  const a=await checkpoint();check(a.sync_cursor.cursor==='synthetic-saved-cursor'&&a.sync_cursor.pages===0&&Date.parse(a.scope.expiresAt)>Date.now()+23*3600000,'Renewed consent or continuation checkpoint differs');
  s=await state();check(s.previousApprovalId===initial.data.requestId&&s.recoveryMode==='continue'&&s.progress.pagesThisApproval===0&&s.active&&!s.canContinue,'Recovery lineage/progress differs');
  const prior=(await sql(`select previous_state,definition from slack_history_imports where id=${q(continued.requestId)}`,true))[0];check(prior.previous_state.checkpoint.cursor==='synthetic-saved-cursor'&&prior.previous_state.checkpoint.pages===1&&prior.definition.resumesImportId===initial.data.requestId,'Prior approval checkpoint not retained');
  checks.push('Actual viewer/company/anonymous/service restrictions and safe reader; expired consent renewed; competing owner requests queue once; exact replay retains receipt and old checkpoint');
  await publish(continued.jobId,[first,second],'synthetic-next-cursor');
  const sources=(await sql(`select (select count(*)::int from slack_messages where tenant_id=${q(tenant)}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(tenant)}) as versions`,true))[0];check(sources.messages===2&&sources.versions===2,'Continuation replay duplicated source/version');
  const restartRequest=approval(await state(),'restart',2),restart=await resumeSlackHistory(client(0),restartRequest);plan.approvals.push(restart);save();
  const reset=await checkpoint();check(reset.sync_cursor.pages===0&&reset.sync_cursor.cursor===null,'Reviewed restart retained old cursor');
  const saved=(await sql(`select previous_state->'checkpoint'->>'cursor' as cursor from slack_history_imports where id=${q(restart.requestId)}`,true))[0];check(saved.cursor==='synthetic-next-cursor','Restart lost old checkpoint');
  await advance(restart.jobId);const worker=await edge(),outcome=worker.data?.result?.outcomes?.[0];check(worker.ok&&worker.data?.result?.claimed===1&&outcome?.job_id===restart.jobId&&outcome.status==='dead_letter','Existing worker could not handle recovery job');
  const stopped=(await sql(`select error_code from platform_jobs where id=${q(restart.jobId)}`,true))[0];check(stopped.error_code==='slack_history_binding_unavailable','Worker missing-credential refusal differs');
  const finalRequest=approval(await state()),final=await resumeSlackHistory(client(0),finalRequest);plan.approvals.push(final);save();
  await publish(final.jobId,[],null,true);s=await state();check(s.progress.complete&&!s.canContinue&&!s.canRestart,'Completed window still recoverable');
  const completeDenied=await rpc(userHeaders(sessions[0]),'learn_slack_resume_history',args(approval(s)));completionRefusal={httpStatus:completeDenied.status,code:completeDenied.data?.code??null};check(!completeDenied.ok&&completeDenied.data?.code==='55000','Completed-window refusal did not return its documented database code');
  const absent=(await sql(`select count(*)::int as n from slack_history_imports where id=${q(plan.requests.at(-1).requestId)}`,true))[0];check(absent.n===0,'Completed window created an approval');
  check((await resumeSlackHistory(client(0),continuedRequest)).reused,'Older exact retry failed after completion');
  checks.push('Continue deduplicates retained sources; reviewed restart preserves checkpoint; existing worker v4 handles recovery and refuses missing credential before Slack; subsequent recovery completes bounded window and completed recovery is refused');
  check(JSON.stringify(await sourceSnapshot())===JSON.stringify(sourceBefore),'Pre-existing communication evidence changed');
  checks.push('Pre-existing TEST email/call/recording/transcript/Slack/version/interaction row counts and fingerprints unchanged');
 }catch(e){failure=e.message;}
 finally{
  try{await sql(`begin;update platform_jobs set status='cancelled',cancelled_at=clock_timestamp() where tenant_id in (${tenantList}) and status in ('queued','running','retrying');update connector_accounts set status='disabled' where tenant_id in (${tenantList});update tenant_connectors set enabled=false,status='disabled' where tenant_id in (${tenantList});update provider_connections set status='revoked',revoked_at=clock_timestamp() where id=${q(plan.connection)} and tenant_id=${q(tenant)};update slack_workspace_pacing set active_job_id=null where team_id=${q(plan.team)} and active_job_id in (select id from platform_jobs where tenant_id in (${tenantList}));commit;`);}catch{cleanupErrors.push('Fixture queue/connection shutdown requires inspection');}
  for(const u of plan.users){try{const found=await request(`${base}/auth/v1/admin/users/${u.id}`,admin);if(found.status===404)continue;check(found.ok&&found.data?.email===u.email&&found.data.app_metadata?.learn_recovery_run===plan.runId,'Fixture actor marker differs');await sql(`update profiles set role='viewer' where id=${q(u.id)} and email=${q(u.email)};`);const ban=await request(`${base}/auth/v1/admin/users/${u.id}`,admin,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(ban.ok&&Date.parse(ban.data?.banned_until)>Date.now()+86400000,'Fixture login ban unverified');}catch{cleanupErrors.push(`Actor shutdown requires inspection: ${u.id}`);}}
  try{
   retained=(await sql(`select (select count(*)::int from slack_messages where tenant_id=${q(tenant)}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(tenant)}) as versions,(select count(*)::int from interactions where tenant_id=${q(tenant)} and source_table='slack_messages') as interactions,(select count(*)::int from slack_history_imports where tenant_id=${q(tenant)}) as approvals,(select count(*)::int from platform_jobs where tenant_id in (${tenantList}) and status in ('queued','running','retrying')) as active_jobs,(select count(*)::int from provider_connections where id=${q(plan.connection)} and (status<>'revoked' or revoked_at is null)) as active_connections,(select count(*)::int from slack_workspace_pacing where team_id=${q(plan.team)} and active_job_id is not null) as active_reservations`,true))[0];
   check(retained.active_jobs===0&&retained.active_connections===0&&retained.active_reservations===0,'Fixture remains active');if(!failure)check(retained.messages===2&&retained.versions===2&&retained.interactions===2&&retained.approvals===4,'Retained evidence differs');
   if(sessions[0]&&plan.requests.length){const denied=await rpc(userHeaders(sessions[0]),'learn_slack_resume_history',args(plan.requests.at(-1)));check([401,403].includes(denied.status),'Old JWT retained approval access');}
  }catch{cleanupErrors.push('Final retained evidence/revocation requires inspection');}
  plan.retained=retained;plan.accessShutdown=cleanupErrors.length===0;save();
 }
 return {version:'learn-test-recovery-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,observedAt:new Date().toISOString(),runId:plan.runId,state:!failure&&!cleanupErrors.length?'passed_retained_synthetic_acceptance':'requires_inspection',checks,completionRefusal,failure,cleanupErrors,loginsAndApprovalRevoked:plan.accessShutdown,retained,fixtureManifest:path,limitations:['Random synthetic TEST companies/workspace, nonexistent credential reference; no real Slack fetch or production change.','Fixture expiry and pacing deadlines explicitly advanced. Hosted concurrency uses independent HTTP requests; controlled blocking was verified separately in isolated SQL.','Worker v4 exercised recovery binding and missing-credential refusal, not live ingestion. Sources and approvals retained; fixture logins banned/passwords rotated, roles revoked and active jobs/connections stopped.','Recovery browser UI, durable client outbox, continuous/multi-window capture and full LEARN V1 remain incomplete.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{check(process.argv.slice(2).join(' ')==='--retained-synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit retained TEST recovery acceptance required');const r=await acceptRecovery({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed_retained_synthetic_acceptance')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
