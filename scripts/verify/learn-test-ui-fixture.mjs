/** Retained synthetic company for the actual TEST browser. No real records or provider calls. */
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {readActionsCatalog} from './learn-actions-catalog.mjs';
import {installedActions} from './learn-test-actions-release.mjs';
import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';
const [mode,path]=process.argv.slice(2),check=(ok,s)=>{if(!ok)throw Error(s);};
check(['create','retire','inspect'].includes(mode)&&path?.startsWith('/private/tmp/serviceos-learn-ui-')&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit TEST fixture command and manifest required');
const token=savedCliToken(),catalog=await readActionsCatalog({allowProjectRef:TEST_PROJECT,token});
check(installedActions(catalog),'Exact installed TEST schema required');
const base=`https://${TEST_PROJECT}.supabase.co`,management={Authorization:`Bearer ${token}`,'Content-Type':'application/json'},q=s=>`'${String(s).replaceAll("'","''")}'`;
async function request(url,headers,method='GET',body){const r=await fetch(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});const data=await r.json();check(r.ok,`TEST fixture request failed (HTTP ${r.status})`);return data;}
const sql=(query,readOnly=false)=>request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,management,'POST',{query,...(readOnly?{}:{read_only:false})});
const auth=await sql(AUTH_CONTRACT_QUERY,true);check(auth?.length===1&&actionAuthContractMatches(auth[0].contract),'Auth fixture contract differs');
const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,management);
const service=keys.filter(x=>x.name==='service_role');check(service.length===1,'Unique existing TEST service credential required');
const key=service[0].api_key,claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());check(claims.ref===TEST_PROJECT&&claims.role==='service_role','Credential target differs');
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
let plan;
const save=()=>writeFileSync(path,JSON.stringify(plan,null,2),{mode:0o600});
if(mode==='create'){
 const password=readFileSync(0,'utf8').trim();check(password.length>=32,'Synthetic browser password required on stdin');
 plan={version:'learn-test-ui-fixture/1',projectRef:TEST_PROJECT,runId:randomUUID(),tenant:randomUUID(),user:randomUUID(),team:randomUUID(),members:[randomUUID(),randomUUID()],object:randomUUID(),createdAt:new Date().toISOString(),accessRevoked:false};
 plan.email=`learn-ui-${plan.runId}@example.invalid`;
 writeFileSync(path,JSON.stringify(plan,null,2),{mode:0o600,flag:'wx'});
 const user=await request(`${base}/auth/v1/admin/users`,headers,'POST',{id:plan.user,email:plan.email,password,email_confirm:true,app_metadata:{learn_ui_run:plan.runId}});check(user.id===plan.user,'Synthetic identity differs');
 await sql(`begin;insert into tenants(id,slug,display_name,metadata) values(${q(plan.tenant)},${q('learn-ui-'+plan.runId)},'SYNTHETIC browser review',jsonb_build_object('learn_ui_run',${q(plan.runId)},'synthetic',true,'timezone','Europe/London'));update profiles set tenant_id=${q(plan.tenant)},role='owner' where id=${q(plan.user)} and email=${q(plan.email)};insert into org_units(id,tenant_id,kind,name) values(${q(plan.team)},${q(plan.tenant)},'team','SYNTHETIC office');insert into team_members(id,tenant_id,org_unit_id,profile_id,display_name,confirmed_at,effective_from) values(${q(plan.members[0])},${q(plan.tenant)},${q(plan.team)},${q(plan.user)},'SYNTHETIC coordinator',clock_timestamp(),clock_timestamp()),(${q(plan.members[1])},${q(plan.tenant)},${q(plan.team)},null,'SYNTHETIC colleague',clock_timestamp(),clock_timestamp());commit;`);
 const clock=await sql("select (date_trunc('second',clock_timestamp())+interval '1 second')::text as start",true);plan.start=new Date(clock[0].start).toISOString();save();
 // Start after membership was observed; capture begins after that boundary, with no invented backfill.
 await sql(`select pg_sleep(greatest(0,extract(epoch from ${q(plan.start)}::timestamptz-clock_timestamp())));`);
 await sql(`insert into intelligence_objects(id,tenant_id,domain,object_type,subject,status,responsible_ref,attributes) values(${q(plan.object)},${q(plan.tenant)},'serviceos','Action','SYNTHETIC browser handoff','ready',jsonb_build_object('kind','member','ref',${q(plan.members[0])}),'{"done_when":"Synthetic confirmation"}');`);
 await sql(`update intelligence_objects set responsible_ref=jsonb_build_object('kind','member','ref',${q(plan.members[1])}),version=version+1 where id=${q(plan.object)} and tenant_id=${q(plan.tenant)};`);
 plan.seeded=true;save();console.log(JSON.stringify(plan,null,2));
}else{
 plan=JSON.parse(readFileSync(path,'utf8'));check(plan.version==='learn-test-ui-fixture/1'&&plan.projectRef===TEST_PROJECT&&plan.email===`learn-ui-${plan.runId}@example.invalid`,'Manifest scope differs');
 const user=await request(`${base}/auth/v1/admin/users/${plan.user}`,headers);check(user.id===plan.user&&user.email===plan.email&&user.app_metadata?.learn_ui_run===plan.runId,'Synthetic actor marker differs');
 const tenant=await sql(`select id from tenants where id=${q(plan.tenant)} and metadata->>'learn_ui_run'=${q(plan.runId)}`,true);check(tenant.length===1,'Synthetic tenant marker differs');
 if(mode==='retire'){
  await sql(`begin;update team_members set effective_to=coalesce(effective_to,clock_timestamp()) where tenant_id=${q(plan.tenant)} and id in (${plan.members.map(q).join(',')});update profiles set role='viewer' where id=${q(plan.user)} and tenant_id=${q(plan.tenant)};commit;`);
  const ban=await request(`${base}/auth/v1/admin/users/${plan.user}`,headers,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(Date.parse(ban.banned_until)>Date.now()+86400000,'Synthetic login ban unverified');
  const active=await sql(`select count(*)::int as active from profiles p where p.id=${q(plan.user)} and (p.role<>'viewer' or exists(select 1 from team_members m where m.tenant_id=${q(plan.tenant)} and (m.effective_to is null or m.effective_to>clock_timestamp())))`,true);check(active[0].active===0,'Synthetic authority remains active');
  plan.accessRevoked=true;plan.retiredAt=new Date().toISOString();save();
 }
 const summary=await sql(`select (select count(*) from intelligence_objects where tenant_id=${q(plan.tenant)})::int as work_items,(select count(*) from object_state_history where tenant_id=${q(plan.tenant)} and capture_kind is not null)::int as captures,(select count(*) from measurements where tenant_id=${q(plan.tenant)})::int as measurements,(select count(*) from learn_work_measurement_runs where tenant_id=${q(plan.tenant)})::int as receipts`,true);
 console.log(JSON.stringify({projectRef:TEST_PROJECT,runId:plan.runId,accessRevoked:plan.accessRevoked,retained:summary[0]},null,2));
}
