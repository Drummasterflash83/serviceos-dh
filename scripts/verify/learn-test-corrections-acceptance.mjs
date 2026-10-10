/** Actual Auth/PostgREST correction acceptance. Synthetic evidence is retained, access retired. */
import {randomUUID,randomBytes} from 'node:crypto';import {writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {readCorrectionCatalog} from './learn-performance-corrections-catalog.mjs';
import {installedCorrections,CORRECTION_SHA} from './learn-test-corrections-release.mjs';
import {communicationQuery} from './learn-card-communication-catalog.mjs';
import {measurementFixturePlan,measurementSeedSql,measurementDefinition} from './learn-test-measurements-acceptance.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';
import {readAcceptanceResponse} from './learn-test-launch-acceptance.mjs';import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {loadPerformanceMeasurements} from '../../src/lib/learn-performance-measurements.ts';
import {correctPerformanceMeasurement} from '../../src/lib/learn-performance-corrections.ts';import {evaluateScorecard} from '../../src/lib/learn-scorecards.ts';
const q=s=>`'${String(s).replaceAll("'","''")}'`,check=(ok,label)=>{if(!ok)throw Error(label);},base=`https://${TEST_PROJECT}.supabase.co`;
export function correctionArgs(tenant,measurement,request,revision,value,reason='Synthetic arithmetic correction') {return {p_tenant:tenant,p_measurement:measurement,p_request:request,p_expected_review_revision:revision,p_value:value,p_reason:reason};}
export async function acceptCorrections({allowProjectRef,token,fetcher=fetch}){
 check(installedCorrections(await readCorrectionCatalog({allowProjectRef,token,fetcher})),'Exact installed TEST correction release required');
 const sql=(query,readOnly=false)=>communicationQuery(token,query,{fetcher,readOnly});
 check(actionAuthContractMatches((await sql(AUTH_CONTRACT_QUERY,true))[0]?.contract),'Auth fixture contract differs');
 async function request(url,headers,method='GET',body){return readAcceptanceResponse(await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)}));}
 const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{Authorization:`Bearer ${token}`});check(keys.ok&&Array.isArray(keys.data),'Existing TEST keys unavailable');
 const key=role=>{const rows=keys.data.filter(k=>k.name===role);check(rows.length===1,'Unique TEST credential required');const value=rows[0].api_key,claims=JSON.parse(Buffer.from(value.split('.')[1],'base64url'));check(claims.ref===TEST_PROJECT&&claims.role===role,'Credential target differs');return value;};
 const anon=key('anon'),service=key('service_role'),headers=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})}),adminHeaders={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
 const plan=measurementFixturePlan();plan.purpose='Retained numerical correction acceptance';plan.corrections=[];
 const manifest=`/private/tmp/serviceos-learn-corrections-${plan.runId}.json`,save=()=>writeFileSync(manifest,JSON.stringify(plan,null,2)+'\n',{mode:0o600});save();
 const [a,b]=plan.tenants,[owner,admin,viewer,foreign]=plan.users,sessions=new Map(),checks=[],cleanupErrors=[];
 const tenants=plan.tenants.map(t=>q(t.id)).join(',');let before=null,after=null,failure=null,retained=null;
 const sourceTables=['email_messages','phone_calls','phone_recordings','phone_transcripts','slack_messages','slack_message_versions','interactions','measurements','learn_performance_reviews','learn_performance_corrections'];
 const snapshot=async()=> (await sql(sourceTables.map(t=>`select '${t}' as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${t} s where tenant_id not in (${tenants})`).join(' union all '),true)).sort((a,b)=>a.name.localeCompare(b.name));
 const rpc=(jwt,name,args)=>request(`${base}/rest/v1/rpc/${name}`,headers(jwt),'POST',args);
 const correct=(jwt,args)=>rpc(jwt,'learn_performance_correct',args);
 const deny=(r,code,label)=>check(!r.ok&&r.data?.code===code&&(code!=='PT409'||r.status===409),label);
 const review=(jwt,id,revision=0)=>rpc(jwt,'learn_performance_review',{p_tenant_id:a.id,p_measurement_id:id,p_request_id:randomUUID(),p_expected_revision:revision,p_decision:'confirmed',p_reason:'Synthetic source and calculation checked'});
 const read=(jwt,table)=>request(`${base}/rest/v1/${table}?select=*&tenant_id=eq.${a.id}`,headers(jwt));
 try{
  before=await snapshot();plan.sourceBefore=before;save();
  for(const u of plan.users){const password=randomBytes(36).toString('base64url');const made=await request(`${base}/auth/v1/admin/users`,adminHeaders,'POST',{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_measurements_acceptance_run:plan.runId,learn_corrections_acceptance_run:plan.runId}});check(made.ok&&made.data?.id===u.id,'Synthetic Auth creation failed');const login=await request(`${base}/auth/v1/token?grant_type=password`,headers(),'POST',{email:u.email,password});check(login.ok&&login.data?.user?.id===u.id,'Synthetic sign-in failed');sessions.set(u.id,login.data.access_token);}
  await sql(measurementSeedSql(plan));plan.seeded=true;save();
  for(const t of plan.tenants){const u=plan.users.find(u=>u.tenant===t.id&&u.role==='owner');const r=await request(`${base}/rest/v1/team_members`,adminHeaders,'POST',{id:t.member,tenant_id:t.id,org_unit_id:t.team,profile_id:u.id,display_name:'SYNTHETIC correction subject',confirmed_at:new Date().toISOString(),effective_from:new Date(Date.now()-86400000).toISOString()});check(r.status===201,'Synthetic member creation failed');}
  const ownerJwt=sessions.get(owner.id),adminJwt=sessions.get(admin.id);
  const draft=await rpc(ownerJwt,'learn_scorecard_save_draft',{p_tenant_id:a.id,p_expected_version:0,p_definition:{...measurementDefinition(),groupId:a.team},p_reason:'Synthetic correction criteria'});check(draft.ok&&draft.data?.version===1,'Synthetic policy creation failed');const policy=draft.data;plan.policies.A=policy.id;
  const dates=(await sql(`select date_trunc('milliseconds',min(observed_at))+interval '1 millisecond' as start,date_trunc('milliseconds',clock_timestamp()) as "end" from learn_member_history where tenant_id=${q(a.id)} and member_id=${q(a.member)}`,true))[0];check(Date.parse(dates.end)>Date.parse(dates.start),'Observed membership window unavailable');
  const observed=(await sql('select clock_timestamp()::text as now',true))[0].now;
  const measurement={id:randomUUID(),tenantId:a.id,policyId:policy.id,policyVersion:1,subject:{kind:'member',id:a.member},period:dates,metricKey:'response.minutes',value:30,unit:'minutes',sourceSystem:'synthetic.communications',sourceThrough:dates.end,observedAt:observed,sampleCount:10,coveredCount:10,eligibleCount:10,review:'inferred',evidence:[{table:'team_members',id:a.member}],exclusions:[]};
  plan.originalMeasurement=measurement.id;save();
  let r=await request(`${base}/rest/v1/rpc/learn_performance_append`,adminHeaders,'POST',{p_tenant_id:a.id,p_measurement:measurement,p_reason:'Synthetic retained source'});check(r.ok&&r.data?.measurementId===measurement.id,'Synthetic source append failed');
  r=await review(ownerJwt,measurement.id);check(r.ok&&r.data?.revision===1,'Original review failed');
  const originalRows=(await read(ownerJwt,'measurements')).data,originalReviews=(await read(ownerJwt,'learn_performance_reviews')).data;
  const id=randomUUID(),args=correctionArgs(a.id,measurement.id,id,1,20);plan.corrections.push(id);save();
  for(const jwt of [sessions.get(viewer.id),sessions.get(foreign.id)])deny(await correct(jwt,args),'42501','Unauthorised correction accepted');
  check([401,403].includes((await correct(undefined,args)).status),'Anonymous correction accepted');
  deny(await request(`${base}/rest/v1/rpc/learn_performance_correct`,adminHeaders,'POST',args),'42501','Service credential can invoke human correction');
  deny(await correct(ownerJwt,{...args,p_expected_review_revision:0}),'PT409','Stale review correction accepted');
  // A later transfer must not erase the observed team attribution for the earlier period.
  const laterTeam=randomUUID();plan.laterTeam=laterTeam;save();await sql(`insert into org_units(id,tenant_id,kind,name) values(${q(laterTeam)},${q(a.id)},'team','SYNTHETIC later team');`);
  r=await request(`${base}/rest/v1/team_members?id=eq.${a.member}`,adminHeaders,'PATCH',{org_unit_id:laterTeam});check(r.status===204,'Synthetic transfer failed');
  const client=createClient(base,anon,{global:{fetch:fetcher,headers:{Authorization:`Bearer ${ownerJwt}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const requestData={tenantId:a.id,measurementId:measurement.id,requestId:id,expectedReviewRevision:1,value:20,reason:args.p_reason};
  check(!(await correctPerformanceMeasurement(client,requestData)).reused,'First correction unexpectedly reused');
  check((await correctPerformanceMeasurement(client,requestData)).reused,'Same-request retry duplicated');
  deny(await correct(ownerJwt,{...args,p_value:21}),'PT409','Changed request reused');
  deny(await correct(ownerJwt,{...args,p_request:randomUUID()}),'PT409','Competing successor accepted');
  let loaded=await loadPerformanceMeasurements(client,policy,measurement.subject,dates),corrected=loaded.find(m=>m.id===id);
  check(loaded.length===2&&corrected?.review==='inferred'&&corrected.correction?.corrected_by===owner.id&&Date.parse(corrected.sourceObservedAt)===Date.parse(observed),'Actual reader lost correction provenance or inferred state');
  const assessmentSubject=corrected.subject;
  check(evaluateScorecard(policy,assessmentSubject,dates,loaded,Date.now()).previewScore===null,'Unreviewed correction produced a score');
  r=await review(adminJwt,id);check(r.ok&&r.data?.revision===1,'Separate admin review failed');
  loaded=await loadPerformanceMeasurements(client,policy,measurement.subject,dates);check(Math.abs(evaluateScorecard(policy,assessmentSubject,dates,loaded,Date.now()).previewScore-100/3)<1e-9,'Reviewed corrected draft simulation differs');
  checks.push('Actual application correction RPC and reader passed exact retry, stale/changed request/fork denial, original timing, separate review and earlier-team attribution after transfer.');
  const raceIds=[randomUUID(),randomUUID()];plan.corrections.push(...raceIds);save();
  const race=await Promise.all(raceIds.map((rid,i)=>correct(i?adminJwt:ownerJwt,correctionArgs(a.id,id,rid,1,10+i))));
  check(race.filter(r=>r.ok).length===1&&race.filter(r=>r.status===409&&r.data?.code==='PT409').length===1,'Concurrent corrections did not retain exactly one successor');
  const winner=race.find(r=>r.ok).data.measurementId,withheld=randomUUID();plan.corrections.push(withheld);save();
  r=await correct(ownerJwt,correctionArgs(a.id,winner,withheld,0,null,'Synthetic withholding pending clarification'));check(r.ok&&r.data?.measurementId===withheld,'Explicit withholding failed');
  loaded=await loadPerformanceMeasurements(client,policy,measurement.subject,dates);check(loaded.length===4&&loaded.find(m=>m.id===withheld)?.value===null&&loaded.filter(m=>m.correction).every(m=>Date.parse(m.sourceObservedAt)===Date.parse(observed)),'Withheld correction chain differs');
  check(evaluateScorecard(policy,assessmentSubject,dates,loaded,Date.now()).previewScore===null,'Withheld value produced score');
  const raw=(await read(ownerJwt,'measurements')).data,reviews=(await read(ownerJwt,'learn_performance_reviews')).data;
  check(JSON.stringify(raw.find(m=>m.id===measurement.id))===JSON.stringify(originalRows[0])&&JSON.stringify(reviews.find(r=>r.id===originalReviews[0].id))===JSON.stringify(originalReviews[0]),'Original measurement or review changed');
  check(raw.every(m=>m.review_state==='inferred'),'Stored source review state changed');
  for(const u of [viewer,foreign])for(const table of ['measurements','learn_performance_reviews','learn_performance_corrections']){r=await read(sessions.get(u.id),table);check(r.ok&&r.data?.length===0,'Performance data leaked');}
  r=await request(`${base}/rest/v1/learn_performance_corrections`,adminHeaders,'POST',{id:randomUUID()});deny(r,'42501','Direct service ledger write accepted');
  await sql(`do $$ begin begin update learn_performance_corrections set reason='rewrite' where id=${q(id)};raise exception 'Correction rewrite accepted';exception when restrict_violation then null;end;begin delete from learn_performance_corrections where id=${q(id)};raise exception 'Correction deletion accepted';exception when restrict_violation then null;end;end $$;`);
  await sql(`insert into view_as_context(id,tenant_id,actor_user_id,subject_kind,subject_ref) values(${q(a.preview)},${q(a.id)},${q(owner.id)},'role','viewer');`);
  deny(await correct(ownerJwt,correctionArgs(a.id,withheld,randomUUID(),0,5)),'42501','View-As correction accepted');
  await sql(`update view_as_context set ended_at=clock_timestamp() where id=${q(a.preview)};update profiles set role='viewer' where id=${q(owner.id)} and tenant_id=${q(a.id)};`);
  deny(await correct(ownerJwt,correctionArgs(a.id,withheld,randomUUID(),0,5)),'42501','Revoked session retained correction authority');
  r=await read(ownerJwt,'learn_performance_corrections');check(r.ok&&r.data?.length===0,'Revoked session retained correction reads');
  checks.push('Real concurrent requests retained one successor; NULL withholding retained four observations and two reviews; original rows stayed unchanged. Tenant/role, direct-write, immutable-ledger, View-As and same-session revocation checks passed.');
 }catch(e){failure=e instanceof Error?e.message:'Correction acceptance failed';}
 finally{
  try{after=await snapshot();check(before&&JSON.stringify(before)===JSON.stringify(after),'Existing source/measurement fingerprints differ');}catch{cleanupErrors.push('Pre-existing source preservation requires inspection');}
  try{await sql(`begin;update view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id in (${plan.tenants.map(t=>q(t.preview)).join(',')});update profiles set role='viewer' where id in (${plan.users.map(u=>q(u.id)).join(',')}) and exists(select 1 from auth.users a where a.id=profiles.id and a.raw_app_meta_data->>'learn_corrections_acceptance_run'=${q(plan.runId)});update team_members set effective_to=coalesce(effective_to,clock_timestamp()) where tenant_id in (${tenants});commit;`);}catch{cleanupErrors.push('Synthetic profile/member/preview retirement requires inspection');}
  for(const u of plan.users){try{const found=await request(`${base}/auth/v1/admin/users/${u.id}`,adminHeaders);if(found.status===404)continue;check(found.ok&&found.data?.email===u.email&&found.data?.app_metadata?.learn_corrections_acceptance_run===plan.runId,'Fixture identity differs');const banned=await request(`${base}/auth/v1/admin/users/${u.id}`,adminHeaders,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(banned.ok&&Date.parse(banned.data?.banned_until)>Date.now()+86400000,'Synthetic ban unverified');}catch{cleanupErrors.push('Synthetic Auth retirement requires inspection: '+u.id);}}
  try{retained=(await sql(`select (select count(*)::int from measurements where tenant_id in (${tenants})) as measurements,(select count(*)::int from learn_performance_reviews where tenant_id in (${tenants})) as reviews,(select count(*)::int from learn_performance_corrections where tenant_id in (${tenants})) as corrections,(select count(*)::int from auth.users a left join profiles p on p.id=a.id where a.id in (${plan.users.map(u=>q(u.id)).join(',')}) and (a.banned_until is null or a.banned_until<=clock_timestamp()+interval '1 day' or p.role is distinct from 'viewer')) as active_users,(select count(*)::int from team_members where tenant_id in (${tenants}) and (effective_to is null or effective_to>clock_timestamp())) as active_members`,true))[0];check(retained.active_users===0&&retained.active_members===0,'Synthetic access remains active');if(!failure)check(retained.measurements===4&&retained.reviews===2&&retained.corrections===3,'Retained fixture counts differ');}catch{cleanupErrors.push('Retention or retired access readback requires inspection');}
  plan.retained=retained;plan.accessRevoked=cleanupErrors.length===0;save();
 }
 return {version:'learn-test-corrections-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:CORRECTION_SHA,observedAt:new Date().toISOString(),runId:plan.runId,state:failure||cleanupErrors.length?'requires_inspection':'passed',checks,failure,cleanupErrors,retained,preExistingSourcesPreserved:before!==null&&after!==null&&JSON.stringify(before)===JSON.stringify(after),fixtureManifest:manifest,limitations:['Actual Auth/PostgREST/application readers with retained synthetic TEST evidence, not real employee measurements or provider capture.','No production changes, paid processing, schedules, source ingestion or payroll.','Browser behavior was tested separately with local synthetic fixtures.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--accept --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST correction acceptance required');const r=await acceptCorrections({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
