/** One isolated TEST card-delivery journey through the deployed platform worker. */
import { randomUUID } from "node:crypto";
import { openSync, writeSync, fsyncSync, closeSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
import { readRuntimeCatalog } from "./learn-email-runtime-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";

if (process.argv.slice(2).join(" ") !== "--verify --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST-only identity acceptance required");

const check = (ok, message) => { if (!ok) throw Error(message); };
const token = savedCliToken();
const tenant = randomUUID(), interaction = randomUUID(), job = randomUUID();
const prefix = `.verification-results/build01-identity-hosted-${tenant}`;
const result = {
  version: "build01-identity-hosted-acceptance/1",
  project: TEST_PROJECT, tenant, state: "unconfirmed",
  productionChanged: false, providerRequests: 0, newUsers: 0,
};
let fixtureWritten = false;
try {
  const [runtime, inventory, queue] = await Promise.all([
    readRuntimeCatalog(token), edgeInventory(token),
    communicationQuery(token, `select count(*)::int as active from public.platform_jobs j
      join public.tenants t on t.id=j.tenant_id and t.status='active'
      where j.job_type='identity.resolve' and j.status in('queued','running','retrying')`),
  ]);
  const worker = inventory.find(x => x.slug === "platform-worker");
  check(runtime.fingerprint === "ba3dc925f7f9e1a0149b1a71b9456100",
    "TEST identity schema changed");
  check(worker?.version === 38 && worker.status === "ACTIVE" &&
    worker.verify_jwt === false, "TEST worker changed");
  check(queue[0]?.active === 0, "TEST identity queue must be idle");
  const fd = openSync(prefix + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify({ ...result, workerVersion: worker.version,
      workerHash: worker.ezbr_sha256, schemaFingerprint: runtime.fingerprint,
      interaction, job, startedAt: new Date().toISOString() }, null, 2));
    fsyncSync(fd);
  } finally { closeSync(fd); }

  // No provider account, credential, storage object or real contact is attached.
  const seed = `begin;
    insert into public.tenants(id,slug,display_name,status,metadata)
      values('${tenant}','build01-identity-${tenant}','Synthetic Build 01 identity','active',
        '{"synthetic":true,"purpose":"build01-identity-hosted"}'::jsonb);
    insert into public.interactions(id,tenant_id,source_connector_id,source_type,
      source_table,source_id,interaction_type,direction,occurred_at,phone_from,
      phone_to,summary,processing_status,metadata)
      values('${interaction}','${tenant}','simwood','phone','phone_calls',
        '${randomUUID()}','phone_call','inbound','2026-10-15T10:00:00Z',
        '+441632960321','+441632960001','Synthetic hosted identity card','ready',
        jsonb_build_object('phone_handoff',jsonb_build_object('version',
          'learn-phone-handoff/1','sourceFingerprint',repeat('a',64))));
    insert into public.platform_events(tenant_id,event_type,subject_type,subject_id,
      status,payload) values('${tenant}','interaction.ready','interaction',
        '${interaction}','pending',jsonb_build_object('source_fingerprint',repeat('a',64)));
    insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,
      job_key,status,priority,max_attempts,payload)
      values('${job}','${tenant}','openfolk-core','core.identity',
        'identity.resolve','identity.resolve:${tenant}','queued',50,1,'{"limit":1}'::jsonb);
    commit;`;
  fixtureWritten = true; // An uncertain write response still requires retirement inspection.
  await communicationQuery(token, seed, { readOnly: false });

  const response = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  check(response.ok, "Existing TEST service key unavailable");
  const matches = (await response.json()).filter(k => k.name === "service_role");
  check(matches.length === 1, "Unique TEST service key required");
  const service = matches[0].api_key;
  const claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url"));
  check(claims.ref === TEST_PROJECT && claims.role === "service_role",
    "TEST key scope changed");
  const call = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { apikey: service, Authorization: `Bearer ${service}`,
      "x-serviceos-internal-key": service, "x-internal-tenant-id": tenant,
      "Content-Type": "application/json" },
    body: JSON.stringify({ batch_size: 1, job_types: ["identity.resolve"] }),
  });
  const reply = await call.json().catch(() => null);
  result.http = { status: call.status, claimed: reply?.claimed ?? null,
    succeeded: reply?.succeeded ?? null, failed: reply?.failed ?? null,
    unconfirmed: reply?.unconfirmed ?? null };
  check(call.status === 200 && reply?.claimed === 1, "Hosted worker did not claim fixture");

  const readOutcome = () => communicationQuery(token, `select
    (select status from public.platform_jobs where tenant_id='${tenant}' and id='${job}') as job_status,
    (select records_processed from public.platform_jobs where tenant_id='${tenant}' and id='${job}') as records_processed,
    (select count(*)::int from public.customer_cards where tenant_id='${tenant}') as cards,
    (select count(*)::int from public.learn_identity_delivery_receipts
      where tenant_id='${tenant}' and receipt->>'state'='committed') as receipts,
    (select count(*)::int from public.platform_events
      where tenant_id='${tenant}' and subject_id='${interaction}' and status='consumed') as consumed_events,
    (select count(*)::int from public.interactions
      where tenant_id='${tenant}' and id='${interaction}' and processing_status='enriched') as enriched`);
  let observed;
  for (let attempt = 0; attempt < 12; attempt++) {
    observed = (await readOutcome())[0];
    if (observed?.job_status === "succeeded" ||
        ["dead_letter", "failed"].includes(observed?.job_status)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  check(observed?.job_status === "succeeded" && observed.records_processed === 1 &&
    observed.cards === 1 && observed.receipts === 1 && observed.consumed_events === 1 &&
    observed.enriched === 1, "Hosted source/card/receipt/event chain unconfirmed");
  result.state = "test_hosted_card_delivery_verified";
  result.observed = observed;
} catch (error) {
  result.state = "requires_inspection";
  result.failure = error instanceof Error ? error.message.slice(0, 220) : "Unknown failure";
  process.exitCode = 1;
} finally {
  if (fixtureWritten) {
    try {
      await communicationQuery(token, `update public.tenants set status='archived'
        where id='${tenant}' and metadata->>'purpose'='build01-identity-hosted'`,
        { readOnly: false });
      const rows = await communicationQuery(token,
        `select status from public.tenants where id='${tenant}'`);
      check(rows[0]?.status === "archived", "Synthetic tenant retirement unconfirmed");
      const retired = await communicationQuery(token, `with changed as (
        update public.platform_jobs set status='cancelled',cancelled_at=clock_timestamp(),
          last_error='Archived synthetic Build 01 acceptance fixture retired'
        where tenant_id='${tenant}' and job_type='identity.resolve' and status='queued'
          and attempt_count=0 and max_attempts=1 and lease_expires_at is null
        returning id
      ) select count(*)::int as cancelled from changed`, { readOnly: false });
      check(retired.length === 1 && retired[0].cancelled <= 1,
        "Synthetic queued continuation retirement unconfirmed");
      const pending = await communicationQuery(token, `select count(*)::int as active
        from public.platform_jobs where tenant_id='${tenant}' and job_type='identity.resolve'
          and status in('queued','running','retrying')`);
      check(pending[0]?.active === 0, "Archived fixture still has an active identity job");
      result.fixtureArchived = true;
    } catch {
      result.state = "requires_inspection";
      result.fixtureArchived = false;
      process.exitCode = 1;
    }
  }
  result.observedAt = new Date().toISOString();
  writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
}
