/** Actual application source readers with retained synthetic TEST evidence. */
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {loadPerformanceEvidence} from '../../src/lib/learn-performance-evidence.ts';
import {readLearnCardDetail} from '../../src/lib/learn-cards.ts';
import {readSourceCatalog} from './learn-card-sources-catalog.mjs';
import {installedSources,SOURCE_SHA} from './learn-test-sources-release.mjs';
import {communicationFixtureSeed} from './learn-test-communications-acceptance.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';
import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';
import {readAcceptanceResponse} from './learn-test-launch-acceptance.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
const q=s=>`'${String(s).replaceAll("'","''")}'`,check=(v,s)=>{if(!v)throw Error(s);},base=`https://${TEST_PROJECT}.supabase.co`;
export const preservationTables=['email_messages','phone_calls','phone_recordings','phone_transcripts','slack_messages','slack_message_versions','interactions','measurements','learn_performance_reviews','learn_performance_corrections'];
export function sourceSnapshotSql(tenants=[]){return preservationTables.map(t=>`select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from public.${t} s ${tenants.length?`where tenant_id not in (${tenants.map(q).join(',')})`:''}`).join(' union all ');}
export function sourceFixturePlan(){
 const plan={version:'learn-test-sources-fixture/1',projectRef:TEST_PROJECT,runId:randomUUID(),companies:[],users:[],accessShutdown:false};
 for(let n=0;n<2;n++)plan.companies.push(Object.fromEntries(['tenant','company','person','card','team','member','job','node','work','email','call','recording','slack','emailInteraction','callInteraction','slackInteraction','deletedInteraction'].map(k=>[k,randomUUID()])));
 plan.users=[0,0,1].map((company,n)=>({id:randomUUID(),tenant:plan.companies[company].tenant,role:n===1?'viewer':'owner',email:`learn-sources-${plan.runId}-${n}@example.invalid`}));return plan;
}
export function sourceFixtureSeed(plan){
 let s=communicationFixtureSeed(plan);check(s.endsWith('commit;'),'Synthetic seed framing differs');s=s.slice(0,-7);
 for(const [n,c]of plan.companies.entries()){
  s+=`update email_messages set snippet=repeat('😀',4100),body_text='PRIVATE BODY',body_html='PRIVATE HTML',sent_at='2026-10-10T00:00:00Z',received_at='2026-10-10T00:01:00Z' where id=${q(c.email)} and tenant_id=${q(c.tenant)};`;
  s+=`update phone_calls set direction='IN',started_at='2026-10-10T00:00:00Z',duration_seconds=${n?0:120},from_number='PRIVATE FROM',to_number='PRIVATE TO',outcome='completed' where id=${q(c.call)} and tenant_id=${q(c.tenant)};`;
  s+=`insert into phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,started_at,duration_seconds,recording_uri,raw_payload) values(${q(c.recording)},${q(c.tenant)},'simwood',${q('synthetic-'+plan.runId+'-'+n)},${q('synthetic-'+plan.runId+'-'+n)},'2026-10-10T00:00:00Z',115,'synthetic://not-requested','{"synthetic":true,"hidden":"not-returned"}'::jsonb);`;
 }return s+'commit;';
}
export async function acceptSources({allowProjectRef,token,fetcher=fetch}){
 check(installedSources(await readSourceCatalog({allowProjectRef,token,fetcher})),'Exact installed TEST source release required');
 const sql=(query,readOnly=false)=>communicationQuery(token,query,{fetcher,readOnly});
 check(actionAuthContractMatches((await sql(AUTH_CONTRACT_QUERY,true))[0]?.contract),'Auth fixture contract differs');
 async function request(url,headers,method='GET',body){return readAcceptanceResponse(await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)}));}
 const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{Authorization:`Bearer ${token}`});check(keys.ok&&Array.isArray(keys.data),'Existing TEST keys unavailable');
 const key=role=>{const rows=keys.data.filter(k=>k.name===role);check(rows.length===1,'Unique TEST credential required');const value=rows[0].api_key,claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));check(claims.ref===TEST_PROJECT&&claims.role===role,'Credential target differs');return value;};
 const anon=key('anon'),service=key('service_role'),headers=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})}),admin={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
 const plan=sourceFixturePlan(),manifest=`/private/tmp/serviceos-learn-sources-${plan.runId}.json`,save=()=>writeFileSync(manifest,JSON.stringify(plan,null,2)+'\n',{mode:0o600});save();
 const tenantIds=plan.companies.map(c=>c.tenant),tenants=tenantIds.map(q).join(','),userIds=plan.users.map(u=>q(u.id)).join(','),sessions=[],clients=[],checks=[],cleanupErrors=[];
 let before=null,after=null,failure=null,retained=null,fixtureBefore=null,fixtureAfter=null;
 const snapshot=async()=> (await sql(sourceSnapshotSql(tenantIds),true)).sort((a,b)=>a.name.localeCompare(b.name));
 const fixtureSnapshot=async()=> (await sql(preservationTables.map(t=>`select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from public.${t} s where tenant_id in (${tenants})`).join(' union all '),true)).sort((a,b)=>a.name.localeCompare(b.name));
 const rpc=(jwt,args)=>request(`${base}/rest/v1/rpc/learn_card_source_read`,headers(jwt),'POST',args);
 try{
  before=await snapshot();plan.sourceBefore=before;save();
  for(const u of plan.users){
   const password=randomBytes(36).toString('base64url');const made=await request(`${base}/auth/v1/admin/users`,admin,'POST',{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_sources_run:plan.runId,learn_communications_run:plan.runId}});check(made.ok&&made.data?.id===u.id,'Synthetic Auth creation failed');
   const login=await request(`${base}/auth/v1/token?grant_type=password`,headers(),'POST',{email:u.email,password});check(login.ok&&login.data?.user?.id===u.id,'Synthetic sign-in failed');sessions.push(login.data.access_token);clients.push(createClient(base,anon,{global:{fetch:fetcher,headers:{Authorization:`Bearer ${login.data.access_token}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}));
  }
  const seed=sourceFixtureSeed(plan);writeFileSync(manifest.replace('.json','.seed.sql'),seed,{mode:0o600});await sql(seed);plan.seeded=true;save();fixtureBefore=await fixtureSnapshot();
  for(const [n,c]of plan.companies.entries()){
   const client=clients[n===0?0:2];
   for(const [table,id]of [['email_messages',c.email],['phone_calls',c.call],['phone_recordings',c.recording],['interactions',c.emailInteraction]]){
    const rows=await loadPerformanceEvidence(client,c.tenant,{table,id}),text=JSON.stringify(rows);check(rows.length>0&&!['PRIVATE','not-returned','synthetic://'].some(v=>text.includes(v)),'Excluded source content exposed');
    if(table==='email_messages')check(rows.find(r=>r.label==='snippet')?.value==='😀'.repeat(4000)+'… [excerpt shortened]','Unicode email excerpt differs');
    if(table==='phone_calls')check(rows.find(r=>r.label==='duration seconds')?.value===String(n?0:120),'Call duration differs');
    if(table==='phone_recordings')check(rows.find(r=>r.label==='duration seconds')?.value==='115','Recording metadata differs');
    if(table==='interactions')check(rows.find(r=>r.label==='body preview')?.value.endsWith('… [excerpt shortened]'),'Interaction shortening marker absent');
   }
   const card=await readLearnCardDetail(client,c.tenant,'customer',c.card);check(card.evidence.length===3&&card.findings.length===1&&!card.gaps.some(g=>g.includes('could not be read')),'Existing customer card reader regressed');
  }
  checks.push('Two ordinary signed-in company owners read email, call, recording metadata and interaction evidence through the actual application helper; Unicode clipping, zero duration and existing linked customer cards passed.');
  const [a,b]=plan.companies,own={p_tenant:a.tenant,p_table:'email_messages',p_id:a.email};
  for(const jwt of [undefined,sessions[1]])check([401,403].includes((await rpc(jwt,own)).status),'Anonymous/viewer source accepted');
  check((await request(`${base}/rest/v1/rpc/learn_card_source_read`,admin,'POST',own)).status===403,'Service source RPC accepted');
  check((await rpc(sessions[2],own)).status===403,'Foreign company scope accepted');
  for(const [table,id]of [['email_messages',a.email],['phone_calls',a.call],['phone_recordings',a.recording]]){
   const foreign=await rpc(sessions[2],{p_tenant:b.tenant,p_table:table,p_id:id});check(foreign.ok&&foreign.data?.record===null,'Foreign source ID exposed');
   check((await request(`${base}/rest/v1/${table}?select=*&tenant_id=eq.${a.tenant}`,headers(sessions[0]))).status===403,'Raw source table opened');
  }
  for(const args of [{...own,p_table:'profiles'},{...own,p_id:null}])check((await rpc(sessions[0],args)).status===400,'Unsupported source accepted');
  for(const role of ['admin','ops','openfolk','viewer']){await sql(`update profiles set role=${q(role)} where id=${q(plan.users[0].id)} and tenant_id=${q(a.tenant)}`);check((await rpc(sessions[0],own)).status===(role==='admin'?200:403),'Same-session source authority differs');}
  let denied=false;try{await loadPerformanceEvidence(clients[0],a.tenant,{table:'email_messages',id:a.email});}catch{denied=true;}check(denied,'Application concealed denied source');
  checks.push('Anonymous/viewer/ops/operator/service and foreign-company scopes were denied. Foreign IDs exposed no row, raw tables stayed closed, unsupported references failed, and same-session demotion reached the actual application helper.');
  fixtureAfter=await fixtureSnapshot();check(JSON.stringify(fixtureBefore)===JSON.stringify(fixtureAfter),'Reading changed synthetic evidence');
 }catch(e){failure=e instanceof Error?e.message:'Source acceptance failed';}
 finally{
  try{after=await snapshot();check(before&&JSON.stringify(before)===JSON.stringify(after),'Existing source/measurement fingerprints differ');}catch{cleanupErrors.push('Pre-existing evidence preservation requires inspection');}
  try{await sql(`begin;update profiles set role='viewer' where id in (${userIds}) and exists(select 1 from auth.users a where a.id=profiles.id and a.raw_app_meta_data->>'learn_sources_run'=${q(plan.runId)});update team_members set effective_to=coalesce(effective_to,clock_timestamp()) where tenant_id in (${tenants});commit;`);}catch{cleanupErrors.push('Synthetic profile/member retirement requires inspection');}
  for(const u of plan.users){try{const found=await request(`${base}/auth/v1/admin/users/${u.id}`,admin);if(found.status===404)continue;check(found.ok&&found.data?.email===u.email&&found.data?.app_metadata?.learn_sources_run===plan.runId,'Fixture identity differs');const banned=await request(`${base}/auth/v1/admin/users/${u.id}`,admin,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(banned.ok&&Date.parse(banned.data?.banned_until)>Date.now()+86400000,'Synthetic ban unverified');}catch{cleanupErrors.push('Synthetic Auth retirement requires inspection: '+u.id);}}
  try{retained=(await sql(`select (select count(*)::int from email_messages where tenant_id in (${tenants})) as emails,(select count(*)::int from phone_calls where tenant_id in (${tenants})) as calls,(select count(*)::int from phone_recordings where tenant_id in (${tenants})) as recording_metadata_rows,(select count(*)::int from slack_messages where tenant_id in (${tenants})) as slack_messages,(select count(*)::int from interactions where tenant_id in (${tenants})) as interactions,(select count(*)::int from auth.users a left join profiles p on p.id=a.id where a.id in (${userIds}) and (a.banned_until is null or a.banned_until<=clock_timestamp()+interval '1 day' or p.role is distinct from 'viewer')) as active_users,(select count(*)::int from team_members where tenant_id in (${tenants}) and (effective_to is null or effective_to>clock_timestamp())) as active_members`,true))[0];check(retained.active_users===0&&retained.active_members===0,'Synthetic access remains active');if(!failure)check(retained.emails===2&&retained.calls===2&&retained.recording_metadata_rows===2&&retained.slack_messages===2&&retained.interactions===8,'Retained fixture scope differs');}catch{cleanupErrors.push('Retention or retired access readback requires inspection');}
  plan.retained=retained;plan.accessShutdown=cleanupErrors.length===0;save();
 }
 return {version:'learn-test-sources-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA,observedAt:new Date().toISOString(),runId:plan.runId,state:failure||cleanupErrors.length?'requires_inspection':'passed',checks,failure,cleanupErrors,retained,preExistingSourcesPreserved:before!==null&&after!==null&&JSON.stringify(before)===JSON.stringify(after),syntheticSourcesPreserved:fixtureBefore!==null&&fixtureAfter!==null&&JSON.stringify(fixtureBefore)===JSON.stringify(fixtureAfter),fixtureManifest:manifest,limitations:['Actual Auth/PostgREST/application reads against retained synthetic TEST sources, not real employee data or live ingestion.','Recording rows contain metadata only; no audio object, provider request, playback or transcript acceptance.','No production changes, paid processing, schedules, employee score or payroll.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--accept --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST source acceptance required');const r=await acceptSources({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
