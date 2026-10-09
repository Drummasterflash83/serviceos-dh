/** Real TEST JWT acceptance with deliberately retained, marked synthetic evidence.
 * Only the synthetic logins/profiles are removed; history and rules are retained.
 * Existing keys stay in process memory. No messages, audio or provider calls. */
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readRulesCatalog } from './learn-rules-catalog.mjs';
import { installedConflictRepair as installedRules, SOURCE_SHA256 as CONFLICT_SOURCE_SHA256 } from './learn-test-scorecard-conflicts.mjs';
import { SOURCE_SHA256 } from './learn-test-rules-rehearsal.mjs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
import { AUTH_CONTRACT_QUERY } from './learn-test-auth-contract.mjs';
import { readAcceptanceResponse } from './learn-test-launch-acceptance.mjs';
const ORIGIN=`https://${TEST_PROJECT}.supabase.co`,q=s=>`'${String(s).replaceAll("'","''")}'`;
const check=(ok,label)=>{if(!ok)throw Error(label);};
const canonical=v=>Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const expectedAuth=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json',import.meta.url)));
export function rulesFixturePlan(){
 const runId=randomUUID(),tenants=['A','B'].map(label=>({label,id:randomUUID(),team:randomUUID(),member:randomUUID(),preview:randomUUID(),publications:[randomUUID(),randomUUID()]}));
 const users=[['owner',0],['admin',0],['viewer',0],['owner',1]].map(([role,index],i)=>({id:randomUUID(),tenant:tenants[index].id,role,email:`learn-rules-${runId}-${i}@example.invalid`}));
 return {version:'learn-test-rules-fixtures/1',projectRef:TEST_PROJECT,runId,retention:'Retain marked synthetic companies, teams, memberships, rule revisions and publications; remove test logins/profiles only.',tenants,users,policies:{}};
}
export function rulesDefinition(scaleMax=50){return {name:`SYNTHETIC ${scaleMax}-point criteria`,subjectKind:'member',groupId:null,scaleMax,metrics:[{key:'work.handoffs',label:'Synthetic handoff count',unit:'count',weight:1,zeroAt:0,fullAt:20,minSamples:1,minCoverage:1,maxAgeHours:24,sourceSystems:['serviceos.work.handoffs@1']}]};}
export function rulesSeedSql(plan){
 let sql="begin;set local statement_timeout='15s';";
 for(const t of plan.tenants){
  sql+=`insert into public.tenants(id,slug,display_name,metadata) values(${q(t.id)},${q('learn-rules-qa-'+plan.runId+'-'+t.label)},'SYNTHETIC RETAINED scorecard acceptance',jsonb_build_object('learn_rules_acceptance_run',${q(plan.runId)},'synthetic',true,'purpose','retained_test_evidence'));`;
  sql+=`insert into public.org_units(id,tenant_id,kind,name) values(${q(t.team)},${q(t.id)},'team','SYNTHETIC retained team');`;
 }
 for(const u of plan.users){
  sql+=`update public.profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users a where a.id=p.id and a.raw_app_meta_data->>'learn_rules_acceptance_run'=${q(plan.runId)});`;
  sql+=`do $$ begin if not exists(select 1 from profiles where id=${q(u.id)} and tenant_id=${q(u.tenant)} and role=${q(u.role)}) then raise exception 'Synthetic profile binding failed';end if;end $$;`;
 }
 return sql+"commit;select 'retained_test_company_seeded' as state;";
}
export async function acceptRules({allowProjectRef,token,fetcher=fetch}){
 const pre=await readRulesCatalog({allowProjectRef,token,fetcher});check(installedRules(pre),'Exact installed TEST rules required');
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
 const plan=rulesFixturePlan(),manifest=`/private/tmp/serviceos-learn-rules-fixtures-${plan.runId}.json`;
 const saveManifest=()=>writeFileSync(manifest,JSON.stringify(plan,null,2),{mode:0o600});saveManifest();
 const sessions=new Map(),checks=[],cleanupErrors=[];let failure=null,retainedSummary=null,lastOperation=null;
 const pass=s=>checks.push(s),rpc=(jwt,name,args)=>{lastOperation={kind:'rpc',name,expectedRevision:args.p_expected_version??null};plan.lastOperation=lastOperation;saveManifest();return request(`${ORIGIN}/rest/v1/rpc/${name}`,{method:'POST',headers:userHeaders(jwt),body:args});};
 const deny=(r,code,label)=>check(!r.ok&&r.data?.code===code&&(code!=='PT409'||r.status===409),label);
 const read=(jwt,path)=>request(`${ORIGIN}/rest/v1/${path}`,{headers:userHeaders(jwt)});
 const serverNow=async()=>{const r=await sql('select clock_timestamp()::text as now',true);check(typeof r?.[0]?.now==='string','Server clock unavailable');return r[0].now;};
 try{
  for(const u of plan.users){
   const password=randomBytes(32).toString('base64url');
   const made=await request(`${ORIGIN}/auth/v1/admin/users`,{method:'POST',headers:adminHeaders,body:{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_rules_acceptance_run:plan.runId}}});
   check(made.ok&&made.data?.id===u.id,'Synthetic user creation failed');
   const login=await request(`${ORIGIN}/auth/v1/token?grant_type=password`,{method:'POST',headers:userHeaders(),body:{email:u.email,password}});
   check(login.ok&&login.data?.user?.id===u.id&&typeof login.data?.access_token==='string','Synthetic sign-in failed');sessions.set(u.id,login.data.access_token);
  }
  await sql(rulesSeedSql(plan));pass('Marked retained TEST companies and four synthetic Auth logins established');
  const [a,b]=plan.tenants,[owner,admin,viewer,other]=plan.users,ownerJwt=sessions.get(owner.id);
  const draftArgs=(t,version,definition=rulesDefinition())=>({p_tenant_id:t,p_expected_version:version,p_definition:definition,p_reason:'Synthetic retained acceptance rules'});
  const draftRead=t=>({p_tenant:t,p_kind:'member',p_group:null});
  for(const t of plan.tenants){
   const jwt=sessions.get(plan.users.find(u=>u.tenant===t.id&&u.role==='owner').id);
   const first=await rpc(jwt,'learn_scorecard_save_draft',draftArgs(t.id,0));
   check(first.ok&&first.data?.tenantId===t.id&&first.data.version===1&&first.data.scaleMax===50&&first.data.status==='draft','Initial owner draft failed');
   plan.policies[t.label]=first.data.id;saveManifest();
  }
  const p=plan.policies.A;
  const initialRead=await rpc(ownerJwt,'learn_scorecard_read_draft',draftRead(a.id));check(initialRead.ok&&initialRead.data?.id===p&&initialRead.data.version===1,'Revision reader returned wrong draft');
  deny(await rpc(ownerJwt,'learn_scorecard_save_draft',draftArgs(a.id,0)),'PT409','Stale editor accepted');
  deny(await rpc(ownerJwt,'learn_scorecard_save_draft',draftArgs(a.id,1,{...rulesDefinition(),groupId:b.team})),'22023','Foreign team accepted');
  deny(await rpc(ownerJwt,'learn_scorecard_save_draft',draftArgs(a.id,1,rulesDefinition(0))),'22023','Invalid scoring scale accepted');
  deny(await rpc(sessions.get(viewer.id),'learn_scorecard_save_draft',draftArgs(a.id,1)),'42501','Viewer draft write accepted');
  deny(await rpc(ownerJwt,'learn_scorecard_read_draft',draftRead(b.id)),'42501','Foreign draft read accepted');
  deny(await rpc(sessions.get(other.id),'learn_scorecard_save_draft',draftArgs(a.id,1)),'42501','Foreign draft write accepted');
  pass('Revision reader, configurable scale, stale editor, invalid scope and role/company denial through real JWTs');
  const publish=(revision,id,reason='Synthetic reviewed publication')=>({p_tenant:a.id,p_policy:p,p_revision:revision,p_request:id,p_reason:reason});
  let result=await rpc(ownerJwt,'learn_scorecard_publish',publish(1,a.publications[0]));
  check(result.ok&&result.data?.publicationId===a.publications[0]&&result.data.revision===1&&!result.data.reused,'First publication failed');
  const firstAt=result.data.effectiveFrom;plan.tenants[0].firstPublishedAt=firstAt;saveManifest();
  result=await rpc(ownerJwt,'learn_scorecard_publish',publish(1,a.publications[0]));check(result.ok&&result.data?.reused===true&&result.data.effectiveFrom===firstAt,'Identical publication retry did not reuse receipt');
  deny(await rpc(ownerJwt,'learn_scorecard_publish',publish(1,a.publications[0],'Changed reason')),'PT409','Changed publication retry accepted');
  const period=(start,end)=>({p_tenant:a.id,p_kind:'member',p_group:null,p_start:start,p_end:end});
  result=await rpc(ownerJwt,'learn_scorecard_policy_for_period',period(new Date(Date.parse(firstAt)-86400000).toISOString(),firstAt));check(result.ok&&result.data===null,'Publication backdated into earlier period');
  result=await rpc(sessions.get(admin.id),'learn_scorecard_save_draft',draftArgs(a.id,1,rulesDefinition(100)));check(result.ok&&result.data?.version===2&&result.data.scaleMax===100,'Admin revision update failed');
  result=await rpc(ownerJwt,'learn_scorecard_policy_for_period',period(firstAt,new Date(Date.parse(firstAt)+3600000).toISOString()));check(result.ok&&result.data?.version===1&&result.data.scaleMax===50,'Unpublished draft replaced existing rules');
  result=await rpc(sessions.get(admin.id),'learn_scorecard_publish',publish(2,a.publications[1]));check(result.ok&&result.data?.revision===2,'Admin publication failed');
  const nextAt=result.data.effectiveFrom;plan.tenants[0].secondPublishedAt=nextAt;saveManifest();
  result=await rpc(ownerJwt,'learn_scorecard_policy_for_period',period(firstAt,nextAt));check(result.ok&&result.data?.version===1,'Exact publication boundary failed');
  result=await rpc(ownerJwt,'learn_scorecard_policy_for_period',period(nextAt,new Date(Date.parse(nextAt)+3600000).toISOString()));check(result.ok&&result.data?.version===2&&result.data.scaleMax===100,'New publication interval failed');
  deny(await rpc(ownerJwt,'learn_scorecard_policy_for_period',period(firstAt,new Date(Date.parse(nextAt)+3600000).toISOString())),'22023','Mixed-rule period accepted');
  pass('Owner/admin publication, idempotency, 50-to-100 revision changes and prospective period boundaries');
  for(const t of plan.tenants){
   const user=plan.users.find(u=>u.tenant===t.id&&u.role==='owner');
   const created=await request(`${ORIGIN}/rest/v1/team_members`,{method:'POST',headers:adminHeaders,body:{id:t.member,tenant_id:t.id,profile_id:user.id,org_unit_id:t.team,display_name:'SYNTHETIC retained membership',confirmed_at:await serverNow(),effective_from:new Date(Date.now()-86400000*3).toISOString()}});
   check(created.status===201,'Synthetic retained membership failed');
  }
  let end=await serverNow();
  const ended=await request(`${ORIGIN}/rest/v1/team_members?id=eq.${a.member}`,{method:'PATCH',headers:adminHeaders,body:{effective_to:end}});check(ended.status===204,'Synthetic member end failed');
  const renamed=await request(`${ORIGIN}/rest/v1/team_members?id=eq.${a.member}`,{method:'PATCH',headers:adminHeaders,body:{display_name:'SYNTHETIC retained renamed membership'}});check(renamed.status===204,'Synthetic member rename failed');
  end=await serverNow();const historyArgs={p_tenant:a.id,p_start:new Date(Date.parse(end)-86400000*7).toISOString(),p_end:end};
  result=await rpc(ownerJwt,'learn_member_history_read',historyArgs);
  const member=result.data?.members?.find(m=>m.memberId===a.member);
  check(result.ok&&result.data?.count===1&&member?.firstKind==='insert'&&member.count===2&&Date.parse(member.coverageStart)>Date.parse(end)-3600000,'Observed member history or tenant scope differs');
  check(member.events[1]?.after?.effectiveTo!==null&&member.events[0]?.after?.effectiveTo===null,'Membership change history differs');
  deny(await rpc(sessions.get(viewer.id),'learn_member_history_read',historyArgs),'42501','Viewer history read accepted');
  deny(await rpc(sessions.get(other.id),'learn_member_history_read',historyArgs),'42501','Foreign history read accepted');
  check((await read(ownerJwt,`learn_member_history?select=id&tenant_id=eq.${a.id}`)).status===403,'Raw membership history exposed');
  pass('Forward membership capture, original effective dates do not fabricate coverage, rename does not add events, restricted history reader');
  // Privileged direct rewrite attempts must fail too. Every target is this run's ID.
  await sql(`do $$ begin
   begin delete from public.learn_scorecard_publications where id=${q(a.publications[0])};raise exception 'Publication deletion accepted';exception when object_not_in_prerequisite_state then null;end;
   begin update public.operating_profile_entries set value=value||'{"name":"Unexpected rewrite"}' where tenant_id=${q(a.id)} and namespace='learn_scorecards';raise exception 'Rule rewrite accepted';exception when object_not_in_prerequisite_state then null;end;
   begin delete from public.team_members where id=${q(a.member)} and tenant_id=${q(a.id)};raise exception 'Member deletion accepted';exception when object_not_in_prerequisite_state then null;end;
   begin delete from public.learn_member_history where member_id=${q(a.member)} and tenant_id=${q(a.id)};raise exception 'History deletion accepted';exception when object_not_in_prerequisite_state then null;end;
  end $$;`);
  const preview=await request(`${ORIGIN}/rest/v1/view_as_context`,{method:'POST',headers:adminHeaders,body:{id:a.preview,tenant_id:a.id,actor_user_id:owner.id,subject_kind:'role',subject_ref:'viewer',reason:'Synthetic preview denial'}});check(preview.status===201,'Synthetic preview context failed');
  deny(await rpc(ownerJwt,'learn_scorecard_save_draft',draftArgs(a.id,2)),'42501','Preview draft write accepted');
  deny(await rpc(ownerJwt,'learn_scorecard_publish',publish(2,randomUUID())),'42501','Preview publication accepted');
  await request(`${ORIGIN}/rest/v1/view_as_context?id=eq.${a.preview}`,{method:'PATCH',headers:adminHeaders,body:{ended_at:await serverNow()}});
  await sql(`update profiles set role='viewer' where id=${q(owner.id)} and tenant_id=${q(a.id)} and email=${q(owner.email)};`);
  deny(await rpc(ownerJwt,'learn_scorecard_read_draft',draftRead(a.id)),'42501','Revoked JWT retained draft access');
  result=await read(ownerJwt,`learn_scorecard_publications?select=id&tenant_id=eq.${a.id}`);check(result.ok&&result.data?.length===0,'Revoked JWT retained publication rows');
  pass('Retained rules/history resist privileged rewrites; preview and same-JWT role revocation deny authority');
 }catch(e){failure=e.message;}
 finally{
  // End only this run's preview rows. Never remove retained rule/member evidence.
  try{await sql(`update public.view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id in (${plan.tenants.map(t=>q(t.preview)).join(',')}) and actor_user_id in (${plan.users.map(u=>q(u.id)).join(',')});`);}catch{cleanupErrors.push('Synthetic preview closure requires inspection');}
  for(const u of plan.users){
   try{
    const found=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{headers:adminHeaders});
    if(found.status===404)continue;
    check(found.ok&&found.data?.id===u.id&&found.data.email===u.email&&found.data.app_metadata?.learn_rules_acceptance_run===plan.runId,'Synthetic Auth cleanup identity differs');
    const removed=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{method:'DELETE',headers:adminHeaders,body:{should_soft_delete:false}});check(removed.ok,'Synthetic Auth deletion failed');
   }catch{cleanupErrors.push(`Synthetic login cleanup requires inspection: ${u.id}`);}
  }
  try{
   const ids=plan.users.map(u=>q(u.id)).join(',');const absent=await sql(`select (select count(*) from auth.users where id in (${ids}))+(select count(*) from profiles where id in (${ids})) as remaining`,true);
   check(Number(absent?.[0]?.remaining)===0,'Synthetic logins/profiles remain');
   retainedSummary=await sql(`select t.id as tenant_id,
    (select count(*)::int from team_members m where m.tenant_id=t.id) as members,
    (select count(*)::int from learn_member_history h where h.tenant_id=t.id) as member_events,
    (select count(*)::int from operating_profile_entries e where e.tenant_id=t.id and e.namespace='learn_scorecards') as revisions,
    (select count(*)::int from learn_scorecard_publications p where p.tenant_id=t.id) as publications
    from tenants t where t.id in (${plan.tenants.map(t=>q(t.id)).join(',')}) and t.metadata->>'learn_rules_acceptance_run'=${q(plan.runId)} order by t.id`,true);
   if(!failure){
    const a=retainedSummary?.find(r=>r.tenant_id===plan.tenants[0].id),b=retainedSummary?.find(r=>r.tenant_id===plan.tenants[1].id);
    check(retainedSummary?.length===2&&a.members===1&&a.member_events===2&&a.revisions===2&&a.publications===2&&b.members===1&&b.member_events===1&&b.revisions===1&&b.publications===0,'Retained synthetic evidence counts differ');
   }
   plan.retainedSummary=retainedSummary;saveManifest();
  }catch{cleanupErrors.push('Login absence or retained evidence not verified');}
 }
 return {version:'learn-test-rules-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,conflictSourceSha256:CONFLICT_SOURCE_SHA256,observedAt:new Date().toISOString(),runId:plan.runId,
  state:!failure&&!cleanupErrors.length?'passed_retained_synthetic_acceptance':'requires_inspection',checks,failure,lastOperation,
  testLoginsRemoved:cleanupErrors.length===0,cleanupErrors,retainedSummary,fixtureManifest:manifest,
  limitations:['Marked synthetic companies, teams, rule revisions/publications and member history are deliberately retained in TEST; test logins and profiles are removed.',
   'No production, actual employee scores, source communications, audio, provider activity, payroll or full UI acceptance is established.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  check(process.argv.slice(2).join(' ')==='--retained-synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit retained synthetic TEST acceptance required');
  const r=await acceptRules({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed_retained_synthetic_acceptance')process.exitCode=1;
 }catch(e){console.error(e.message);process.exitCode=1;}
}
