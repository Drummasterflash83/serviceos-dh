/** Real TEST JWT acceptance with deliberately retained, marked synthetic evidence.
 * Synthetic logins are banned and roles revoked; reviewer identities and evidence remain.
 * Existing keys stay in process memory. No messages, audio or provider calls. */
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readMeasurementsCatalog as readRulesCatalog } from './learn-measurements-catalog.mjs';
import { createClient } from '@supabase/supabase-js';
import { loadPerformanceMeasurements } from '../../src/lib/learn-performance-measurements.ts';
import { installedMeasurements as installedRules } from './learn-test-measurements-release.mjs';
import { SOURCE_SHA256 } from './learn-test-measurements-rehearsal.mjs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
import { AUTH_CONTRACT_QUERY } from './learn-test-auth-contract.mjs';
import { readAcceptanceResponse } from './learn-test-launch-acceptance.mjs';
const ORIGIN=`https://${TEST_PROJECT}.supabase.co`,q=s=>`'${String(s).replaceAll("'","''")}'`;
const check=(ok,label)=>{if(!ok)throw Error(label);};
const canonical=v=>Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const expectedAuth=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json',import.meta.url)));
export function measurementFixturePlan(){
 const runId=randomUUID(),tenants=['A','B'].map(label=>({label,id:randomUUID(),team:randomUUID(),member:randomUUID(),preview:randomUUID(),publications:[randomUUID(),randomUUID()]}));
 const users=[['owner',0],['admin',0],['viewer',0],['owner',1]].map(([role,index],i)=>({id:randomUUID(),tenant:tenants[index].id,role,email:`learn-measurements-${runId}-${i}@example.invalid`}));
 return {version:'learn-test-measurements-fixtures/1',projectRef:TEST_PROJECT,runId,retention:'Retain marked synthetic companies, staff, rules, measurements, reviews and reviewer identities; ban synthetic Auth logins and revoke their profile roles.',tenants,users,policies:{}};
}
export function measurementDefinition(scaleMax=50){return {name:`SYNTHETIC ${scaleMax}-point criteria`,subjectKind:'member',groupId:null,scaleMax,metrics:[{key:'response.minutes',label:'Synthetic response minutes',unit:'minutes',weight:1,zeroAt:60,fullAt:0,minSamples:1,minCoverage:1,maxAgeHours:24,sourceSystems:['synthetic.communications']}]};}
export function measurementSeedSql(plan){
 let sql="begin;set local statement_timeout='15s';";
 for(const t of plan.tenants){
  sql+=`insert into public.tenants(id,slug,display_name,metadata) values(${q(t.id)},${q('learn-measurements-qa-'+plan.runId+'-'+t.label)},'SYNTHETIC RETAINED scorecard acceptance',jsonb_build_object('learn_measurements_acceptance_run',${q(plan.runId)},'synthetic',true,'purpose','retained_test_evidence'));`;
  sql+=`insert into public.org_units(id,tenant_id,kind,name) values(${q(t.team)},${q(t.id)},'team','SYNTHETIC retained team');`;
 }
 for(const u of plan.users){
  sql+=`update public.profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=p.id and a.raw_app_meta_data->>'learn_measurements_acceptance_run'=${q(plan.runId)});`;
  sql+=`do $$ begin if not exists(select 1 from profiles where id=${q(u.id)} and tenant_id=${q(u.tenant)} and role=${q(u.role)}) then raise exception 'Synthetic profile binding failed';end if;end $$;`;
 }
 return sql+"commit;select 'retained_test_company_seeded' as state;";
}
export async function acceptMeasurements({allowProjectRef,token,fetcher=fetch}){
 const pre=await readRulesCatalog({allowProjectRef,token,fetcher});check(installedRules(pre),'Exact installed TEST measurement release required');
 async function request(url,{method='GET',headers={},body}={}){
  const r=await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});
  return readAcceptanceResponse(r);
 }
 const management={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 async function sql(query,readOnly=false){
  const r=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,{method:'POST',headers:management,body:{query,...(readOnly?{}:{read_only:false})}});
  check(r.ok,`Synthetic rules SQL failed (HTTP ${r.status})`);return r.data;
 }
 const auth=await sql(AUTH_CONTRACT_QUERY,true);check(auth?.length===1&&digest(auth[0].contract)===digest(expectedAuth),'TEST Auth fixture schema/trigger contract differs');
 const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:management});
 check(keys.ok&&Array.isArray(keys.data),'Existing TEST keys unavailable');
 function keyFor(role){
  const rows=keys.data.filter(k=>k.name===role&&typeof k.api_key==='string');check(rows.length===1,'Existing TEST key unavailable');
  const key=rows[0].api_key;let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{}
  check(claims?.ref===TEST_PROJECT&&claims?.role===role,'Existing key scope differs');return key;
 }
 const anon=keyFor('anon'),service=keyFor('service_role');
 const userHeaders=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})}),adminHeaders={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
 const plan=measurementFixturePlan(),manifest=`/private/tmp/serviceos-learn-measurements-fixtures-${plan.runId}.json`;
 const saveManifest=()=>writeFileSync(manifest,JSON.stringify(plan,null,2),{mode:0o600});saveManifest();
 const sessions=new Map(),checks=[],cleanupErrors=[];let failure=null,retainedSummary=null,lastOperation=null;
 const pass=s=>checks.push(s),rpc=(jwt,name,args)=>{lastOperation={kind:'rpc',name,expectedRevision:args.p_expected_version??null};plan.lastOperation=lastOperation;saveManifest();return request(`${ORIGIN}/rest/v1/rpc/${name}`,{method:'POST',headers:userHeaders(jwt),body:args});};
 const deny=(r,code,label)=>check(!r.ok&&r.data?.code===code&&(code!=='PT409'||r.status===409),label);
 const read=(jwt,path)=>request(`${ORIGIN}/rest/v1/${path}`,{headers:userHeaders(jwt)});
 const serverNow=async()=>{const r=await sql('select clock_timestamp()::text as now',true);check(typeof r?.[0]?.now==='string','Server clock unavailable');return r[0].now;};
 try{
  for(const u of plan.users){
   const password=randomBytes(32).toString('base64url');
   const made=await request(`${ORIGIN}/auth/v1/admin/users`,{method:'POST',headers:adminHeaders,body:{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_measurements_acceptance_run:plan.runId}}});
   check(made.ok&&made.data?.id===u.id,'Synthetic user creation failed');
   const login=await request(`${ORIGIN}/auth/v1/token?grant_type=password`,{method:'POST',headers:userHeaders(),body:{email:u.email,password}});
   check(login.ok&&login.data?.user?.id===u.id&&typeof login.data?.access_token==='string','Synthetic sign-in failed');sessions.set(u.id,login.data.access_token);
  }
  await sql(measurementSeedSql(plan));pass('Marked retained TEST companies and four synthetic Auth logins established');
  const [a,b]=plan.tenants,[owner,admin,viewer,other]=plan.users,ownerJwt=sessions.get(owner.id);
  plan.measurements=[randomUUID(),randomUUID()];plan.reviews=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];saveManifest();
  for(const t of plan.tenants){const user=plan.users.find(u=>u.tenant===t.id&&u.role==='owner');const r=await request(`${ORIGIN}/rest/v1/team_members`,{method:'POST',headers:adminHeaders,body:{id:t.member,tenant_id:t.id,org_unit_id:t.team,profile_id:user.id,display_name:'SYNTHETIC retained measurement subject',confirmed_at:new Date(Date.now()-86400000).toISOString(),effective_from:new Date(Date.now()-86400000).toISOString()}});check(r.status===201,'Synthetic subject creation failed');}
  const draft=await rpc(ownerJwt,'learn_scorecard_save_draft',{p_tenant_id:a.id,p_expected_version:0,p_definition:{...measurementDefinition(),groupId:a.team},p_reason:'Synthetic response evidence criteria'});
  check(draft.ok&&draft.data?.version===1,'Measurement policy creation failed');const policy=draft.data;plan.policies.A=policy.id;saveManifest();
  const dates=(await sql(`select date_trunc('milliseconds',min(observed_at))+interval '1 millisecond' as start,date_trunc('milliseconds',clock_timestamp()) as "end" from learn_member_history where tenant_id=${q(a.id)} and member_id=${q(a.member)}`,true))[0];
  check(Date.parse(dates.end)>Date.parse(dates.start),'Synthetic observation period unavailable');
  const observation={id:plan.measurements[0],tenantId:a.id,policyId:policy.id,policyVersion:1,subject:{kind:'member',id:a.member},period:dates,metricKey:'response.minutes',unit:'minutes',sourceSystem:'synthetic.communications',value:30,sampleCount:10,coveredCount:10,eligibleCount:10,observedAt:await serverNow(),sourceThrough:dates.end,review:'inferred',exclusions:[],evidence:[{table:'team_members',id:a.member}]};
  const append=payload=>({p_tenant_id:a.id,p_measurement:payload,p_reason:'Synthetic source adapter acceptance'});
  const serviceRpc=(name,args)=>{lastOperation={kind:'service_rpc',name};plan.lastOperation=lastOperation;saveManifest();return request(`${ORIGIN}/rest/v1/rpc/${name}`,{method:'POST',headers:adminHeaders,body:args});};
  let r=await serviceRpc('learn_performance_append',append(observation));check(r.ok&&r.data?.measurementId===observation.id&&!r.data.reused,'Initial source append failed');
  r=await serviceRpc('learn_performance_append',append(observation));check(r.ok&&r.data?.reused,'Source retry duplicated');
  deny(await serviceRpc('learn_performance_append',append({...observation,value:31})),'PT409','Changed source retry did not return HTTP 409');
  deny(await rpc(ownerJwt,'learn_performance_append',append({...observation,id:randomUUID()})),'42501','Browser appended trusted facts');
  for(const change of [{review:'confirmed'},{evidence:[{table:'team_members',id:b.member}]},{period:{start:new Date(Date.parse(dates.start)-86400000).toISOString(),end:dates.end}}])deny(await serviceRpc('learn_performance_append',append({...observation,id:randomUUID(),...change})),'22023','Invalid confirmation, foreign evidence or unobserved membership accepted');
  const client=createClient(ORIGIN,anon,{global:{fetch:fetcher,headers:{Authorization:`Bearer ${ownerJwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let loaded=await loadPerformanceMeasurements(client,policy,observation.subject,dates);check(loaded.length===1&&loaded[0].review==='inferred'&&loaded[0].reviews.length===0,'Actual card reader did not return the inferred fact');
  pass('Signed-in card reader and trusted append: exact scope, idempotency, HTTP 409 conflicts, foreign evidence and unobserved team-period denial');
  const review=(measurement,requestId,revision,decision='confirmed',reason='Synthetic reviewed evidence')=>({p_tenant_id:a.id,p_measurement_id:measurement,p_request_id:requestId,p_expected_revision:revision,p_decision:decision,p_reason:reason});
  r=await rpc(ownerJwt,'learn_performance_review',review(observation.id,plan.reviews[0],0));check(r.ok&&r.data?.revision===1&&!r.data.reused,'Initial human review failed');
  r=await rpc(ownerJwt,'learn_performance_review',review(observation.id,plan.reviews[0],0));check(r.ok&&r.data?.reused,'Human review retry duplicated');
  deny(await rpc(ownerJwt,'learn_performance_review',review(observation.id,plan.reviews[0],0,'disputed')),'PT409','Changed review retry did not conflict');
  deny(await rpc(ownerJwt,'learn_performance_review',review(observation.id,randomUUID(),0)),'PT409','Stale review did not conflict');
  for(const u of [viewer,other])deny(await rpc(sessions.get(u.id),'learn_performance_review',review(observation.id,randomUUID(),1)),'42501','Unauthorized review accepted');
  for(const u of [viewer,other])for(const table of ['measurements','learn_performance_reviews']){r=await read(sessions.get(u.id),`${table}?select=id&tenant_id=eq.${a.id}`);check(r.ok&&r.data?.length===0,'Performance evidence leaked');}
  loaded=await loadPerformanceMeasurements(client,policy,observation.subject,dates);check(loaded.length===1&&loaded[0].reviews.length===1&&Date.parse(loaded[0].observedAt)===Date.parse(observation.observedAt),'Review changed source timestamp or card reader lost review');
  pass('Owner review and replay, stale/reused request conflicts, viewer/foreign-company denial; actual card reader retains original source time');
  const newTeam=randomUUID();plan.transferTeam=newTeam;saveManifest();await sql(`insert into org_units(id,tenant_id,kind,name) values(${q(newTeam)},${q(a.id)},'team','SYNTHETIC later team');`);
  r=await request(`${ORIGIN}/rest/v1/team_members?id=eq.${a.member}`,{method:'PATCH',headers:adminHeaders,body:{org_unit_id:newTeam}});check(r.status===204,'Synthetic transfer failed');
  const corrected={...observation,id:plan.measurements[1],supersedes:observation.id,value:25,observedAt:await serverNow()};
  r=await serviceRpc('learn_performance_append',append(corrected));check(r.ok&&!r.data.reused,'Historical team correction failed after transfer');
  deny(await serviceRpc('learn_performance_append',append({...corrected,id:randomUUID(),observedAt:await serverNow()})),'PT409','Competing correction fork accepted');
  deny(await rpc(ownerJwt,'learn_performance_review',review(observation.id,randomUUID(),1)),'PT409','Corrected old observation accepted a new review');
  r=await rpc(sessions.get(admin.id),'learn_performance_review',review(corrected.id,plan.reviews[1],0,'disputed'));check(r.ok&&r.data?.revision===1,'Admin review of correction failed');
  const race=await Promise.all([rpc(ownerJwt,'learn_performance_review',review(corrected.id,plan.reviews[2],1)),rpc(sessions.get(admin.id),'learn_performance_review',review(corrected.id,plan.reviews[3],1))]);
  check(race.filter(x=>x.ok&&x.data?.revision===2).length===1&&race.filter(x=>x.status===409&&x.data?.code==='PT409').length===1,'Concurrent reviews did not preserve one next revision');
  loaded=await loadPerformanceMeasurements(client,policy,observation.subject,dates);check(loaded.length===2&&loaded.every(m=>m.review==='confirmed')&&loaded.find(m=>m.id===corrected.id)?.reviews.length===2,'Card reader lost correction/review chain');
  pass('Earlier team remains attributable after later transfer, corrections are retained, corrected facts cannot receive stale reviews, concurrent reviews produce one next revision');
  const rawStates=await read(ownerJwt,`measurements?select=review_state&tenant_id=eq.${a.id}`);check(rawStates.ok&&rawStates.data?.length===2&&rawStates.data.every(m=>m.review_state==='inferred'),'Reviews rewrote stored source state');
  const raw=await read(ownerJwt,`measurements?select=*&id=eq.${observation.id}`);check(raw.ok&&raw.data?.length===1,'Raw synthetic row unavailable');
  r=await request(`${ORIGIN}/rest/v1/measurements`,{method:'POST',headers:adminHeaders,body:{...raw.data[0],id:randomUUID(),review_state:'confirmed'}});deny(r,'42501','Service bypassed validated adapter');
  await sql(`do $$ begin
   begin update measurements set value=99 where id=${q(observation.id)};raise exception 'Measurement rewrite accepted';exception when restrict_violation then null;end;
   begin delete from learn_performance_reviews where id=${q(plan.reviews[0])};raise exception 'Review deletion accepted';exception when restrict_violation then null;end;
  end $$;select 'retention_enforced' as state;`);
  await sql(`insert into view_as_context(id,tenant_id,actor_user_id,subject_kind,subject_ref) values(${q(a.preview)},${q(a.id)},${q(owner.id)},'role','viewer');`);
  deny(await rpc(ownerJwt,'learn_performance_review',review(corrected.id,randomUUID(),2)),'42501','Preview review write accepted');
  await sql(`update view_as_context set ended_at=clock_timestamp() where id=${q(a.preview)};update profiles set role='viewer' where id=${q(owner.id)} and tenant_id=${q(a.id)};`);
  deny(await rpc(ownerJwt,'learn_performance_review',review(corrected.id,randomUUID(),2)),'42501','Revoked JWT retained review authority');
  r=await read(ownerJwt,`measurements?select=id&tenant_id=eq.${a.id}`);check(r.ok&&r.data?.length===0,'Revoked JWT retained performance reads');
  pass('Service insert bypass, privileged rewrite/delete, View-As writes and same-JWT revoked-role access denied');
 }catch(e){failure=e.message;}
 finally{
  // Reviews keep their authors. Retain those identities and revoke all test access.
  try{await sql(`update view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id in (${plan.tenants.map(t=>q(t.preview)).join(',')}) and actor_user_id in (${plan.users.map(u=>q(u.id)).join(',')});`);}catch{cleanupErrors.push('Synthetic preview closure requires inspection');}
  for(const u of plan.users){
   try{
    const found=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{headers:adminHeaders});if(found.status===404)continue;
    check(found.ok&&found.data?.id===u.id&&found.data.email===u.email&&found.data.app_metadata?.learn_measurements_acceptance_run===plan.runId,'Synthetic identity differs');
    await sql(`update profiles set role='viewer' where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=profiles.id and a.raw_app_meta_data->>'learn_measurements_acceptance_run'=${q(plan.runId)});`);
    const banned=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{method:'PUT',headers:adminHeaders,body:{ban_duration:'876000h',password:randomBytes(48).toString('base64url')}});
    check(banned.ok&&Date.parse(banned.data?.banned_until)>Date.now()+86400000,'Synthetic login ban not verified');
    const jwt=sessions.get(u.id);
    if(jwt)for(const table of ['measurements','learn_performance_reviews']){const r=await read(jwt,`${table}?select=id&tenant_id=eq.${u.tenant}`);check((r.status===401)||(r.ok&&r.data?.length===0),'Revoked synthetic JWT retains performance access');}
   }catch{cleanupErrors.push(`Synthetic access revocation requires inspection: ${u.id}`);}
  }
  try{
   const ids=plan.users.map(u=>q(u.id)).join(',');const revoked=await sql(`select count(*)::int as active from auth.users a left join profiles p on p.id=a.id where a.id in (${ids}) and (a.banned_until is null or a.banned_until<=clock_timestamp()+interval '1 day' or p.role is distinct from 'viewer')`,true);check(revoked?.[0]?.active===0,'Synthetic access remains active');
   retainedSummary=await sql(`select t.id as tenant_id,
    (select count(*)::int from team_members m where m.tenant_id=t.id) as members,
    (select count(*)::int from measurements m where m.tenant_id=t.id) as measurements,
    (select count(*)::int from learn_performance_reviews r where r.tenant_id=t.id) as reviews,
    (select count(*)::int from profiles p where p.tenant_id=t.id) as retained_profiles
    from tenants t where t.id in (${plan.tenants.map(t=>q(t.id)).join(',')}) and t.metadata->>'learn_measurements_acceptance_run'=${q(plan.runId)} order by t.id`,true);
   if(!failure){const a=retainedSummary?.find(t=>t.tenant_id===plan.tenants[0].id),b=retainedSummary?.find(t=>t.tenant_id===plan.tenants[1].id);check(a?.measurements===2&&a.reviews===3&&a.retained_profiles===3&&b?.measurements===0&&b.reviews===0,'Retained measurement counts differ');}
   plan.retainedSummary=retainedSummary;plan.accessRevoked=cleanupErrors.length===0;saveManifest();
  }catch{cleanupErrors.push('Access revocation or retained evidence not verified');}
 }
 return {version:'learn-test-measurements-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,observedAt:new Date().toISOString(),runId:plan.runId,
  state:!failure&&!cleanupErrors.length?'passed_retained_synthetic_acceptance':'requires_inspection',checks,failure,lastOperation,
  testAccessRevoked:cleanupErrors.length===0,cleanupErrors,retainedSummary,fixtureManifest:manifest,
  limitations:['Marked synthetic records and reviewer identities remain in TEST; synthetic logins are banned and profile roles revoked. No retention guards are disabled.',
   'No production, actual employee scores, source communications, audio, provider activity, payroll or full UI acceptance is established.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  check(process.argv.slice(2).join(' ')==='--retained-synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit retained synthetic TEST acceptance required');
  const r=await acceptMeasurements({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed_retained_synthetic_acceptance')process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
