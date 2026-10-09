/** Real TEST Auth/JWT/PostgREST/Edge acceptance with explicitly synthetic fixtures.
 * Reuses existing TEST keys in memory. Never sends emails, fetches audio or calls
 * a provider. Cleanup is restricted to this run's generated IDs and markers. */
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { savedCliToken,readTestCatalog,TEST_PROJECT } from './learn-test-readiness.mjs';
import { SOURCE_SHA256,RELEASE_NAME } from './learn-test-launch-rehearsal.mjs';
import { AUTH_CONTRACT_QUERY } from './learn-test-auth-contract.mjs';
const ORIGIN=`https://${TEST_PROJECT}.supabase.co`;
const check=(ok,label)=>{if(!ok)throw Error(label);};
const q=s=>`'${String(s).replaceAll("'","''")}'`;
function canonical(value){
  if(Array.isArray(value))return value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const expectedContract=JSON.parse(readFileSync(new URL('../../docs/operations/evidence/learn-test-auth-fixture-contract-2026-10-09.json',import.meta.url)));
export function fixturePlan(){
  const runId=randomUUID();
  const tenants=['A','B'].map(label=>({label,id:randomUUID(),email:randomUUID(),call:randomUUID(),recording:randomUUID(),transcript:randomUUID(),sync:randomUUID()}));
  const users=[['owner',0],['admin',0],['viewer',0],['ops',0],['owner',1]].map(([role,index],i)=>({id:randomUUID(),role,
    tenant:tenants[index].id,email:`learn-qa-${runId}-${i}@example.invalid`}));
  return {version:'learn-test-launch-fixtures/1',projectRef:TEST_PROJECT,runId,tenants,users};
}
function seedSql(plan){
  let sql=`begin; set local statement_timeout='15s';\n`;
  for(const t of plan.tenants){
    sql+=`insert into public.tenants(id,slug,display_name,metadata) values(${q(t.id)},${q('learn-qa-'+plan.runId+'-'+t.label)},'Synthetic LEARN acceptance',jsonb_build_object('learn_acceptance_run',${q(plan.runId)}));\n`;
    sql+=`insert into public.email_messages(id,tenant_id,provider,provider_message_id,body_text,raw_payload)
      values(${q(t.email)},${q(t.id)},'learn_acceptance',${q(plan.runId+'-'+t.label)},'SYNTHETIC_PRIVATE_EMAIL',
      ${q(JSON.stringify({label_ids:t.label==='A'?['INBOX','SENT','PRIVATE_LABEL']:['DRAFT'],body:'SYNTHETIC_PRIVATE_EMAIL'}))}::jsonb);\n`;
    sql+=`insert into public.phone_calls(id,tenant_id,provider,provider_call_id,linked_id,direction,started_at,duration_seconds,from_number)
      values(${q(t.call)},${q(t.id)},'learn_acceptance',${q('qa-call-'+t.call)},${q('qa-family-'+t.id)},${q(t.label==='A'?'IN':'OUT')},now()-interval '1 minute',42,'SYNTHETIC_PRIVATE_NUMBER');\n`;
    sql+=`insert into public.phone_recordings(id,tenant_id,provider,provider_recording_id,provider_call_id,linked_id,storage_path)
      values(${q(t.recording)},${q(t.id)},'learn_acceptance',${q('qa-recording-'+t.recording)},${q('qa-call-'+t.call)},${q('qa-family-'+t.id)},'SYNTHETIC_NO_STORAGE_OBJECT');\n`;
    sql+=`insert into public.phone_transcripts(id,tenant_id,recording_id,status,transcript_text)
      values(${q(t.transcript)},${q(t.id)},${q(t.recording)},'completed','SYNTHETIC_PRIVATE_TRANSCRIPT');\n`;
    sql+=`insert into public.phone_sync_runs(id,tenant_id,provider,sync_type,status,started_at,completed_at,records_processed,error_message,metadata)
      values(${q(t.sync)},${q(t.id)},'learn_acceptance','calls','failed',now()-interval '1 minute',now(),1,'SYNTHETIC_PRIVATE_ERROR',jsonb_build_object('learn_acceptance_run',${q(plan.runId)}));\n`;
  }
  for(const u of plan.users)sql+=`update public.profiles p set tenant_id=${q(u.tenant)},role=${q(u.role)}
    where p.id=${q(u.id)} and p.email=${q(u.email)} and exists(select 1 from auth.users a where a.id=p.id and a.raw_app_meta_data->>'learn_acceptance_run'=${q(plan.runId)});
    do $$ begin if not exists(select 1 from public.profiles where id=${q(u.id)} and tenant_id=${q(u.tenant)} and role=${q(u.role)}) then raise exception 'Fixture profile binding failed';end if;end $$;\n`;
  return sql+"commit; select 'synthetic_fixtures_seeded' as state;";
}
function cleanupRowsSql(plan){
  let sql='begin;';
  for(const t of plan.tenants){
    const owns=`exists(select 1 from public.tenants where id=${q(t.id)} and metadata->>'learn_acceptance_run'=${q(plan.runId)})`;
    sql+=`delete from public.phone_transcripts where id=${q(t.transcript)} and tenant_id=${q(t.id)} and recording_id=${q(t.recording)} and ${owns};`;
    for(const [table,id] of [['phone_recordings',t.recording],['phone_calls',t.call],['email_messages',t.email],['phone_sync_runs',t.sync]])
      sql+=`delete from public.${table} where id=${q(id)} and tenant_id=${q(t.id)} and provider='learn_acceptance' and ${owns};`;
  }
  return sql+'commit;';
}
export async function acceptLaunch({allowProjectRef,token,fetcher=fetch}){
  const pre=await readTestCatalog({allowProjectRef,token,fetcher});
  check(pre.report.launchMetadata.state==='needs_semantic_and_user_verification','Installed TEST metadata contract required');
  check(pre.report.customMigrationEntries.some(e=>e.migration_name===RELEASE_NAME&&e.source_sha256===SOURCE_SHA256),'Installed TEST release receipt differs');
  check(pre.functions.some(f=>f.slug==='learn-launch-status'&&f.status==='ACTIVE'&&f.verify_jwt===true),'JWT-protected TEST function required');
  async function request(url,{method='GET',headers={},body}={}){
    const response=await fetcher(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.byteLength;check(size<=2097152,'Response size exceeded');chunks.push(chunk);}
    const raw=Buffer.concat(chunks).toString('utf8');let data=null;try{data=raw?JSON.parse(raw):null;}catch{}
    return {status:response.status,ok:response.ok,data};
  }
  const managementHeaders={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
  async function sql(query,readOnly=false){
    const r=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly?'/read-only':''}`,{
      method:'POST',headers:managementHeaders,body:{query,...(readOnly?{}:{read_only:false})}});
    check(r.ok,`TEST fixture SQL failed (HTTP ${r.status})`);return r.data;
  }
  const contract=await sql(AUTH_CONTRACT_QUERY,true);
  check(Array.isArray(contract)&&contract.length===1&&digest(contract[0].contract)===digest(expectedContract),'TEST fixture schema or triggers changed');
  const keys=await request(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{headers:managementHeaders});
  check(keys.ok&&Array.isArray(keys.data),'Existing TEST keys unavailable');
  const keyFor=role=>{
    const match=keys.data.filter(k=>k.name===role&&typeof k.api_key==='string');check(match.length===1,'Expected existing legacy TEST key unavailable');
    const key=match[0].api_key;let claims;try{claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());}catch{}
    check(claims?.ref===TEST_PROJECT&&claims?.role===role,'Existing key target/role differs');return key;
  };
  const anon=keyFor('anon'),service=keyFor('service_role');
  const userHeaders=jwt=>({apikey:anon,'Content-Type':'application/json',...(jwt?{Authorization:`Bearer ${jwt}`}:{})});
  const adminHeaders={apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'};
  const plan=fixturePlan(),manifest=`/private/tmp/serviceos-learn-launch-fixtures-${plan.runId}.json`;
  writeFileSync(manifest,JSON.stringify(plan,null,2),{mode:0o600});
  const checks=[],cleanupErrors=[],sessions=new Map(),uncertainUsers=new Set();let failure=null;
  const pass=label=>checks.push(label);
  const endpoint=(jwt,tenant,extra={})=>request(`${ORIGIN}/functions/v1/learn-launch-status`,{method:'POST',headers:{...userHeaders(jwt),...extra},body:{tenant_id:tenant}});
  const rest=(jwt,path)=>request(`${ORIGIN}/rest/v1/${path}`,{headers:userHeaders(jwt)});
  try{
    for(const u of plan.users){
      const password=randomBytes(32).toString('base64url');
      uncertainUsers.add(u.id);
      const created=await request(`${ORIGIN}/auth/v1/admin/users`,{method:'POST',headers:adminHeaders,
        body:{id:u.id,email:u.email,password,email_confirm:true,app_metadata:{learn_acceptance_run:plan.runId}}});
      check(created.ok&&created.data?.id===u.id,'Synthetic Auth user creation failed');
      uncertainUsers.delete(u.id);
      const login=await request(`${ORIGIN}/auth/v1/token?grant_type=password`,{method:'POST',headers:userHeaders(),body:{email:u.email,password}});
      check(login.ok&&login.data?.user?.id===u.id&&typeof login.data?.access_token==='string','Synthetic user sign-in failed');
      sessions.set(u.id,login.data.access_token);
    }
    await sql(seedSql(plan));pass('Synthetic fixture users signed in through Auth');
    const [a,b]=plan.tenants,owner=sessions.get(plan.users[0].id);
    for(const u of plan.users.filter(u=>['owner','admin'].includes(u.role))){
      const r=await endpoint(sessions.get(u.id),u.tenant),t=plan.tenants.find(t=>t.id===u.tenant);
      check(r.status===200&&r.data?.tenant_id===u.tenant,'Owner/admin launch read failed');
      check(r.data.counts.email.record_count===1&&r.data.counts.phone.record_count===1&&r.data.recordings.record_count===1,'Tenant fixture counts differ');
      check(r.data.phone.recent_calls.length===1&&r.data.phone.recent_calls[0].id===t.call&&r.data.phone.recent_calls[0].recording_ids?.[0]===t.recording,'Recording reconciliation differs');
      check(r.data.phone.transcript_status_counts.completed===1&&r.data.phone.latest_call_sync_attempt.error_present===true,'Transcript/sync metadata differs');
      check(r.data.email.stored_label_counts.inbox===(t.label==='A'?1:0)&&r.data.email.stored_label_counts.draft===(t.label==='B'?1:0),'Tenant label counts differ');
      check(r.data.voicemails.record_count===null&&r.data.voicemails.read_status==='unavailable','Unverified voicemail must remain unknown');
      check(!JSON.stringify(r.data).includes('SYNTHETIC_PRIVATE'),'Private fixture content leaked');
    }
    pass('Owner/admin Edge reads: tenant counts, labels, recording links, statuses and unknown voicemail');
    for(const u of plan.users.filter(u=>['viewer','ops'].includes(u.role)))check((await endpoint(sessions.get(u.id),u.tenant)).status===403,'Restricted role reached launch metadata');
    check((await endpoint(owner,b.id)).status===403,'Foreign tenant request accepted');
    check((await endpoint(owner,a.id,{'x-internal-tenant-id':a.id})).status===403,'Machine-header request accepted');
    check((await endpoint(undefined,a.id)).status===401,'Missing JWT accepted');
    check((await endpoint('invalid-test-jwt',a.id)).status===401,'Invalid JWT accepted');
    pass('Viewer/ops, foreign tenant, machine headers, missing and invalid JWT denied');
    const own=await rest(owner,`learn_launch_email_messages?select=*&tenant_id=eq.${a.id}`);
    check(own.status===200&&own.data?.length===1&&own.data[0].id===a.email,'Own-tenant metadata view failed');
    check(JSON.stringify(own.data[0].raw_payload)===JSON.stringify({label_ids:['INBOX','SENT']}),'Email payload projection differs');
    const foreign=await rest(owner,`learn_launch_email_messages?select=*&tenant_id=eq.${b.id}`);
    check(foreign.status===200&&Array.isArray(foreign.data)&&foreign.data.length===0,'Foreign metadata visible through PostgREST');
    for(const path of [`email_messages?select=raw_payload&tenant_id=eq.${a.id}`,`phone_transcripts?select=transcript_text&tenant_id=eq.${a.id}`])
      check((await rest(owner,path)).status===403,'Direct private source read accepted');
    check([401,403].includes((await rest(undefined,`learn_launch_email_messages?select=id&tenant_id=eq.${a.id}`)).status),'Anonymous view read accepted');
    const transcript=await rest(owner,`learn_launch_phone_transcripts?select=*&tenant_id=eq.${a.id}`);
    check(transcript.status===200&&transcript.data?.length===1&&!('transcript_text' in transcript.data[0]),'Transcript text exposed');
    const sync=await rest(owner,`learn_launch_phone_sync_runs?select=*&tenant_id=eq.${a.id}`);
    check(sync.status===200&&sync.data?.length===1&&sync.data[0].error_message==='[redacted]','Sync error was not redacted');
    pass('PostgREST tenant isolation, payload/error redaction and private-source denial');
    await sql(`update public.profiles set role='viewer' where id=${q(plan.users[0].id)} and tenant_id=${q(a.id)} and email=${q(plan.users[0].email)};`);
    check((await endpoint(owner,a.id)).status===403,'Old owner JWT retained revoked authority');
    const revoked=await rest(owner,`learn_launch_email_messages?select=id&tenant_id=eq.${a.id}`);
    check(revoked.status===200&&revoked.data?.length===0,'View retained revoked owner authority');
    pass('Role revocation takes effect for the same existing JWT in Edge and PostgREST');
  }catch(error){failure=error.message;}
  finally{
    try{await sql(cleanupRowsSql(plan));}catch{cleanupErrors.push('Synthetic source cleanup requires inspection');}
    for(const u of plan.users){
      try{
        const found=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{headers:adminHeaders});
        if(found.status===404)continue;
        check(found.ok&&found.data?.id===u.id&&found.data?.email===u.email&&found.data?.app_metadata?.learn_acceptance_run===plan.runId,'Synthetic identity cleanup guard differs');
        const removed=await request(`${ORIGIN}/auth/v1/admin/users/${u.id}`,{method:'DELETE',headers:adminHeaders,body:{should_soft_delete:false}});
        check(removed.ok,'Synthetic identity cleanup failed');
        uncertainUsers.delete(u.id);
      }catch{cleanupErrors.push(`Synthetic user cleanup requires inspection: ${u.id}`);}
    }
    for(const id of uncertainUsers)cleanupErrors.push(`Auth creation outcome requires inspection: ${id}`);
    try{
      const sources=plan.tenants.flatMap(t=>[
        `select 1 from public.email_messages where id=${q(t.email)}`,`select 1 from public.phone_calls where id=${q(t.call)}`,
        `select 1 from public.phone_recordings where id=${q(t.recording)}`,`select 1 from public.phone_transcripts where id=${q(t.transcript)}`,
        `select 1 from public.phone_sync_runs where id=${q(t.sync)}`]);
      const sourceCount=await sql(`select count(*)::integer as remaining from (${sources.join(' union all ')}) fixtures;`,true);
      check(sourceCount?.[0]?.remaining===0,'Synthetic source rows remain; keep tenant cleanup markers');
      // Preserve tenant markers for recovery if any preceding cleanup is uncertain.
      if(!cleanupErrors.length)await sql(`delete from public.tenants where id in (${plan.tenants.map(t=>q(t.id)).join(',')}) and metadata->>'learn_acceptance_run'=${q(plan.runId)};`);
      const predicates=[...sources,...plan.tenants.map(t=>`select 1 from public.tenants where id=${q(t.id)}`),
        ...plan.users.flatMap(u=>[`select 1 from auth.users where id=${q(u.id)}`,`select 1 from public.profiles where id=${q(u.id)}`])];
      const remaining=await sql(`select count(*)::integer as remaining from (${predicates.join(' union all ')}) fixtures;`,true);
      check(remaining?.[0]?.remaining===0,'Synthetic rows remain');
    }catch{cleanupErrors.push('Synthetic cleanup absence not verified');}
  }
  return {version:'learn-test-launch-acceptance/1',projectRef:TEST_PROJECT,sourceSha256:SOURCE_SHA256,
    observedAt:new Date().toISOString(),runId:plan.runId,state:!failure&&!cleanupErrors.length?'passed_synthetic_acceptance':'requires_inspection',
    checks,failure,cleanupVerified:cleanupErrors.length===0,cleanupErrors,fixtureManifest:manifest,
    limitations:['Synthetic TEST identities and metadata only; no customer records, provider traffic, audio playback or frontend were verified.',
      'Existing keys were reused in memory; no email was sent and no new project key was created.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    check(process.argv.slice(2).join(' ')==='--synthetic-test --existing-cli-login'&&process.env.LEARN_TEST_ALLOW_PROJECT_REF===TEST_PROJECT,'Explicit synthetic TEST acceptance required');
    const report=await acceptLaunch({allowProjectRef:TEST_PROJECT,token:savedCliToken()});
    console.log(JSON.stringify(report,null,2));if(report.state!=='passed_synthetic_acceptance')process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
