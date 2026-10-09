/** Actual TEST endpoint, Auth JWTs and card readers. Retain marked evidence;
 * end synthetic membership/authority, ban logins and revoke roles afterward. */
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {readActionsCatalog} from './learn-actions-catalog.mjs';
import {installedActions,expectedActions} from './learn-test-actions-release.mjs';
import {SOURCE_SHA256} from './learn-test-actions-rehearsal.mjs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';
import {readAcceptanceResponse} from './learn-test-launch-acceptance.mjs';
import {loadWorkTimeline} from '../../src/lib/learn-work-history.ts';
import {loadPerformanceMeasurements} from '../../src/lib/learn-performance-measurements.ts';
import {workDefinition} from './learn-test-work-acceptance.mjs';
const ORIGIN=`https://${TEST_PROJECT}.supabase.co`,q=s=>`'${String(s).replaceAll("'","''")}'`;
const check=(ok,label)=>{if(!ok)throw Error(label);};
const canonical=v=>Array.isArray(v)?v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const expectedAuth=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json',import.meta.url)));
export function actionAuthContractMatches(contract){
 const copy=structuredClone(contract),e=expectedActions();
 for(const name of ['tenants','profiles']){
  const table=copy?.tables?.find(t=>t.name===name);if(!table)return false;
  for(const trigger of ['learn_work_authority_input_lock','learn_work_authority_truncate_lock']){
   const found=table.triggers.find(t=>t.name===trigger),wanted=e.tables.find(t=>t.name===name).triggers.find(t=>t.name===trigger);
   if(!found||found.definition!==wanted.definition||found.function!==e.functions.find(f=>f.name===wanted.function)?.definition)return false;
   table.triggers=table.triggers.filter(t=>t.name!==trigger);
  }
 }
 return digest(copy)===digest(expectedAuth);
}
export const serviceActorDenied=r=>!r.ok&&r.data?.ok===false&&((r.status===401&&r.data?.error?.code==='internal_auth_mismatch')||(r.status===403&&r.data?.error?.code==='forbidden'));
export function actionFixturePlan(){
 const runId=randomUUID(),tenants=['A','B'].map(label=>({label,id:randomUUID(),team:randomUUID()}));
 const users=[['owner',0,'owner'],['viewer',0,'staff'],['viewer',0,'cover'],['ops',0,'manager'],['viewer',0,'unregistered'],['owner',1,'foreign']].map(([role,t,label],i)=>({id:randomUUID(),tenant:tenants[t].id,role,label,email:`learn-actions-${runId}-${i}@example.invalid`}));
 const members=['staff','cover','manager','foreign'].map(label=>{const u=users.find(x=>x.label===label);return {id:randomUUID(),tenant:u.tenant,team:tenants.find(t=>t.id===u.tenant).team,profile:u.id,label};});
 members.push({id:randomUUID(),tenant:tenants[0].id,team:randomUUID(),profile:null,label:'otherTeam'});
 return {version:'learn-test-action-fixtures/1',projectRef:TEST_PROJECT,runId,tenants,users,members,objects:Array.from({length:5},()=>randomUUID()),grant:randomUUID(),cover:randomUUID(),preview:randomUUID(),measurement:randomUUID(),retention:'Retain all marked work/captures/annotations/measurements and actor identities; end synthetic membership, grants and cover and ban synthetic logins.'};
}
export async function acceptActions({allowProjectRef,token,fetcher=fetch}){
 const pre=await readActionsCatalog({allowProjectRef,token,fetcher});check(installedActions(pre),'Exact installed TEST actions required');
 check(pre.base.functions.some(f=>f.slug==='work-transition'&&f.status==='ACTIVE'&&f.verify_jwt===true),'JWT-protected TEST action endpoint required');
 async function request(url,{method='GET',headers={},body}={}){const r=await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});return readAcceptanceResponse(r);}
 const management={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 async function sql(query,readOnly=false){const r=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,{method:'POST',headers:management,body:{query,...(readOnly?{}:{read_only:false})}});check(r.ok,`Synthetic action SQL failed (HTTP ${r.status})`);return r.data;}
 const auth=await sql(AUTH_CONTRACT_QUERY,true);check(auth?.length===1&&actionAuthContractMatches(auth[0].contract),'TEST Auth fixture contract differs beyond reviewed authority guards');
 const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:management});check(keys.ok&&Array.isArray(keys.data),'Existing TEST keys unavailable');
 function keyFor(role){const rows=keys.data.filter(k=>k.name===role&&typeof k.api_key==='string');check(rows.length===1,'Existing TEST key unavailable');const key=rows[0].api_key;let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{}check(claims?.ref===TEST_PROJECT&&claims?.role===role,'Existing key scope differs');return key;}
 const anon=keyFor('anon'),service=keyFor('service_role'),userHeaders=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})}),adminHeaders={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
 const plan=actionFixturePlan(),manifest=`/private/tmp/serviceos-learn-actions-fixtures-${plan.runId}.json`,sessions=new Map(),checks=[],cleanupErrors=[];
 const save=()=>writeFileSync(manifest,JSON.stringify(plan,null,2),{mode:0o600});save();let failure=null,lastOperation=null,failureOperation=null,retainedSummary=null;
 const pass=s=>checks.push(s),user=label=>plan.users.find(u=>u.label===label),member=label=>plan.members.find(m=>m.label===label),jwt=label=>sessions.get(user(label).id),a=plan.tenants[0];
 const read=(session,path)=>request(`${ORIGIN}/rest/v1/${path}`,{headers:userHeaders(session)});
 const rpc=(session,name,args)=>request(`${ORIGIN}/rest/v1/rpc/${name}`,{method:'POST',headers:userHeaders(session),body:args});
 const act=async(label,index,version,verb,extra={})=>{lastOperation={label,index,version,verb};plan.lastOperation=lastOperation;save();return request(`${ORIGIN}/functions/v1/work-transition`,{method:'POST',headers:userHeaders(jwt(label)),body:{object_id:plan.objects[index],expected_version:version,verb,...extra}});};
 const success=(r,version,label)=>check(r.ok&&r.data?.ok&&r.data.version===version&&typeof r.data.history_id==='string',label);
 const denied=(r,status,label)=>check(!r.ok&&r.status===status,label+` (HTTP ${r.status}, ${r.data?.error?.code??r.data?.code??'unknown'})`);
 const roundedNow=async()=>{const r=await sql("select date_trunc('milliseconds',clock_timestamp())::text as now",true);return new Date(r[0].now).toISOString();};
 try{
  for(const u of plan.users){const password=randomBytes(32).toString('base64url');const made=await request(`${ORIGIN}/auth/v1/admin/users`,{method:'POST',headers:adminHeaders,body:{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_action_acceptance_run:plan.runId}}});check(made.ok&&made.data?.id===u.id,'Synthetic user creation failed');const login=await request(`${ORIGIN}/auth/v1/token?grant_type=password`,{method:'POST',headers:userHeaders(),body:{email:u.email,password}});check(login.ok&&login.data?.user?.id===u.id&&typeof login.data.access_token==='string','Synthetic sign-in failed');sessions.set(u.id,login.data.access_token);}
  let seed="begin;set local statement_timeout='15s';";
  for(const t of plan.tenants)seed+=`insert into tenants(id,slug,display_name,metadata) values(${q(t.id)},${q('learn-action-qa-'+plan.runId+'-'+t.label)},'SYNTHETIC RETAINED action acceptance',jsonb_build_object('learn_action_acceptance_run',${q(plan.runId)},'synthetic',true,'timezone','Europe/London'));insert into org_units(id,tenant_id,kind,name) values(${q(t.team)},${q(t.id)},'team','SYNTHETIC action team');`;
  seed+=`insert into org_units(id,tenant_id,kind,name) values(${q(member('otherTeam').team)},${q(a.id)},'team','SYNTHETIC other team');`;
  for(const u of plan.users)seed+=`update profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users v where v.id=p.id and v.raw_app_meta_data->>'learn_action_acceptance_run'=${q(plan.runId)});do $$begin if not exists(select 1 from profiles where id=${q(u.id)} and tenant_id=${q(u.tenant)} and role=${q(u.role)}) then raise exception 'Synthetic binding failed';end if;end $$;`;
  for(const m of plan.members)seed+=`insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values(${q(m.id)},${q(m.tenant)},${q(m.team)},${m.profile?q(m.profile):'null'},'SYNTHETIC action member',now()-interval '1 day',now()-interval '1 day');`;
  seed+=`insert into authority_grants(id,tenant_id,member_id,permission,scope,scope_ref,confirmed,effective_from) values(${q(plan.grant)},${q(a.id)},${q(member('manager').id)},'work.assign','team',${q(a.team)},true,now()-interval '1 day');insert into responsibility_assignments(id,tenant_id,member_id,kind,label,raci_role,cover_for,weekday_mask,confirmed,effective_from) values(${q(plan.cover)},${q(a.id)},${q(member('cover').id)},'cover','SYNTHETIC cover','responsible',${q(member('staff').id)},127,true,now()-interval '1 day');commit;select 'synthetic_seeded' as state;`;
  await sql(seed);pass('Six synthetic Auth sessions, two marked companies and scoped roster/cover fixtures established');
  const start=await roundedNow();plan.start=start;save();
  for(const id of plan.objects){const r=await request(`${ORIGIN}/rest/v1/intelligence_objects`,{method:'POST',headers:adminHeaders,body:{id,tenant_id:a.id,domain:'serviceos',object_type:'Action',subject:'SYNTHETIC retained action',status:'ready',responsible_ref:{kind:'member',ref:member('staff').id},attributes:{done_when:'Recorded synthetic confirmation',preserved:'Original synthetic fact'}}});check(r.status===201,'Synthetic action creation failed');}
  denied(await request(`${ORIGIN}/functions/v1/work-transition`,{method:'POST',headers:userHeaders(),body:{}}),401,'Anonymous action');
  check(serviceActorDenied(await request(`${ORIGIN}/functions/v1/work-transition`,{method:'POST',headers:{...adminHeaders,'x-internal-tenant-id':a.id},body:{}})),'Service credential was not refused as a signed-in actor');
  denied(await act('foreign',0,1,'start'),404,'Foreign company action');
  denied(await act('unregistered',0,1,'start'),403,'Viewer without staff acted');
  denied(await act('owner',0,1,'start'),403,'Owner role bypassed item authority');
  const direct=await rpc(jwt('staff'),'work_transition_apply',{p_tenant:a.id,p_object:plan.objects[0],p_expected_version:1,p_to_status:'in_progress',p_patch:{},p_history:{verb:'start',actor:{user_id:user('staff').id}},p_objective:null});check(!direct.ok&&[403,404].includes(direct.status)&&['42501','PGRST202'].includes(direct.data?.code),'Browser persistence RPC denial was not verified');
  success(await act('staff',0,1,'start'),2,'Staff start failed');
  denied(await act('staff',0,1,'start'),409,'Stale action revision accepted');
  denied(await act('staff',0,2,'wait'),400,'Wait without note accepted');
  denied(await act('staff',0,2,'complete'),400,'Completion without evidence accepted');
  success(await act('staff',0,2,'wait',{evidence:'Waiting for synthetic confirmation'}),3,'Wait failed');
  success(await act('staff',0,3,'resume'),4,'Resume failed');
  success(await act('staff',0,4,'complete',{evidence:'Synthetic source confirmed'}),5,'Completion failed');
  pass('Real HTTP authentication, staff self-service, evidence requirements and stale revisions enforced');
  denied(await act('manager',1,1,'assign',{target_member_ref:member('otherTeam').id}),403,'Cross-team assignment accepted');
  denied(await act('manager',1,1,'assign',{target_member_ref:member('foreign').id}),400,'Foreign target accepted');
  success(await act('manager',1,1,'assign',{target_member_ref:member('cover').id}),2,'Scoped assignment failed');
  // Cover remains valid for staff-owned work, but ownership has actually moved here.
  denied(await act('staff',1,2,'start'),403,'Former owner kept authority after handoff');
  success(await act('cover',1,2,'start'),3,'New assignee could not act');
  denied(await act('cover',2,1,'accept'),403,'Temporary cover claimed permanent ownership');
  success(await act('cover',2,1,'start'),2,'Temporary cover action failed');
  let r=await read(jwt('owner'),`object_state_history?select=actor,work_after&object_id=eq.${plan.objects[2]}&transition_verb=eq.start&capture_kind=is.null`);check(r.ok&&r.data?.length===1&&r.data[0].actor.acted_via==='cover'&&r.data[0].actor.cover_assignment_ids.includes(plan.cover)&&r.data[0].work_after.responsible_ref.ref===member('staff').id,'Final cover attribution or preserved owner differs');
  await sql(`update responsibility_assignments set effective_to=clock_timestamp() where id=${q(plan.cover)};`);
  denied(await act('cover',2,2,'wait',{evidence:'No longer authorized'}),403,'Revoked cover retained access');
  success(await act('staff',2,2,'wait',{evidence:'Original owner resumed control'}),3,'Original owner lost access');
  const race=await Promise.all([act('staff',3,1,'start'),act('staff',3,1,'start')]);check(race.filter(x=>x.ok).length===1&&race.filter(x=>x.status===409).length===1,'Concurrent actions did not yield one update and one conflict');
  pass('Scoped assignment, actual handoff, temporary cover attribution, revocation and concurrent action conflict verified through HTTP');
  await sql(`insert into view_as_context(id,tenant_id,actor_user_id,subject_kind,subject_ref) values(${q(plan.preview)},${q(a.id)},${q(user('staff').id)},'user',${q(user('cover').id)});`);
  r=await act('staff',4,1,'start');check(!r.ok&&r.status===409&&r.data?.error?.code==='read_only_view_active','Preview session was not refused as read-only');
  await sql(`update view_as_context set ended_at=clock_timestamp() where id=${q(plan.preview)};update authority_grants set effective_to=clock_timestamp() where id=${q(plan.grant)};`);
  denied(await act('manager',4,1,'assign',{target_member_ref:member('cover').id}),403,'Revoked assignment permission remained usable');
  const end=await roundedNow(),period={start,end};plan.period=period;save();
  const client=createClient(ORIGIN,anon,{global:{fetch:fetcher,headers:{Authorization:`Bearer ${jwt('owner')}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const timeline=await loadWorkTimeline(client,{tenantId:a.id,objectId:plan.objects[0],period});check(timeline.eventCount===5,'Action annotations doubled the canonical timeline');
  const draft=await rpc(jwt('owner'),'learn_scorecard_save_draft',{p_tenant_id:a.id,p_expected_version:0,p_definition:workDefinition(),p_reason:'Synthetic governed-action handoff criteria'});check(draft.ok&&draft.data?.version===1,'Action scorecard draft failed');plan.policy=draft.data.id;save();
  r=await rpc(jwt('owner'),'learn_work_handoffs_collect',{p_tenant:a.id,p_member:member('staff').id,p_policy:draft.data.id,p_revision:1,p_start:start,p_end:end,p_request:plan.measurement,p_reason:'Synthetic governed action handoff'});check(r.ok,'Action handoff collection failed');
  const measures=await loadPerformanceMeasurements(client,draft.data,{kind:'member',id:member('staff').id},period);check(measures.length===1&&measures[0].value===1&&measures[0].coveredCount===5&&measures[0].review==='inferred','Actual card reader missed or doubled the governed handoff');
  await sql(`update team_members set effective_to=clock_timestamp() where id=${q(member('staff').id)};`);
  denied(await act('staff',4,1,'start'),403,'Ended staff membership retained action access');
  pass('Preview, permission and membership revocation enforced; real timeline/card readers show one handoff with retained evidence');
 }catch(e){failure=e.message;failureOperation=lastOperation;}
 finally{
  try{await sql(`begin;update view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id=${q(plan.preview)} and actor_user_id=${q(user('staff').id)};update authority_grants set effective_to=coalesce(effective_to,clock_timestamp()) where id=${q(plan.grant)} and tenant_id=${q(a.id)};update responsibility_assignments set effective_to=coalesce(effective_to,clock_timestamp()) where id=${q(plan.cover)} and tenant_id=${q(a.id)};update team_members set effective_to=coalesce(effective_to,clock_timestamp()) where id in (${plan.members.map(m=>q(m.id)).join(',')}) and tenant_id in (${plan.tenants.map(t=>q(t.id)).join(',')});commit;`);}catch{cleanupErrors.push('Synthetic authority shutdown requires inspection');}
  for(const u of plan.users){try{
   const found=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{headers:adminHeaders});if(found.status===404)continue;
   check(found.ok&&found.data?.id===u.id&&found.data.email===u.email&&found.data.app_metadata?.learn_action_acceptance_run===plan.runId,'Synthetic identity differs');
   await sql(`update profiles set role='viewer' where id=${q(u.id)} and email=${q(u.email)} and exists(select 1 from auth.users x where x.id=profiles.id and x.raw_app_meta_data->>'learn_action_acceptance_run'=${q(plan.runId)});`);
   const ban=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{method:'PUT',headers:adminHeaders,body:{ban_duration:'876000h',password:randomBytes(48).toString('base64url')}});check(ban.ok&&Date.parse(ban.data?.banned_until)>Date.now()+86400000,'Synthetic ban not verified');
   if(sessions.has(u.id)){const deniedAction=await act(u.label,4,1,'start');check([401,403,404].includes(deniedAction.status),'Disabled synthetic JWT retained action access');const evidence=await read(sessions.get(u.id),`measurements?select=id&tenant_id=eq.${u.tenant}`);check(evidence.status===401||evidence.ok&&evidence.data?.length===0,'Revoked JWT retained performance read');}
  }catch{cleanupErrors.push(`Synthetic access revocation requires inspection: ${u.id}`);}}
  try{const ids=plan.users.map(u=>q(u.id)).join(',');const active=await sql(`select count(*)::int as active from auth.users u left join profiles p on p.id=u.id where u.id in (${ids}) and (u.banned_until is null or u.banned_until<=clock_timestamp()+interval '1 day' or p.role is distinct from 'viewer' or exists(select 1 from team_members m where m.profile_id=u.id and (m.effective_to is null or m.effective_to>clock_timestamp())))`,true);check(active[0]?.active===0,'Synthetic login or membership remains active');
   retainedSummary=await sql(`select t.id as tenant_id,(select count(*)::int from profiles p where p.tenant_id=t.id) as profiles,(select count(*)::int from team_members m where m.tenant_id=t.id) as members,(select count(*)::int from intelligence_objects o where o.tenant_id=t.id) as work_items,(select count(*)::int from object_state_history h where h.tenant_id=t.id and h.capture_kind is not null) as captures,(select count(*)::int from object_state_history h where h.tenant_id=t.id and h.capture_kind is null) as annotations,(select count(*)::int from measurements m where m.tenant_id=t.id) as measurements,(select count(*)::int from learn_work_measurement_runs m where m.tenant_id=t.id) as receipts from tenants t where t.id in (${plan.tenants.map(t=>q(t.id)).join(',')}) and t.metadata->>'learn_action_acceptance_run'=${q(plan.runId)} order by t.id`,true);
   if(!failure){const row=retainedSummary.find(t=>t.tenant_id===a.id);check(row?.captures===14&&row.annotations===9&&row.work_items===5&&row.measurements===1&&row.receipts===1,'Retained action evidence counts differ');}
   plan.retainedSummary=retainedSummary;plan.accessRevoked=cleanupErrors.length===0;save();
  }catch{cleanupErrors.push('Final synthetic access/evidence counts require inspection');}
 }
 return {version:'learn-test-actions-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,observedAt:new Date().toISOString(),runId:plan.runId,state:!failure&&!cleanupErrors.length?'passed_retained_synthetic_acceptance':'requires_inspection',checks,failure,lastOperation:failureOperation??lastOperation,testAccessRevoked:cleanupErrors.length===0,cleanupErrors,retainedSummary,fixtureManifest:manifest,limitations:['Synthetic actors and evidence remain in TEST; their memberships/grants/cover end, logins are banned, passwords rotated and roles downgraded.','No production, provider, real employee/pay assessment, or full browser acceptance is established.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{check(process.argv.slice(2).join(' ')==='--retained-synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit retained synthetic TEST acceptance required');const r=await acceptActions({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed_retained_synthetic_acceptance')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
