/** Isolated TEST Graph job through the deployed worker; synthetic source only. */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";

if (process.argv.slice(2).join(" ") !== "--verify --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST-only Graph acceptance required");
const check=(ok,message)=>{if(!ok)throw Error(message);};
const token=savedCliToken(),tenant=randomUUID(),interaction=randomUUID(),job=randomUUID();
const prefix=`.verification-results/build01-graph-hosted-batch-${tenant}`;
const result={version:"build01-graph-hosted-batch/1",project:TEST_PROJECT,
  state:"unconfirmed",productionChanged:false,providerRequests:0,newUsers:0};
let fixtureWritten=false;
try{
  const worker=(await edgeInventory(token)).find(x=>x.slug==="platform-worker");
  check(worker?.version===67&&worker.status==="ACTIVE"&&worker.verify_jwt===false,
    "TEST worker release changed");
  const competing=(await communicationQuery(token,`select count(*)::int jobs
    from public.platform_jobs where job_type='graph.sync' and priority<=0
      and status in('queued','retrying')`))[0];
  check(competing?.jobs===0,"Higher-priority TEST Graph work is already due");
  writeFileSync(`${prefix}-journal.json`,JSON.stringify({tenant,interaction,job,
    workerVersion:worker.version,workerWireSha256:worker.ezbr_sha256},null,2)+'\n',
    {flag:"wx",mode:0o600});
  fixtureWritten=true;
  await communicationQuery(token,`begin;
    insert into public.tenants(id,slug,display_name,status,metadata)
      values('${tenant}','build01-graph-${tenant}','Synthetic Build 01 Graph','active',
        '{"synthetic":true,"purpose":"build01-graph-hosted-batch"}'::jsonb);
    insert into public.interactions(id,tenant_id,source_connector_id,source_type,
      source_table,source_id,interaction_type,direction,occurred_at,summary,
      processing_status,metadata)
      values('${interaction}','${tenant}','simwood','phone','phone_calls',
        '${randomUUID()}','phone_call','inbound','2026-10-15T10:00:00Z',
        'Synthetic hosted Graph source','ready','{}'::jsonb);
    insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,
      job_key,status,priority,max_attempts,payload)
      values('${job}','${tenant}','openfolk-core','core.graph','graph.sync',
        'graph.sync:${tenant}','queued',0,2,'{"source":"all"}'::jsonb);
    commit;`,{readOnly:false});
  const response=await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,{
    headers:{Authorization:`Bearer ${token}`},redirect:"error",signal:AbortSignal.timeout(30000)});
  check(response.ok,"TEST service key unavailable");
  const keys=(await response.json()).filter(k=>k.name==="service_role");
  check(keys.length===1,"Unique TEST service key required");
  const service=keys[0].api_key,claims=JSON.parse(Buffer.from(service.split(".")[1],"base64url"));
  check(claims.ref===TEST_PROJECT&&claims.role==="service_role","TEST service scope changed");
  const call=await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(120000),
    headers:{apikey:service,Authorization:`Bearer ${service}`,
      "x-serviceos-internal-key":service,"x-internal-tenant-id":tenant,
      "Content-Type":"application/json"},
    body:JSON.stringify({batch_size:1,job_types:["graph.sync"]}),
  });
  const reply=await call.json().catch(()=>null);
  result.http={status:call.status,claimed:reply?.claimed??null,
    succeeded:reply?.succeeded??null,failed:reply?.failed??null,
    unconfirmed:reply?.unconfirmed??null};
  check(call.status===200&&reply?.claimed===1,"Hosted worker did not claim Graph fixture");
  const outcome=(await communicationQuery(token,`select
    (select status from public.platform_jobs where id='${job}' and tenant_id='${tenant}') job_status,
    (select coalesce((result->>'nodes_upserted')::int,0) from public.platform_jobs
      where id='${job}' and tenant_id='${tenant}') nodes_upserted,
    (select count(*)::int from public.graph_nodes where tenant_id='${tenant}'
      and source_id='${interaction}' and node_type='interaction') interaction_nodes,
    (select count(*)::int from public.graph_events where tenant_id='${tenant}'
      and source_event_id='${job}' and event_type='graph.enriched') events`))[0];
  check(outcome?.job_status==="succeeded"&&outcome.nodes_upserted>=1&&
    outcome.interaction_nodes===1&&outcome.events===1,
    "Hosted Graph node, event or job settlement unconfirmed");
  result.observed=outcome;
  result.state="test_hosted_graph_delivery_verified";
}catch(error){
  result.state="requires_inspection";
  result.failure=error instanceof Error?error.message.slice(0,220):"Unknown failure";
  process.exitCode=1;
}finally{
  if(fixtureWritten){
    try{
      await communicationQuery(token,`update public.tenants set status='archived'
        where id='${tenant}' and metadata->>'purpose'='build01-graph-hosted-batch'`,
        {readOnly:false});
      const rows=await communicationQuery(token,`select status from public.tenants where id='${tenant}'`);
      check(rows[0]?.status==="archived","Synthetic Graph tenant retirement unconfirmed");
      await communicationQuery(token,`update public.platform_jobs set status='cancelled',
        cancelled_at=clock_timestamp(),last_error='Archived synthetic Graph fixture retired'
        where id='${job}' and tenant_id='${tenant}' and job_type='graph.sync'
          and status='queued' and attempt_count=0 and lease_expires_at is null`,
        {readOnly:false});
      const active=await communicationQuery(token,`select count(*)::int jobs from public.platform_jobs
        where tenant_id='${tenant}' and job_type='graph.sync'
          and status in('queued','running','retrying')`);
      check(active[0]?.jobs===0,"Synthetic Graph continuation still active");
      result.fixtureArchived=true;
    }catch{
      result.state="requires_inspection";result.fixtureArchived=false;process.exitCode=1;
    }
  }
  result.observedAt=new Date().toISOString();
  writeFileSync(`${prefix}-result.json`,JSON.stringify(result,null,2)+'\n',
    {flag:"wx",mode:0o600});
  console.log(JSON.stringify(result));
}
