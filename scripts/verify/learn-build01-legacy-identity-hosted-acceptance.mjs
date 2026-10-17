/** TEST: a saved 200-request must settle a bounded 50-delivery attempt. */
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { TEST_PROJECT, savedCliToken } from './learn-test-readiness.mjs';
import { edgeInventory } from './learn-test-email-runtime-deploy.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';

if(process.argv.slice(2).join(' ')!=='--verify --existing-cli-login'||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
  throw Error('Explicit TEST-only legacy identity acceptance required');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const token=savedCliToken(),tenant=randomUUID(),job=randomUUID();
const interactions=Array.from({length:50},()=>({id:randomUUID(),source:randomUUID()}));
const prefix=`.verification-results/build01-legacy-identity-hosted-${tenant}`;
const result={contract:'build01-legacy-identity-hosted/1',project:TEST_PROJECT,
  state:'unconfirmed',requestedLimit:200,effectiveLimit:50,
  productionChanged:false,providerRequests:0,newUsers:0};
let fixtureWritten=false;
try{
  const worker=(await edgeInventory(token)).find(x=>x.slug==='platform-worker');
  check(worker?.version===68&&worker.status==='ACTIVE'&&worker.verify_jwt===false,
    'TEST worker release changed');
  const competing=(await communicationQuery(token,`select count(*)::int jobs from public.platform_jobs
    where job_type='identity.resolve' and priority<=0
      and status in('queued','retrying')`))[0];
  check(competing?.jobs===0,'Higher-priority TEST identity work is already due');
  writeFileSync(`${prefix}-journal.json`,JSON.stringify({tenant,job,
    workerVersion:worker.version,workerWireSha256:worker.ezbr_sha256},null,2)+'\n',
    {flag:'wx',mode:0o600});
  const values=interactions.map(({id,source})=>`('${id}','${tenant}','simwood','phone',
    'phone_calls','${source}','phone_call','inbound','2026-10-15T10:00:00Z',
    '+441632960321','+441632960001','Synthetic legacy identity batch','ready',
    jsonb_build_object('phone_handoff',jsonb_build_object('version',
      'learn-phone-handoff/1','sourceFingerprint',repeat('a',64))))`).join(',');
  fixtureWritten=true;
  await communicationQuery(token,`begin;
    insert into public.tenants(id,slug,display_name,status,metadata)
      values('${tenant}','build01-legacy-identity-${tenant}',
        'Synthetic legacy identity batch','active',
        '{"synthetic":true,"purpose":"build01-legacy-identity-hosted"}'::jsonb);
    insert into public.interactions(id,tenant_id,source_connector_id,source_type,
      source_table,source_id,interaction_type,direction,occurred_at,phone_from,
      phone_to,summary,processing_status,metadata) values ${values};
    insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,
      status,payload) select '${tenant}','interaction.ready','interaction',i.id,
      'pending',jsonb_build_object('source_fingerprint',repeat('a',64))
      from public.interactions i where i.tenant_id='${tenant}';
    insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,
      job_key,status,priority,max_attempts,payload)
      values('${job}','${tenant}','openfolk-core','core.identity',
        'identity.resolve','identity.resolve:${tenant}','queued',0,1,
        '{"limit":200}'::jsonb);
    commit;`,{readOnly:false});
  const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{
    headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
  check(response.ok,'TEST service key unavailable');
  const keys=(await response.json()).filter(k=>k.name==='service_role');
  check(keys.length===1,'Unique TEST service key required');
  const service=keys[0].api_key,claims=JSON.parse(Buffer.from(service.split('.')[1],'base64url'));
  check(claims.ref===TEST_PROJECT&&claims.role==='service_role','TEST service scope changed');
  const call=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,{
    method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
    headers:{apikey:service,Authorization:`Bearer ${service}`,
      'x-serviceos-internal-key':service,'Content-Type':'application/json'},
    body:JSON.stringify({batch_size:1,job_types:['identity.resolve']}),
  });
  const reply=await call.json().catch(()=>null);
  result.http={status:call.status,claimed:reply?.claimed??null,
    succeeded:reply?.succeeded??null,deadLettered:reply?.dead_lettered??null,
    unconfirmed:reply?.unconfirmed??null};
  check(call.status===200&&reply?.claimed===1,'Hosted worker did not claim a job');
  const outcome=(await communicationQuery(token,`select
    (select status from public.platform_jobs where id='${job}' and tenant_id='${tenant}') job_status,
    (select records_processed from public.platform_jobs where id='${job}' and tenant_id='${tenant}') records_processed,
    (select count(*)::int from public.learn_processing_publications
      where tenant_id='${tenant}' and job_id='${job}' and attempt=1) publications,
    (select count(*)::int from public.platform_jobs where tenant_id='${tenant}'
      and parent_job_id='${job}' and job_type='identity.resolve') continuations,
    (select count(*)::int from public.interactions where tenant_id='${tenant}'
      and processing_status='enriched') enriched`))[0];
  result.observed=outcome;
  check(outcome?.job_status==='succeeded'&&outcome.records_processed===50&&
    outcome.publications===50&&outcome.continuations===0&&outcome.enriched===50,
    'Legacy 200-request did not settle its bounded 50 without continuation');
  result.state='test_hosted_legacy_batch_settled';
}catch(error){
  result.state='requires_inspection';
  result.failure=error instanceof Error?error.message.slice(0,220):'Unknown failure';
  process.exitCode=1;
}finally{
  if(fixtureWritten){
    try{
      await communicationQuery(token,`update public.tenants set status='archived'
        where id='${tenant}' and metadata->>'purpose'='build01-legacy-identity-hosted'`,
        {readOnly:false});
      const rows=await communicationQuery(token,`select status from public.tenants where id='${tenant}'`);
      check(rows[0]?.status==='archived','Synthetic identity tenant retirement unconfirmed');
      await communicationQuery(token,`update public.platform_jobs set status='cancelled',
        cancelled_at=clock_timestamp(),last_error='Archived synthetic identity fixture retired'
        where id='${job}' and tenant_id='${tenant}' and job_type='identity.resolve'
          and status='queued' and attempt_count=0 and lease_expires_at is null`,
        {readOnly:false});
      const active=await communicationQuery(token,`select count(*)::int jobs from public.platform_jobs
        where tenant_id='${tenant}' and job_type='identity.resolve'
          and status in('queued','running','retrying')`);
      check(active[0]?.jobs===0,'Synthetic identity job still active');
      result.fixtureArchived=true;
    }catch{
      result.state='requires_inspection';result.fixtureArchived=false;process.exitCode=1;
    }
  }
  result.observedAt=new Date().toISOString();
  writeFileSync(`${prefix}-result.json`,JSON.stringify(result,null,2)+'\n',
    {flag:'wx',mode:0o600});
  console.log(JSON.stringify(result));
}
