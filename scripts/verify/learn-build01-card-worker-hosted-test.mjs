/** Synthetic TEST card journey through the exact deployed platform worker. */
import { randomUUID } from 'node:crypto';
import { existsSync,writeFileSync } from 'node:fs';
import { TEST_PROJECT,savedCliToken } from './learn-test-readiness.mjs';
import { communicationQuery } from './learn-card-communication-catalog.mjs';

if(process.argv.slice(2).join(' ')!=='--test --existing-cli-login'||
 process.env.LEARN_TEST_ALLOW_PROJECT_REF!==TEST_PROJECT)
 throw Error('Explicit TEST-only card acceptance allowlist required');
const prefix='.verification-results/build01-card-revision-hosted';
if(existsSync(prefix+'-journal.json')||existsSync(prefix+'-result.json'))
 throw Error('Prior hosted card acceptance needs inspection');
const token=savedCliToken(),tenant=randomUUID(),person=randomUUID(),card=randomUUID(),job=randomUUID();
const result={version:'learn-build01-card-worker-hosted-test/1',project:TEST_PROJECT,
 tenant,state:'unconfirmed',productionChanged:false,providerRequests:0,newUsers:0};
let fixtureWritten=false;
try{
 const inv=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!inv.ok)throw Error('TEST worker inventory unavailable');
 const worker=(await inv.json()).find(x=>x.slug==='platform-worker');
 if(worker?.version!==58||worker.ezbr_sha256!=='6646ccadfec21aff2145284761af6bed0a53f7c5570c4f8188a74b246fe727e4'||
  worker.status!=='ACTIVE'||worker.verify_jwt!==false)throw Error('TEST worker release changed');
 writeFileSync(prefix+'-journal.json',JSON.stringify({state:'prepared',tenant,person,card,job,
  workerVersion:worker.version,workerWire:worker.ezbr_sha256},null,2)+'\n',{flag:'wx',mode:0o600});
 const seed=`begin;
 insert into public.tenants(id,slug,display_name,status,metadata)
 values('${tenant}','build01-card-${tenant}','Synthetic card acceptance','active',
  '{"synthetic":true,"purpose":"build01-card-revision-hosted"}'::jsonb);
 insert into public.people(id,tenant_id,display_name,metadata)
 values('${person}','${tenant}','Synthetic card acceptance','{"synthetic":true}'::jsonb);
 insert into public.customer_cards(id,tenant_id,person_id,title,status,context)
 values('${card}','${tenant}','${person}','Synthetic card acceptance','grey','{}'::jsonb);
 insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,
  priority,max_attempts,payload)
 values('${job}','${tenant}','openfolk-core','core.customer-card','customer_card.sync',
  'customer_card.sync:${tenant}:${card}','queued',50,1,
  jsonb_build_object('customer_card_id','${card}'));
 commit;`;
 fixtureWritten=true;
 await communicationQuery(token,seed,{readOnly:false});
 const keys=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{
  headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!keys.ok)throw Error('Existing TEST service key unavailable');
 const matches=(await keys.json()).filter(k=>k.name==='service_role');
 if(matches.length!==1)throw Error('Unique TEST service key required');
 const service=matches[0].api_key;
 const claims=JSON.parse(Buffer.from(service.split('.')[1],'base64url'));
 if(claims.ref!==TEST_PROJECT||claims.role!=='service_role')throw Error('TEST key scope changed');
 const call=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),
  headers:{apikey:service,Authorization:`Bearer ${service}`,
   'x-serviceos-internal-key':service,'x-internal-tenant-id':tenant,
   'Content-Type':'application/json'},
  body:JSON.stringify({batch_size:1,job_types:['customer_card.sync']})});
 const reply=await call.json().catch(()=>null);
 result.http={status:call.status,claimed:reply?.claimed??null,succeeded:reply?.succeeded??null,
  failed:reply?.failed??null,unconfirmed:reply?.unconfirmed??null};
 if(call.status!==200||reply?.claimed!==1)throw Error('Hosted worker did not claim card fixture');
 const rows=await communicationQuery(token,`select j.status job_status,j.records_processed,
  coalesce((j.result->>'revision_conflicts')::int,-1) revision_conflicts,
  c.context->'projection'->>'version' projection_version,c.status card_status
 from public.platform_jobs j join public.customer_cards c on c.id='${card}'::uuid and c.tenant_id=j.tenant_id
 where j.id='${job}'::uuid and j.tenant_id='${tenant}'::uuid`);
 const observed=rows[0];result.observed=observed;
 if(rows.length!==1||observed.job_status!=='succeeded'||observed.records_processed!==1||
  observed.revision_conflicts!==0||observed.projection_version!=='1'||observed.card_status!=='green')
  throw Error('Hosted card projection/result contract unconfirmed');
 result.state='test_hosted_card_projection_verified';
}catch(e){result.state='requires_inspection';result.failure=e instanceof Error?e.message.slice(0,150):'Unknown failure';process.exitCode=1;}
finally{
 if(fixtureWritten){
  try{
   await communicationQuery(token,`begin;
    update public.tenants set status='archived' where id='${tenant}'::uuid
      and metadata->>'purpose'='build01-card-revision-hosted';
    update public.platform_jobs set status='cancelled',cancelled_at=clock_timestamp()
      where tenant_id='${tenant}'::uuid and job_type='customer_card.sync'
      and status='queued' and attempt_count=0;
    commit;`,{readOnly:false});
   const retired=await communicationQuery(token,`select status from public.tenants where id='${tenant}'::uuid`);
   result.fixtureArchived=retired[0]?.status==='archived';
   if(!result.fixtureArchived){result.state='requires_inspection';process.exitCode=1;}
  }catch{result.fixtureArchived=false;result.state='requires_inspection';process.exitCode=1;}
 }
 result.observedAt=new Date().toISOString();
 writeFileSync(prefix+'-result.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result));
}
