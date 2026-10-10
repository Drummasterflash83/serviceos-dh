/** Retained synthetic fixture for the actual recovery UI. No real Slack credentials. */
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {installedPhoneAccess,readPhoneCatalog} from './learn-test-phone-access.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';
import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';
const [mode,path]=process.argv.slice(2),check=(v,s)=>{if(!v)throw Error(s);},q=s=>`'${String(s).replaceAll("'","''")}'`;
check(['create','inspect','verify','retire'].includes(mode)&&/^\/private\/tmp\/serviceos-learn-recovery-browser-[\w-]+\.json$/.test(path??'')&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit TEST recovery browser fixture required');
const token=savedCliToken();check(installedPhoneAccess(await readPhoneCatalog({allowProjectRef:TEST_PROJECT,token})),'Exact installed TEST release 015 and phone endpoints required');
const mgmt={Authorization:`Bearer ${token}`,'Content-Type':'application/json'},base=`https://${TEST_PROJECT}.supabase.co`;
async function request(url,headers,method='GET',body){const r=await fetch(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});check(r.ok,`TEST recovery browser request failed (HTTP ${r.status})`);return r.json();}
const sql=(query,readOnly=false)=>request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,mgmt,'POST',{query,...(readOnly?{}:{read_only:false})});
const auth=await sql(AUTH_CONTRACT_QUERY,true);check(auth.length===1&&actionAuthContractMatches(auth[0].contract),'Auth contract differs');
const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,mgmt);
function keyFor(role){const a=keys.filter(k=>k.name===role);check(a.length===1,'Unique TEST credential required');const key=a[0].api_key,c=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());check(c.ref===TEST_PROJECT&&c.role===role,'Credential target differs');return key;}
const service=keyFor('service_role'),anon=keyFor('anon'),admin={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
const rpc=(headers,name,args)=>request(`${base}/rest/v1/rpc/${name}`,headers,'POST',args);
let plan;const save=()=>writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
if(mode==='create'){
 const active=await sql("select count(*)::int as n from platform_jobs where job_type in ('slack.history_sync','slack.thread_sync') and status in ('queued','running','retrying')",true);check(active[0].n===0,'Existing Slack work requires inspection');
 const password=readFileSync(0,'utf8').trim();check(password.length>=32,'Temporary password required on stdin');
 plan={version:'learn-test-recovery-browser/1',projectRef:TEST_PROJECT,runId:randomUUID(),tenant:randomUUID(),user:randomUUID(),team:'T'+randomUUID().replaceAll('-','').toUpperCase(),connection:randomUUID(),secretRef:randomUUID(),channels:[],retired:false,createdAt:new Date().toISOString()};plan.email=`learn-recovery-browser-${plan.runId}@example.invalid`;
 writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});
 const made=await request(`${base}/auth/v1/admin/users`,admin,'POST',{id:plan.user,email:plan.email,password,email_confirm:true,app_metadata:{learn_recovery_browser:plan.runId}});check(made.id===plan.user,'Synthetic user differs');
 await sql(`begin;insert into tenants(id,slug,display_name,metadata) values(${q(plan.tenant)},${q('learn-recovery-browser-'+plan.runId)},'SYNTHETIC recovery browser',jsonb_build_object('learn_recovery_browser',${q(plan.runId)},'synthetic',true));update profiles set tenant_id=${q(plan.tenant)},role='owner' where id=${q(plan.user)} and email=${q(plan.email)};insert into provider_connections(id,tenant_id,provider,status,non_secret_config,configured_fields,secret_refs) values(${q(plan.connection)},${q(plan.tenant)},'slack','configured',jsonb_build_object('team_id',${q(plan.team)},'team_name','SYNTHETIC NO CREDENTIAL'),array['bot_token'],jsonb_build_object('bot_token',${q(plan.secretRef)}));commit;`);
 const login=await request(`${base}/auth/v1/token?grant_type=password`,{apikey:anon,'Content-Type':'application/json'},'POST',{email:plan.email,password});check(login.user?.id===plan.user,'Fixture sign-in differs');const signed={apikey:anon,Authorization:`Bearer ${login.access_token}`,'Content-Type':'application/json'};
 const revision=(await sql(`select updated_at from provider_connections where id=${q(plan.connection)}`,true))[0].updated_at;
 for(const channel of ['CCONTINUE','CRESTART']){
  const input={p_tenant_id:plan.tenant,p_request_id:randomUUID(),p_connection_id:plan.connection,p_expected_revision:revision,p_channel_id:channel,p_start:'2026-01-01T00:00:00Z',p_end:'2026-01-02T00:00:00Z',p_max_pages:1,p_reason:'Synthetic browser recovery preparation'};
  const item={channel,requestId:input.p_request_id};plan.channels.push(item);save();
  Object.assign(item,await rpc(signed,'learn_slack_start_import',input));save();
  await sql(`update slack_workspace_pacing set next_allowed_at='-infinity',blocked_until='-infinity' where team_id=${q(plan.team)}`);
  const jobs=await rpc(admin,'learn_slack_claim_jobs',{p_worker:randomUUID(),p_batch:1});check(jobs.length===1&&jobs[0].id===item.jobId,'Synthetic job claim differs');const j=jobs[0];
  const s=(await sql(`select settings->'slack_history' as scope from connector_accounts where id=${q(item.accountId)} and tenant_id=${q(plan.tenant)}`,true))[0].scope;
  const cp={scopeKey:JSON.stringify([plan.tenant,s.teamId,s.channelId,s.oldest,s.latest,s.consentReference]),cursor:null,pages:0,complete:false},ts='1767225700.000001',text='SYNTHETIC retained browser recovery message';
  check(await rpc(admin,'slack_history_commit_page',{p_tenant_id:plan.tenant,p_job_id:j.id,p_account_id:item.accountId,p_claimed_by:j.claimed_by,p_attempt_count:j.attempt_count,p_expected:cp,p_next:{...cp,pages:1,cursor:'synthetic-browser-saved-cursor'},p_records:[{tenant_id:plan.tenant,channel_id:channel,source_external_id:`${plan.team}:${channel}:${ts}`,provider_timestamp:ts,thread_timestamp:null,text,provider_payload:{ts,text}}]})===true,'Synthetic source publication failed');
  await rpc(admin,'learn_slack_finish_job',{p_tenant_id:plan.tenant,p_job_id:j.id,p_claimed_by:j.claimed_by,p_attempt_count:j.attempt_count,p_outcome:{success:true}});
 }
 plan.seeded=true;save();
}else{
 plan=JSON.parse(readFileSync(path));check(plan.version==='learn-test-recovery-browser/1'&&plan.projectRef===TEST_PROJECT&&plan.email===`learn-recovery-browser-${plan.runId}@example.invalid`,'Manifest scope differs');
 const actor=await request(`${base}/auth/v1/admin/users/${plan.user}`,admin);check(actor.id===plan.user&&actor.email===plan.email&&actor.app_metadata?.learn_recovery_browser===plan.runId,'Actor marker differs');
 const tenant=await sql(`select id from tenants where id=${q(plan.tenant)} and metadata->>'learn_recovery_browser'=${q(plan.runId)} and metadata->>'synthetic'='true'`,true);check(tenant.length===1,'Synthetic company marker differs');
 if(mode==='retire'){
  await sql(`begin;update platform_jobs set status='cancelled',cancelled_at=clock_timestamp() where tenant_id=${q(plan.tenant)} and status in ('queued','running','retrying');update connector_accounts set status='disabled' where tenant_id=${q(plan.tenant)};update tenant_connectors set enabled=false,status='disabled' where tenant_id=${q(plan.tenant)};update provider_connections set status='revoked',revoked_at=clock_timestamp() where id=${q(plan.connection)} and tenant_id=${q(plan.tenant)};update slack_workspace_pacing set active_job_id=null where team_id=${q(plan.team)} and active_job_id in(select id from platform_jobs where tenant_id=${q(plan.tenant)});update profiles set role='viewer' where id=${q(plan.user)} and tenant_id=${q(plan.tenant)};commit;`);
  const ban=await request(`${base}/auth/v1/admin/users/${plan.user}`,admin,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(Date.parse(ban.banned_until)>Date.now()+86400000,'Login ban unverified');plan.retired=true;plan.retiredAt=new Date().toISOString();save();
 }
}
const rows=await sql(`select a.id as account_id,a.account_key,h.id as approval_id,h.approved_by,h.definition->'recovery'->>'mode' as mode,(h.definition->>'maxPages')::int as page_limit,h.definition->>'reason' as reason,h.definition->>'resumesImportId' as previous_approval,j.status,(a.sync_cursor->>'pages')::int as pages,a.sync_cursor->>'cursor'='synthetic-browser-saved-cursor' as continued_cursor,a.sync_cursor->'cursor'='null'::jsonb as restarted_cursor,h.previous_state->'checkpoint'->>'cursor'='synthetic-browser-saved-cursor' as previous_cursor_retained,extract(epoch from (h.definition->>'start')::timestamptz)=1767225600 and extract(epoch from (h.definition->>'end')::timestamptz)=1767312000 as window_unchanged from connector_accounts a join slack_history_imports h on 'learn-slack-import:'||h.id::text=a.settings->'slack_history'->>'consentReference' join platform_jobs j on j.id=h.job_id where a.tenant_id=${q(plan.tenant)} order by a.account_key`,true);
const retained=(await sql(`select (select count(*)::int from slack_messages where tenant_id=${q(plan.tenant)}) as messages,(select count(*)::int from slack_message_versions where tenant_id=${q(plan.tenant)}) as versions,(select count(*)::int from interactions where tenant_id=${q(plan.tenant)} and source_table='slack_messages') as interactions,(select count(*)::int from slack_history_imports where tenant_id=${q(plan.tenant)}) as approvals,(select count(*)::int from platform_jobs where tenant_id=${q(plan.tenant)} and status in ('queued','running','retrying')) as active_jobs,(select count(*)::int from provider_connections where tenant_id=${q(plan.tenant)} and status<>'revoked') as active_connections,(select count(*)::int from profiles where id=${q(plan.user)} and role in ('owner','admin')) as approving_users`,true))[0];
check(retained.messages===2&&retained.versions===2&&retained.interactions===2,'Retained source evidence differs');
if(mode==='verify'){
 check(rows.length===2&&retained.approvals===4&&retained.active_jobs===2,'Browser approval count differs');
 for(const c of plan.channels){const r=rows.find(r=>r.account_id===c.accountId),continuing=c.channel==='CCONTINUE';check(r&&r.mode===(continuing?'continue':'restart')&&r.page_limit===(continuing?2:3)&&r.previous_approval===c.requestId&&r.previous_cursor_retained&&r.window_unchanged&&r.approved_by===plan.user&&r.status==='queued'&&r.pages===0&&(continuing?r.continued_cursor:r.restarted_cursor),'Reviewed browser recovery differs');}
}
if(plan.retired)check(retained.active_jobs===0&&retained.active_connections===0&&retained.approving_users===0,'Fixture remains active');
console.log(JSON.stringify({version:'learn-test-recovery-browser-observation/1',projectRef:TEST_PROJECT,runId:plan.runId,email:plan.email,tenant:plan.tenant,mode,retired:plan.retired,observedAt:new Date().toISOString(),channels:rows,retained},null,2));
