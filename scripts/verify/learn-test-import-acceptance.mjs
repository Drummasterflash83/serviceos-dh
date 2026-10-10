/** Actual signed-in synthetic governed import acceptance. Never reads real input files. */
import {randomUUID,randomBytes} from 'node:crypto';import {writeFileSync} from 'node:fs';import {pathToFileURL} from 'node:url';
import {TEST_PROJECT,savedCliToken} from './learn-test-readiness.mjs';
import {readGovernedImportCatalog} from './learn-governed-import-catalog.mjs';
import {installedImportEndpoint} from './learn-test-import-endpoint-catalog.mjs';
import {importEndpointBundle,assertImportEndpoint,IMPORT_ENDPOINT_SHA} from './learn-test-import-deploy.mjs';
import {AUTH_CONTRACT_QUERY} from './learn-test-auth-contract.mjs';import {actionAuthContractMatches} from './learn-test-actions-acceptance.mjs';import {readAcceptanceResponse} from './learn-test-launch-acceptance.mjs';
const check=(v,s)=>{if(!v)throw Error(s);},q=s=>`'${String(s).replaceAll("'","''")}'`,base=`https://${TEST_PROJECT}.supabase.co`;
export async function acceptImport({allowProjectRef,token,fetcher=fetch}){
 assertImportEndpoint(importEndpointBundle());const pre=await readGovernedImportCatalog({allowProjectRef,token,fetcher});check(installedImportEndpoint(pre),'Exact installed TEST import schema and endpoint required');
 const management={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 async function request(url,headers,method='GET',body){return readAcceptanceResponse(await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)}));}
 async function sql(query,readOnly=false){const r=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,management,'POST',{query,...(readOnly?{}:{read_only:false})});check(r.ok,`TEST import SQL failed (${r.status})`);return r.data;}
 const auth=await sql(AUTH_CONTRACT_QUERY,true);check(auth?.length===1&&actionAuthContractMatches(auth[0].contract),'Auth fixture contract differs');
 const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,management);check(keys.ok&&Array.isArray(keys.data),'TEST keys unavailable');
 const keyFor=role=>{const k=keys.data.filter(k=>k.name===role);check(k.length===1,'Unique TEST credential required');const v=k[0].api_key,c=JSON.parse(Buffer.from(v.split('.')[1],'base64url').toString());check(c.ref===TEST_PROJECT&&c.role===role,'Credential target differs');return v;};
 const anon=keyFor('anon'),service=keyFor('service_role'),headers=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})}),admin={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
 const plan={version:'learn-test-import-fixture/1',projectRef:TEST_PROJECT,runId:randomUUID(),tenants:[randomUUID(),randomUUID()],users:[],imports:[],context:randomUUID(),accessShutdown:false};
 plan.users=[0,0,1].map((i,n)=>({id:randomUUID(),tenant:plan.tenants[i],role:n===1?'viewer':'owner',email:`learn-import-${plan.runId}-${n}@example.invalid`,created:false}));
 const path=`/private/tmp/serviceos-learn-import-${plan.runId}.json`,save=()=>writeFileSync(path,JSON.stringify(plan,null,2)+'\n',{mode:0o600}),tenant=plan.tenants[0],tenants=plan.tenants.map(q).join(','),sessions=[],checks=[],cleanupErrors=[];save();
 let failure=null,sourceBefore=null,sourceAfter=null,retained=null;
 const edge=(jwt,body)=>request(`${base}/functions/v1/learn-data-import`,{...headers(jwt),...(jwt===service?{'x-internal-tenant-id':tenant}:{})},'POST',{tenant_id:tenant,...body});
 async function expect(jwt,body,status,code){const r=await edge(jwt,body);check(r.status===status,`Import ${body.action}: expected HTTP ${status}, observed ${r.status} (${String(r.data?.error?.code??'no_code').replace(/[^a-z_]/g,'').slice(0,80)})`);if(code)check(r.data?.error?.code===code,`Import ${body.action}: expected ${code}`);return r.data;}
 const tables=['email_messages','phone_calls','phone_recordings','phone_transcripts','slack_messages','slack_message_versions','interactions','sites','jobs','people','companies','contact_points','data_imports','import_entity_links','import_row_results','import_row_provenance','import_conflicts'];
 check(tables.every(n=>pre.tables.some(t=>t.name===n)),'Source snapshot table unavailable in verified TEST catalog');
 async function snapshot(){return(await sql(tables.map(t=>`select ${q(t)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(row_to_json(s)::text),'' order by id),'')) as fingerprint from ${t} s where tenant_id not in (${tenants})`).join(' union all '),true)).sort((a,b)=>a.name.localeCompare(b.name));}
 async function counts(){return(await sql(`select (select count(*)::int from people where tenant_id=${q(tenant)}) as people,(select count(*)::int from sites where tenant_id=${q(tenant)}) as sites,(select count(*)::int from jobs where tenant_id=${q(tenant)}) as jobs`,true))[0];}
 try{
  sourceBefore=await snapshot();plan.sourceBefore=sourceBefore;save();
  for(const u of plan.users){const password=randomBytes(36).toString('base64url'),made=await request(`${base}/auth/v1/admin/users`,admin,'POST',{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_import_run:plan.runId}});check(made.ok&&made.data?.id===u.id,'Synthetic Auth creation failed');u.created=true;save();const login=await request(`${base}/auth/v1/token?grant_type=password`,headers(),'POST',{email:u.email,password});check(login.ok&&login.data?.user?.id===u.id,'Synthetic sign-in failed');sessions.push(login.data.access_token);}
  let seed='begin;';for(const [i,t]of plan.tenants.entries())seed+=`insert into tenants(id,slug,display_name,metadata) values(${q(t)},${q('learn-import-'+plan.runId+'-'+i)},'SYNTHETIC import acceptance',jsonb_build_object('learn_import_run',${q(plan.runId)},'synthetic',true));`;
  for(const u of plan.users)seed+=`update profiles set tenant_id=${q(u.tenant)},role=${q(u.role)} where id=${q(u.id)} and email=${q(u.email)};`;
  await sql(seed+'commit;');plan.seeded=true;save();
  const noAuth=await edge(undefined,{action:'profiles'});check([401,403].includes(noAuth.status),'Anonymous import request accepted');
  const internal=await edge(service,{action:'profiles'});check([401,403].includes(internal.status),'Internal service identity accepted');await expect(sessions[1],{action:'profiles'},403);await expect(sessions[2],{action:'profiles'},403,'tenant_mismatch');
  const listed=await expect(sessions[0],{action:'profiles'},200);check(listed.profiles?.length===3&&listed.profiles.every(p=>p.definition?.governed===true),'Governed profile listing differs');
  const profile=Object.fromEntries(listed.profiles.map(p=>[p.entity_type,p.id]));
  checks.push('Actual anonymous, service, viewer and foreign-company access refused; owner sees the three governed profiles.');
  const customer='source_system,external_id,record_kind,display_name,active\ncommusoft,C1,person,SYNTHETIC Import Customer,true';
  const site='source_system,external_id,customer_external_id,label,address_text,postcode,active\ncommusoft,S1,C1,SYNTHETIC Site,1 Synthetic Road,SW1A 1AA,true';
  const job='source_system,external_id,job_number,customer_external_id,site_external_id,title,status,active\ncommusoft,J1,700001,C1,S1,SYNTHETIC Job,open,true';
  const previewBody=(entity,csv)=>({action:'preview',source_system:'commusoft',entity_type:entity,profile_id:profile[entity],filename:'SYNTHETIC.csv',csv_text:csv});
  await expect(sessions[0],{...previewBody('customers',customer),profile_id:undefined},400,'profile_selection_required');
  await expect(sessions[0],{...previewBody('customers',customer),entity_type:'contacts'},400,'unsupported_entity');
  await sql(`update profiles set role='ops' where id=${q(plan.users[0].id)}`);await expect(sessions[0],previewBody('customers',customer),403,'forbidden');await sql(`update profiles set role='owner' where id=${q(plan.users[0].id)}`);
  const pending=await expect(sessions[0],previewBody('customers',customer),200);plan.imports.push(pending.import_id);save();check(pending.preview?.will_create===1,'Customer preview differs');check(JSON.stringify(await counts())===JSON.stringify({people:0,sites:0,jobs:0}),'Preview mutated canonical data');
  const apply=(id,csv)=>({action:'apply',import_id:id,csv_text:csv});
  await expect(sessions[0],apply(pending.import_id,customer+'changed'),409);
  await sql(`insert into view_as_context(id,tenant_id,actor_user_id,subject_kind,subject_ref,mode,read_only,expires_at) values(${q(plan.context)},${q(plan.tenants[1])},${q(plan.users[0].id)},'role','owner','supervised_test',false,clock_timestamp()+interval '1 hour')`);
  await expect(sessions[0],apply(pending.import_id,customer),403,'preview_read_only');await sql(`update view_as_context set ended_at=clock_timestamp() where id=${q(plan.context)}`);
  await sql(`update tenants set status='suspended' where id=${q(tenant)}`);await expect(sessions[0],apply(pending.import_id,customer),403,'forbidden');await sql(`update tenants set status='active' where id=${q(tenant)}`);
  const applied=await expect(sessions[0],apply(pending.import_id,customer),200);check(applied.status==='completed'&&applied.created===1,'Customer apply did not complete');
  await expect(sessions[0],apply(pending.import_id,customer),200);await expect(sessions[0],apply(pending.import_id,customer+'changed'),409);
  checks.push('Preview preserves canonical rows; changed bytes, active foreign-company View As, suspended company and ops writes refused; owner apply and replay create one customer.');
  for(const [entity,csv]of [['sites',site],['jobs',job]]){const p=await expect(sessions[0],previewBody(entity,csv),200);plan.imports.push(p.import_id);save();check(p.preview?.will_create===1,`${entity} preview differs`);const a=await expect(sessions[0],apply(p.import_id,csv),200);check(a.status==='completed'&&a.created===1,`${entity} apply did not complete`);}
  check(JSON.stringify(await counts())===JSON.stringify({people:1,sites:1,jobs:1}),'Canonical counts differ');
  const status=await expect(sessions[0],{action:'status',import_id:plan.imports[2]},200);check(status.import?.status==='completed'&&status.provenance?.length===1,'Saved job provenance differs');
  const rows=await expect(sessions[0],{action:'row_results',import_id:plan.imports[2]},200);check(rows.rows?.length===1&&rows.rows[0].outcome==='created','Durable job row outcome differs');
  await expect(sessions[2],{action:'status',tenant_id:plan.tenants[1],import_id:plan.imports[2]},404,'not_found');
  await sql(`update profiles set role='viewer' where id=${q(plan.users[0].id)}`);await expect(sessions[0],{action:'status',import_id:plan.imports[2]},403,'forbidden');
  checks.push('Actual CSV parser and row RPCs import customer, exact linked site and job in order; durable outcomes/provenance retained, foreign run access and revoked session authority refused.');
 }catch(e){failure=e instanceof Error?e.message:'Import acceptance failed';}
 finally{
  try{sourceAfter=await snapshot();if(sourceBefore&&JSON.stringify(sourceBefore)!==JSON.stringify(sourceAfter))cleanupErrors.push('Pre-existing TEST source rows changed');}catch{cleanupErrors.push('Source preservation read requires inspection');}
  try{await sql(`begin;update view_as_context set ended_at=coalesce(ended_at,clock_timestamp()) where id=${q(plan.context)} and actor_user_id=${q(plan.users[0].id)};update profiles set role='viewer' where id in (${plan.users.map(u=>q(u.id)).join(',')});commit;`);}catch{cleanupErrors.push('Fixture authority retirement requires inspection');}
  for(const u of plan.users){try{const found=await request(`${base}/auth/v1/admin/users/${u.id}`,admin);if(found.status===404&&!u.created)continue;check(found.ok&&found.data?.app_metadata?.learn_import_run===plan.runId,'Fixture identity marker differs');const r=await request(`${base}/auth/v1/admin/users/${u.id}`,admin,'PUT',{ban_duration:'876000h',password:randomBytes(48).toString('base64url')});check(r.ok&&Date.parse(r.data?.banned_until)>Date.now()+86400000,'Ban unverified');}catch{cleanupErrors.push('Fixture login retirement requires inspection');}}
  try{retained={...await counts(),...(await sql(`select (select count(*)::int from data_imports where tenant_id in (${tenants})) as imports,(select count(*)::int from import_row_results where tenant_id in (${tenants})) as outcomes,(select count(*)::int from profiles where id in (${plan.users.map(u=>q(u.id)).join(',')}) and role<>'viewer') as approving_users`,true))[0]};check(retained.approving_users===0,'Synthetic approval authority remains');}catch{cleanupErrors.push('Fixture retention requires inspection');}
  plan.accessShutdown=cleanupErrors.length===0;save();
 }
 return {version:'learn-test-import-acceptance/1',projectRef:TEST_PROJECT,runId:plan.runId,observedAt:new Date().toISOString(),state:failure||cleanupErrors.length?'requires_inspection':'passed',sourceBundleSha256:IMPORT_ENDPOINT_SHA,checks,failure,cleanupErrors,retained,preExistingSourcesPreserved:sourceBefore!==null&&sourceAfter!==null&&JSON.stringify(sourceBefore)===JSON.stringify(sourceAfter),manifest:path,limitations:['Synthetic TEST records only; no original file imported, provider call or production change.','Single-row customer/site/job flow; conflict/retry, large-file and browser acceptance remain separate.','Temporary logins are banned, passwords rotated and roles demoted; synthetic records and evidence retained.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{if(process.argv.slice(2).join(' ')!=='--accept --existing-cli-login'||process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)throw Error('Explicit TEST import acceptance required');const r=await acceptImport({allowProjectRef:TEST_PROJECT,token:savedCliToken()});console.log(JSON.stringify(r,null,2));if(r.state!=='passed')process.exitCode=1;}catch(e){console.error(e.message);process.exitCode=1;}}
