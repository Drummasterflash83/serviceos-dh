/** Real TEST JWT acceptance with deliberately retained, marked synthetic evidence.
 * Synthetic logins are banned and roles revoked; reviewer identities and evidence remain.
 * Existing keys stay in process memory. No messages, audio or provider calls. */
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readWorkCatalog as readRulesCatalog } from './learn-work-catalog.mjs';
import { createClient } from '@supabase/supabase-js';
import { loadWorkTimeline } from '../../src/lib/learn-work-history.ts';
import { collectWorkEvidence } from '../../src/lib/learn-work-collection.ts';
import { loadPerformanceMeasurements } from '../../src/lib/learn-performance-measurements.ts';
import { installedWork as installedRules } from './learn-test-work-release.mjs';
import { SOURCE_SHA256 } from './learn-test-work-rehearsal.mjs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
import { AUTH_CONTRACT_QUERY } from './learn-test-auth-contract.mjs';
import { readAcceptanceResponse } from './learn-test-launch-acceptance.mjs';
const ORIGIN=`https://${TEST_PROJECT}.supabase.co`,q=s=>`'${String(s).replaceAll("'","''")}'`;
const check=(ok,label)=>{if(!ok)throw Error(label);};
const canonical=v=>Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const expectedAuth=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json',import.meta.url)));
export function workFixturePlan(){
 const runId=randomUUID(),tenants=['A','B'].map(label=>({label,id:randomUUID(),team:randomUUID(),member:randomUUID(),preview:randomUUID(),publications:[randomUUID(),randomUUID()]}));
 const users=[['owner',0],['admin',0],['viewer',0],['owner',1]].map(([role,index],i)=>({id:randomUUID(),tenant:tenants[index].id,role,email:`learn-work-${runId}-${i}@example.invalid`}));
 return {version:'learn-test-work-fixtures/1',projectRef:TEST_PROJECT,runId,retention:'Retain marked synthetic companies, staff, rules, measurements, reviews and reviewer identities; ban synthetic Auth logins and revoke their profile roles.',tenants,users,policies:{}};
}
export function workDefinition(scaleMax=100){const common={weight:1,zeroAt:0,fullAt:100,minSamples:1,minCoverage:1,maxAgeHours:24};return {name:'SYNTHETIC captured work',subjectKind:'member',groupId:null,scaleMax,metrics:[{...common,key:'work.recorded_handoffs',label:'Recorded handoffs',unit:'handoffs',sourceSystems:['serviceos.work.handoffs@1']},{...common,key:'work.owned_item_minutes',label:'Owned item minutes',unit:'item_minutes',sourceSystems:['serviceos.work.residence@1']}]};}
export function workSeedSql(plan){
 let sql="begin;set local statement_timeout='15s';";
 for(const t of plan.tenants){
  sql+=`insert into public.tenants(id,slug,display_name,metadata) values(${q(t.id)},${q('learn-work-qa-'+plan.runId+'-'+t.label)},'SYNTHETIC RETAINED scorecard acceptance',jsonb_build_object('learn_work_acceptance_run',${q(plan.runId)},'synthetic',true,'purpose','retained_test_evidence'));`;
  sql+=`insert into public.org_units(id,tenant_id,kind,name) values(${q(t.team)},${q(t.id)},'team','SYNTHETIC retained team');`;
 }
 for(const u of plan.users){
  sql+=`update public.profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=p.id and a.raw_app_meta_data->>'learn_work_acceptance_run'=${q(plan.runId)});`;
  sql+=`do $$ begin if not exists(select 1 from profiles where id=${q(u.id)} and tenant_id=${q(u.tenant)} and role=${q(u.role)}) then raise exception 'Synthetic profile binding failed';end if;end $$;`;
 }
 return sql+"commit;select 'retained_test_company_seeded' as state;";
}
export async function acceptWork({allowProjectRef,token,fetcher=fetch}){
 const pre=await readRulesCatalog({allowProjectRef,token,fetcher});check(installedRules(pre),'Exact installed TEST work release required');
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
 const plan=workFixturePlan(),manifest=`/private/tmp/serviceos-learn-work-fixtures-${plan.runId}.json`;
 const saveManifest=()=>writeFileSync(manifest,JSON.stringify(plan,null,2),{mode:0o600});saveManifest();
 const sessions=new Map(),checks=[],cleanupErrors=[];let failure=null,retainedSummary=null,lastOperation=null;
 const pass=s=>checks.push(s),rpc=(jwt,name,args)=>{lastOperation={kind:'rpc',name,expectedRevision:args.p_expected_version??null};plan.lastOperation=lastOperation;saveManifest();return request(`${ORIGIN}/rest/v1/rpc/${name}`,{method:'POST',headers:userHeaders(jwt),body:args});};
 const deny=(r,code,label)=>check(!r.ok&&r.data?.code===code&&(code!=='PT409'||r.status===409),label);
 const read=(jwt,path)=>request(`${ORIGIN}/rest/v1/${path}`,{headers:userHeaders(jwt)});
 const serverNow=async()=>{const r=await sql('select clock_timestamp()::text as now',true);check(typeof r?.[0]?.now==='string','Server clock unavailable');return r[0].now;};
 try{
  for(const u of plan.users){
   const password=randomBytes(32).toString('base64url');
   const made=await request(`${ORIGIN}/auth/v1/admin/users`,{method:'POST',headers:adminHeaders,body:{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_work_acceptance_run:plan.runId}}});
   check(made.ok&&made.data?.id===u.id,'Synthetic user creation failed');
   const login=await request(`${ORIGIN}/auth/v1/token?grant_type=password`,{method:'POST',headers:userHeaders(),body:{email:u.email,password}});
   check(login.ok&&login.data?.user?.id===u.id&&typeof login.data?.access_token==='string','Synthetic sign-in failed');sessions.set(u.id,login.data.access_token);
  }
  await sql(workSeedSql(plan));pass('Marked retained TEST companies and four synthetic Auth logins established');
  const [a,b]=plan.tenants,[owner,admin,viewer,other]=plan.users,ownerJwt=sessions.get(owner.id);
  a.recipient=randomUUID();plan.objects=[randomUUID(),randomUUID()];plan.collections=Array.from({length:5},()=>randomUUID());plan.review=randomUUID();saveManifest();
  const members=[{id:a.member,tenant:a.id,team:a.team,user:owner.id},{id:a.recipient,tenant:a.id,team:a.team,user:viewer.id},{id:b.member,tenant:b.id,team:b.team,user:other.id}];
  for(const m of members){const r=await request(`${ORIGIN}/rest/v1/team_members`,{method:'POST',headers:adminHeaders,body:{id:m.id,tenant_id:m.tenant,org_unit_id:m.team,profile_id:m.user,display_name:'SYNTHETIC work subject',confirmed_at:new Date(Date.now()-86400000).toISOString(),effective_from:new Date(Date.now()-86400000).toISOString()}});check(r.status===201,'Synthetic work member failed');}
  const draft=await rpc(ownerJwt,'learn_scorecard_save_draft',{p_tenant_id:a.id,p_expected_version:0,p_definition:workDefinition(),p_reason:'Synthetic work collection criteria'});check(draft.ok&&draft.data?.version===1,'Work policy failed');const policy=draft.data;plan.policies.A=policy.id;saveManifest();
  const roundedNow=async()=>{const r=await sql(`select date_trunc('milliseconds',clock_timestamp())::text as now`,true);return new Date(r[0].now).toISOString();};
  const start=await roundedNow();
  for(let i=0;i<2;i++){const r=await request(`${ORIGIN}/rest/v1/intelligence_objects`,{method:'POST',headers:adminHeaders,body:{id:plan.objects[i],tenant_id:a.id,domain:'core',object_type:'Task',subject:'SYNTHETIC retained work '+i,status:i?'waiting':'ready',responsible_ref:{kind:i?'user':'member',ref:i?owner.id:a.member}}});check(r.status===201,'Synthetic work insertion failed');}
  const patch=async(id,body)=>{const r=await request(`${ORIGIN}/rest/v1/intelligence_objects?id=eq.${id}&tenant_id=eq.${a.id}`,{method:'PATCH',headers:adminHeaders,body});check(r.status===204,'Synthetic work update failed');};
  await patch(plan.objects[0],{responsible_ref:{kind:'user',ref:owner.id},status:'closed'});
  await patch(plan.objects[0],{responsible_ref:{kind:'member',ref:a.recipient}});
  await patch(plan.objects[1],{subject:'SYNTHETIC label-only change'});
  const period={start,end:await roundedNow()};plan.period=period;saveManifest();
  const client=createClient(ORIGIN,anon,{global:{fetch:fetcher,headers:{Authorization:`Bearer ${ownerJwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const timeline=await loadWorkTimeline(client,{tenantId:a.id,objectId:plan.objects[0],period});check(timeline.eventCount===3&&timeline.knownMinutes>0&&timeline.handoffs.length===2,'Actual timeline reader lost captures or reference changes');
  const second=await loadWorkTimeline(client,{tenantId:a.id,objectId:plan.objects[1],period});check(second.eventCount===1,'Label-only update invented ownership capture');
  const collect=(member,id,reason='Synthetic captured-work acceptance',end=period.end)=>({p_tenant:a.id,p_member:member,p_policy:policy.id,p_revision:1,p_start:period.start,p_end:end,p_request:id,p_reason:reason});
  let r=await rpc(ownerJwt,'learn_work_handoffs_collect',collect(a.member,plan.collections[0]));check(r.ok&&!r.data?.reused,'Handoff collection failed');
  r=await rpc(ownerJwt,'learn_work_handoffs_collect',collect(a.member,plan.collections[0]));check(r.ok&&r.data?.reused,'Handoff retry duplicated');
  deny(await rpc(ownerJwt,'learn_work_handoffs_collect',collect(a.member,plan.collections[0],'Changed reason')),'PT409','Changed collection retry did not conflict');
  deny(await rpc(ownerJwt,'learn_work_handoffs_collect',collect(a.member,randomUUID())),'PT409','Duplicate handoff cell accepted');
  await collectWorkEvidence(client,{kind:'residence',policy,memberId:a.member,period,requestId:plan.collections[1],reason:'Synthetic elapsed-item evidence'});
  const subject={kind:'member',id:a.member};let loaded=await loadPerformanceMeasurements(client,policy,subject,period);
  const handoff=loaded.find(m=>m.metricKey==='work.recorded_handoffs'),residence=loaded.find(m=>m.metricKey==='work.owned_item_minutes');
  check(loaded.length===2&&handoff?.value===1&&handoff.coveredCount===2&&residence?.value>0&&loaded.every(m=>m.review==='inferred'),'Actual card reader lost collected facts or counted aliases');
  const expected=(await sql(`select sum(extract(epoch from least(${q(period.end)}::timestamptz,coalesce(next_at,${q(period.end)}::timestamptz))-occurred_at)/60)::text as value from (select occurred_at,work_after,lead(occurred_at) over(partition by object_id order by capture_sequence) next_at from object_state_history where tenant_id=${q(a.id)} and capture_kind is not null) h where work_after#>>'{responsible_ref,ref}' in (${q(a.member)},${q(owner.id)})`,true))[0];
  check(Math.abs(residence.value-Number(expected.value))<1e-8,'Elapsed source calculation differs from independently summed captured intervals');
  r=await read(ownerJwt,`learn_work_measurement_runs?select=id,proof&tenant_id=eq.${a.id}`);check(r.ok&&r.data?.length===2&&r.data.find(x=>x.id===plan.collections[1]).proof.credited.some(x=>x.status==='closed'),'Retained proof or closed interval unavailable');
  pass('Actual timeline/card readers and collection adapter: forward source writes, one real handoff despite aliases, elapsed intervals including closed/waiting, retained proofs and HTTP 409 retries');
  const race=await Promise.all([rpc(ownerJwt,'learn_work_handoffs_collect',collect(a.recipient,plan.collections[2])),rpc(sessions.get(admin.id),'learn_work_handoffs_collect',collect(a.recipient,plan.collections[3]))]);
  check(race.filter(x=>x.ok).length===1&&race.filter(x=>x.status===409&&x.data?.code==='PT409').length===1,'Concurrent collection did not preserve one exact cell');
  r=await rpc(sessions.get(admin.id),'learn_performance_review',{p_tenant_id:a.id,p_measurement_id:plan.collections[1],p_request_id:plan.review,p_expected_revision:0,p_decision:'confirmed',p_reason:'Reviewed synthetic interval evidence'});check(r.ok&&r.data?.revision===1,'Collected evidence review failed');
  loaded=await loadPerformanceMeasurements(client,policy,subject,period);check(loaded.find(m=>m.id===plan.collections[1])?.review==='confirmed'&&loaded.find(m=>m.id===plan.collections[0])?.review==='inferred','Human review changed unrelated observations');
  for(const u of [viewer,other]){
   deny(await rpc(sessions.get(u.id),'learn_work_history_read',{p_tenant:a.id,p_object:plan.objects[0],p_start:period.start,p_end:period.end}),'42501','Unauthorized history read');
   deny(await rpc(sessions.get(u.id),'learn_work_residence_collect',collect(a.member,randomUUID())),'42501','Unauthorized collection');
   r=await read(sessions.get(u.id),`learn_work_measurement_runs?select=id&tenant_id=eq.${a.id}`);check(r.ok&&r.data?.length===0,'Calculation proof leaked');
  }
  pass('Concurrent collection saves one observation/receipt, review is separate, viewers and other companies cannot read the bounded history or collect/read performance proofs');
  await patch(plan.objects[1],{responsible_ref:{kind:'user',ref:'unresolved@example.invalid'}});
  const partialEnd=await roundedNow();r=await rpc(ownerJwt,'learn_work_residence_collect',collect(a.member,plan.collections[4],'Synthetic incomplete identity',partialEnd));check(r.ok,'Partial collection failed');
  r=await read(ownerJwt,`measurements?select=value,covered_count,eligible_count,source_through&id=eq.${plan.collections[4]}`);check(r.ok&&r.data?.length===1&&r.data[0].value===null&&r.data[0].source_through===null&&r.data[0].covered_count<r.data[0].eligible_count,'Unknown identity became a zero or complete result');
  await sql(`do $$ begin
   begin delete from intelligence_objects where id=${q(plan.objects[0])} and tenant_id=${q(a.id)};raise exception 'Captured work deleted';exception when raise_exception then if sqlerrm='Captured work deleted' then raise;end if;end;
   begin delete from learn_work_measurement_runs where id=${q(plan.collections[0])};raise exception 'Proof deleted';exception when object_not_in_prerequisite_state then null;end;
  end $$;select 'work_retention_enforced' as state;`);
  await sql(`insert into view_as_context(id,tenant_id,actor_user_id,subject_kind,subject_ref) values(${q(a.preview)},${q(a.id)},${q(owner.id)},'role','viewer');`);
  deny(await rpc(ownerJwt,'learn_work_handoffs_collect',collect(a.member,randomUUID())),'42501','Preview collected work');
  await sql(`update view_as_context set ended_at=clock_timestamp() where id=${q(a.preview)};update profiles set role='viewer' where id=${q(owner.id)} and tenant_id=${q(a.id)};`);
  deny(await rpc(ownerJwt,'learn_work_handoffs_collect',collect(a.member,randomUUID())),'42501','Revoked JWT retained collection authority');
  pass('Unresolved identity withholds value, source/proof deletion is refused, preview and same-JWT revoked role cannot collect');
 }catch(e){failure=e.message;}
 finally{
  // Reviews keep their authors. Retain those identities and revoke all test access.
  try{await sql(`update view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id in (${plan.tenants.map(t=>q(t.preview)).join(',')}) and actor_user_id in (${plan.users.map(u=>q(u.id)).join(',')});`);}catch{cleanupErrors.push('Synthetic preview closure requires inspection');}
  for(const u of plan.users){
   try{
    const found=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{headers:adminHeaders});if(found.status===404)continue;
    check(found.ok&&found.data?.id===u.id&&found.data.email===u.email&&found.data.app_metadata?.learn_work_acceptance_run===plan.runId,'Synthetic identity differs');
    await sql(`update profiles set role='viewer' where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=profiles.id and a.raw_app_meta_data->>'learn_work_acceptance_run'=${q(plan.runId)});`);
    const banned=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{method:'PUT',headers:adminHeaders,body:{ban_duration:'876000h',password:randomBytes(48).toString('base64url')}});
    check(banned.ok&&Date.parse(banned.data?.banned_until)>Date.now()+86400000,'Synthetic login ban not verified');
    const jwt=sessions.get(u.id);
    if(jwt)for(const table of ['measurements','learn_performance_reviews','learn_work_measurement_runs']){const r=await read(jwt,`${table}?select=id&tenant_id=eq.${u.tenant}`);check((r.status===401)||(r.ok&&r.data?.length===0),'Revoked synthetic JWT retains performance access');}
   }catch{cleanupErrors.push(`Synthetic access revocation requires inspection: ${u.id}`);}
  }
  try{
   const ids=plan.users.map(u=>q(u.id)).join(',');const revoked=await sql(`select count(*)::int as active from auth.users a left join profiles p on p.id=a.id where a.id in (${ids}) and (a.banned_until is null or a.banned_until<=clock_timestamp()+interval '1 day' or p.role is distinct from 'viewer')`,true);check(revoked?.[0]?.active===0,'Synthetic access remains active');
   retainedSummary=await sql(`select t.id as tenant_id,
    (select count(*)::int from team_members m where m.tenant_id=t.id) as members,
    (select count(*)::int from measurements m where m.tenant_id=t.id) as measurements,
    (select count(*)::int from learn_performance_reviews r where r.tenant_id=t.id) as reviews,
    (select count(*)::int from profiles p where p.tenant_id=t.id) as retained_profiles,
    (select count(*)::int from intelligence_objects o where o.tenant_id=t.id) as work_items,
    (select count(*)::int from object_state_history h where h.tenant_id=t.id and h.capture_kind is not null) as captured_events,
    (select count(*)::int from learn_work_measurement_runs r where r.tenant_id=t.id) as calculation_receipts
    from tenants t where t.id in (${plan.tenants.map(t=>q(t.id)).join(',')}) and t.metadata->>'learn_work_acceptance_run'=${q(plan.runId)} order by t.id`,true);
   if(!failure){const a=retainedSummary?.find(t=>t.tenant_id===plan.tenants[0].id),b=retainedSummary?.find(t=>t.tenant_id===plan.tenants[1].id);check(a?.measurements===4&&a.reviews===1&&a.retained_profiles===3&&a.work_items===2&&a.captured_events===5&&a.calculation_receipts===4&&b?.measurements===0&&b.reviews===0,'Retained measurement counts differ');}
   plan.retainedSummary=retainedSummary;plan.accessRevoked=cleanupErrors.length===0;saveManifest();
  }catch{cleanupErrors.push('Access revocation or retained evidence not verified');}
 }
 return {version:'learn-test-work-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,observedAt:new Date().toISOString(),runId:plan.runId,
  state:!failure&&!cleanupErrors.length?'passed_retained_synthetic_acceptance':'requires_inspection',checks,failure,lastOperation,
  testAccessRevoked:cleanupErrors.length===0,cleanupErrors,retainedSummary,fixtureManifest:manifest,
  limitations:['Marked synthetic records and reviewer identities remain in TEST; synthetic logins are banned and profile roles revoked. No retention guards are disabled.',
   'No production, actual employee scores, source communications, audio, provider activity, payroll or full UI acceptance is established.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  check(process.argv.slice(2).join(' ')==='--retained-synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit retained synthetic TEST acceptance required');
  const r=await acceptWork({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed_retained_synthetic_acceptance')process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
