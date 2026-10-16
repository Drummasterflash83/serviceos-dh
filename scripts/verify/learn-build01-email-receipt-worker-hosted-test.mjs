/** Two synthetic unchanged Email revisions through the deployed TEST worker. */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--test-v2 --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Exact TEST-only Email hosted acceptance allowlist required");
const prefix = ".verification-results/learn-build01-email-receipt-window/test-hosted-acceptance-v2";
if (existsSync(prefix + ".json") || existsSync(prefix + "-journal.json"))
  throw Error("Earlier hosted Email acceptance needs inspection");
const token = savedCliToken(), tenant = randomUUID(), job = randomUUID();
const sources = [randomUUID(), randomUUID()];
const interactions = [randomUUID(), randomUUID()];
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
async function query(sql, readOnly = true) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ query: sql, ...(!readOnly ? { read_only: false } : {}) }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw Error(`TEST fixture query HTTP ${response.status} (${typeof detail.code === "string" ? detail.code : "unknown"})`);
  }
  return response.json();
}
async function workerCall(service) {
  const response = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { apikey: service, Authorization: `Bearer ${service}`,
      "x-serviceos-internal-key": service, "x-internal-tenant-id": tenant,
      "Content-Type": "application/json" },
    body: JSON.stringify({ batch_size: 1, job_types: ["interactions.sync"] }),
  });
  const reply = await response.json().catch(() => null);
  return { status: response.status, claimed: reply?.claimed ?? null,
    succeeded: reply?.succeeded ?? null, failed: reply?.failed ?? null,
    unconfirmed: reply?.unconfirmed ?? null };
}
let fixtureWritten = false;
const result = { state: "requires_inspection", project: TEST_PROJECT,
  workerVersion: null, workerWireSha256: null, first: null, second: null,
  fixtureArchived: false, productionChanged: false, providerRequests: 0 };
try {
  const release = JSON.parse(readFileSync(
    ".verification-results/build01-email-receipt-worker-test-result.json", "utf8"));
  const inventory = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!inventory.ok) throw Error("TEST worker inventory unavailable");
  const worker = (await inventory.json()).find((row) => row.slug === "platform-worker");
  if (release.state !== "deployed_needs_hosted_acceptance" ||
      worker?.version !== release.afterVersion ||
      worker?.ezbr_sha256 !== release.afterWireSha256 ||
      worker?.status !== "ACTIVE" || worker?.verify_jwt !== false)
    throw Error("Exact TEST worker release changed");
  result.workerVersion = worker.version;
  result.workerWireSha256 = worker.ezbr_sha256;
  writeFileSync(prefix + "-journal.json", JSON.stringify({ state: "prepared",
    tenant, job, sources, interactions, workerVersion: worker.version }, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  const seed = `begin;
insert into public.tenants(id,slug,display_name,status,metadata)
 values('${tenant}'::uuid,'build01-email-${tenant}','Synthetic Email receipt acceptance',
 'active','{"synthetic":true,"purpose":"build01-email-receipt-hosted"}'::jsonb);
insert into public.email_messages(id,tenant_id,provider,provider_message_id,
 received_at,created_at,updated_at,from_email,to_emails,subject,snippet,direction,raw_payload)
 values ${sources.map((source, n) => `('${source}'::uuid,'${tenant}'::uuid,'gmail',
 'synthetic-${source}',now()-interval '1 day',now()-interval '1 day',
 now()-interval '30 minutes','synthetic@example.invalid','[]',
 'Synthetic Email ${n}','Synthetic only','inbound','{}')`).join(",")};
insert into public.interactions(id,tenant_id,source_connector_id,source_type,
 source_table,source_id,interaction_type,occurred_at,metadata)
 select case m.id when '${sources[0]}'::uuid then '${interactions[0]}'::uuid
  else '${interactions[1]}'::uuid end,'${tenant}'::uuid,'email','email',
  'email_messages',m.id,'email_message',coalesce(m.received_at,m.created_at),
  jsonb_build_object('source_projection',jsonb_build_object('revision',
   public.learn_projection_revision(public.learn_email_source_fields(m),'')))
 from public.email_messages m where m.id in ('${sources[0]}'::uuid,'${sources[1]}'::uuid);
insert into public.learn_interaction_projection_receipts
 (request_id,tenant_id,source_kind,source_id,source_revision,receipt,created_at)
 select gen_random_uuid(),'${tenant}'::uuid,'email',m.id,
  public.learn_projection_revision(public.learn_email_source_fields(m),''),
  '{"state":"committed","action":"created"}'::jsonb,now()-interval '1 hour'
 from public.email_messages m where m.id in ('${sources[0]}'::uuid,'${sources[1]}'::uuid);
insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,
 job_key,status,priority,max_attempts,payload)
 values('${job}'::uuid,'${tenant}'::uuid,'openfolk-core','core.interactions',
 'interactions.sync','interactions.sync:${tenant}:email:older','queued',50,1,
 '{"source":"email","limit":1}'::jsonb);
commit;`;
  fixtureWritten = true;
  await query(seed, false);
  const keys = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!keys.ok) throw Error("Existing TEST service key unavailable");
  const matches = (await keys.json()).filter((key) => key.name === "service_role");
  if (matches.length !== 1) throw Error("Unique TEST service key required");
  const service = matches[0].api_key;
  const claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url"));
  if (claims.ref !== TEST_PROJECT || claims.role !== "service_role")
    throw Error("TEST service key scope changed");
  const first = await workerCall(service);
  const firstRows = await query(`select j.status,j.records_processed,
   coalesce((j.result->>'skipped')::int,-1) skipped,
   coalesce((j.result->>'continued')::boolean,false) continued,
   (select count(*)::int from public.platform_jobs c where c.parent_job_id=j.id) successors,
   (select count(*)::int from public.learn_interaction_projection_receipts r
    where r.tenant_id=j.tenant_id and r.source_kind='email'
     and r.receipt->>'state'='committed' and r.receipt->>'action'='unchanged')
    unchanged_receipts
   from public.platform_jobs j where j.id='${job}'::uuid and j.tenant_id='${tenant}'::uuid`);
  result.first = { http: first, job: firstRows[0] ?? null };
  if (first.status !== 200 || first.claimed !== 1 || firstRows.length !== 1 ||
      firstRows[0].status !== "succeeded" || firstRows[0].skipped !== 1 ||
      firstRows[0].continued !== true || firstRows[0].successors !== 1 ||
      firstRows[0].unchanged_receipts !== 1)
    throw Error("TEST first unchanged receipt/continuation unconfirmed");
  const second = await workerCall(service);
  const secondRows = await query(`select j.status,j.payload->>'limit' batch_limit,
   coalesce((j.result->>'skipped')::int,-1) skipped,
   coalesce((j.result->>'continued')::boolean,false) continued,
   (select count(*)::int from public.learn_interaction_projection_receipts r
    where r.tenant_id=j.tenant_id and r.source_kind='email'
     and r.receipt->>'state'='committed' and r.receipt->>'action'='unchanged')
    unchanged_receipts,
   (select count(*)::int from public.platform_jobs c where c.tenant_id=j.tenant_id
     and c.job_type='interactions.sync' and c.id<>j.id) other_jobs
   from public.platform_jobs j where j.tenant_id='${tenant}'::uuid
    and j.job_type='interactions.sync' and j.id<>'${job}'::uuid
   order by j.created_at limit 1`);
  result.second = { http: second, job: secondRows[0] ?? null };
  if (second.status !== 200 || second.claimed !== 1 || secondRows.length !== 1 ||
      secondRows[0].status !== "succeeded" || secondRows[0].batch_limit !== "50" ||
      secondRows[0].skipped !== 1 || secondRows[0].continued !== false ||
      secondRows[0].unchanged_receipts !== 2 || secondRows[0].other_jobs !== 1)
    throw Error("TEST second Email receipt/completion unconfirmed");
  result.state = "email_receipt_worker_test_accepted";
} catch (error) {
  result.failure = error instanceof Error ? error.message.slice(0, 160) : "Unknown failure";
  process.exitCode = 1;
} finally {
  if (fixtureWritten) {
    try {
      await query(`begin;
update public.tenants set status='archived' where id='${tenant}'::uuid
 and metadata->>'purpose'='build01-email-receipt-hosted';
update public.platform_jobs set status='cancelled',cancelled_at=clock_timestamp()
 where tenant_id='${tenant}'::uuid and job_type='interactions.sync'
 and status='queued' and attempt_count=0;
commit;`, false);
      const rows = await query(`select status from public.tenants where id='${tenant}'::uuid`);
      result.fixtureArchived = rows[0]?.status === "archived";
      if (!result.fixtureArchived) { result.state = "requires_inspection"; process.exitCode = 1; }
    } catch {
      result.fixtureArchived = false;
      result.state = "requires_inspection";
      process.exitCode = 1;
    }
  }
  result.observedAt = new Date().toISOString();
  writeFileSync(prefix + ".json", JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
}
