/** Synthetic hosted source -> interaction -> card check. No users, grants or providers. */
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
const prefix = ".verification-results/processing-queue-hosted-v1";
const check = (v, m) => {
  if (!v) throw Error(m);
};
const stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
let token,
  tenant,
  snapshot,
  before,
  schema,
  journaled = false;
const result = {
  projectRef: TEST_PROJECT,
  state: "unconfirmed",
  newUsers: 0,
  newAccessGrants: 0,
  providerRequests: 0,
  productionChanged: false,
  workerRuns: [],
};
try {
  check(
    process.argv.slice(2).join(" ") === "--verify --existing-cli-login" &&
      process.env.LEARN_TEST_ALLOW_PROJECT_REF === TEST_PROJECT,
    "Explicit TEST verification required",
  );
  const deploy = JSON.parse(
    readFileSync(".verification-results/processing-queue-runtime-deploy-result.json"),
  );
  check(
    deploy.state === "deployed_needs_http_acceptance" && deploy.endpoints?.[0]?.version === 11,
    "Exact runtime deployment required",
  );
  token = savedCliToken();
  schema = await readQueueCatalog(token);
  check(
    schema.fingerprint === "e7897de65753b003869960b6b054215d",
    "Exact installed schema required",
  );
  const edge = (await edgeInventory(token)).find((x) => x.slug === "platform-worker");
  check(
    edge?.version === 11 && edge.status === "ACTIVE" && edge.verify_jwt === false,
    "Exact worker required",
  );
  tenant = randomUUID();
  const call = randomUUID(),
    email = randomUUID(),
    jobs = Array.from({ length: 4 }, () => randomUUID());
  snapshot = queueInstalledSnapshot(schema.catalog.phone).replace(
    /from (public\.[a-z_]+) s/g,
    (_m, n) =>
      `from ${n} s where to_jsonb(s)->>'tenant_id' is distinct from '${tenant}'${n === "public.tenants" ? ` and s.id<>'${tenant}'::uuid` : ""}`,
  );
  before = await communicationQuery(token, snapshot);
  check(before.length === 121, "Complete preservation baseline required");
  const gate = (
    await communicationQuery(
      token,
      `select (select count(*) from public.platform_jobs where status in('queued','running','retrying'))::int as jobs,(select count(*) from public.tenants where id='${tenant}')::int as existing`,
    )
  )[0];
  check(gate.jobs === 0 && gate.existing === 0, "Idle TEST queue and absent fixture required");
  const journal = {
    projectRef: TEST_PROJECT,
    tenant,
    call,
    email,
    jobs,
    before,
    startedAt: new Date().toISOString(),
    schema: schema.fingerprint,
  };
  const fd = openSync(prefix + "-journal.json", "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(journal, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  journaled = true;
  const keyResponse = await fetch(
    `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  check(keyResponse.ok, "Existing TEST key unavailable");
  const keys = await keyResponse.json(),
    matches = keys.filter((k) => k.name === "service_role");
  check(matches.length === 1, "Unique service key required");
  const service = matches[0].api_key,
    claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url"));
  check(
    claims.ref === TEST_PROJECT && claims.role === "service_role",
    "Existing key scope differs",
  );
  const headers = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "x-serviceos-internal-key": service,
    "Content-Type": "application/json",
  };
  const url = `https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`;
  async function pendingCount() {
    const response = await fetch(
      `https://${TEST_PROJECT}.supabase.co/rest/v1/rpc/learn_projection_pending`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ p_tenant: tenant, p_source: "all", p_limit: 20 }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      },
    );
    check(response.ok, "Scoped pending inventory unavailable");
    const rows = await response.json();
    check(Array.isArray(rows), "Pending inventory invalid");
    return rows.length;
  }
  const denied = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  check(denied.status === 403, "Unsigned worker access not denied");
  result.unsignedStatus = denied.status;
  await communicationQuery(
    token,
    `begin;
 insert into tenants(id,slug,display_name,status,metadata) values('${tenant}','projection-${tenant}','Synthetic interaction projection','active','{"synthetic":true,"purpose":"processing-queue-http"}');
 insert into phone_calls(id,tenant_id,provider,provider_call_id,direction,started_at,from_number,to_number,duration_seconds) values('${call}','${tenant}','sipcentric','synthetic-${call}','IN','2026-10-11T13:00:00Z','+441632960030','+441632960001',12);
 insert into email_messages(id,tenant_id,provider,provider_message_id,from_email,to_emails,cc_emails,snippet,direction,received_at) values('${email}','${tenant}','gmail','synthetic-${email}','customer@example.invalid','["office@example.invalid"]','[]','Synthetic hosted email preview','inbound','2026-10-11T13:01:00Z');
 commit;`,
    { readOnly: false },
  );
  async function runJob(index, type, expected) {
    const key =
      type === "interactions.sync"
        ? `interactions.sync:${tenant}:all`
        : `identity.resolve:${tenant}`;
    await communicationQuery(
      token,
      `insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,status,priority,max_attempts,payload) values('${jobs[index]}','${tenant}','openfolk-core','${type === "interactions.sync" ? "core.interactions" : "core.identity"}','${type}','${key}','queued',50,1,'{"source":"all","limit":1}');`,
      { readOnly: false },
    );
    let total = 0,
      completed = 0;
    for (let step = 0; step < 4; step++) {
      const active = await communicationQuery(
        token,
        `select id,tenant_id,job_type,status from public.platform_jobs where status in('queued','running','retrying') order by id`,
      );
      if (!active.length) break;
      check(
        active.length === 1 &&
          active[0].tenant_id === tenant &&
          active[0].job_type === type &&
          active[0].status === "queued",
        "Exact synthetic next job required",
      );
      const id = active[0].id;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ batch_size: 1, job_types: [type] }),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      const body = await response.json();
      result.workerRuns.push({
        type,
        status: response.status,
        claimed: body.claimed,
        succeeded: body.succeeded,
        failed: body.failed,
        unconfirmed: body.unconfirmed,
      });
      check(
        response.status === 200 &&
          body.claimed === 1 &&
          body.succeeded === 1 &&
          body.failed === 0 &&
          body.unconfirmed === 0,
        "Hosted worker run unconfirmed",
      );
      const job = (
        await communicationQuery(
          token,
          `select j.status,j.records_processed,j.result,(select count(*) from public.learn_processing_settlements s where s.job_id=j.id and s.tenant_id=j.tenant_id and s.receipt->>'state'='succeeded')::int as receipts from public.platform_jobs j where j.id='${id}' and j.tenant_id='${tenant}'`,
        )
      )[0];
      check(
        job?.status === "succeeded" &&
          job.result?.failed === 0 &&
          job.receipts === 1 &&
          [0, 1].includes(job.records_processed),
        "Stored job/settlement unconfirmed",
      );
      total += job.records_processed;
      completed++;
    }
    check(
      total === expected && completed === expected + 1,
      "Bounded batch continuation did not drain the complete fixture",
    );
  }
  await runJob(0, "interactions.sync", 2);
  await runJob(1, "identity.resolve", 2);
  const links = await communicationQuery(
    token,
    `select id,related_person_id,metadata->'identity_delivery'->>'cardId' as card from public.interactions where tenant_id='${tenant}' order by id`,
  );
  check(
    links.length === 2 && links.every((x) => x.related_person_id && x.card),
    "Linked cards missing",
  );
  const sourceBefore = await communicationQuery(
    token,
    `select (select count(*) from public.customer_cards where tenant_id='${tenant}')::int as cards,(select count(*) from public.platform_events where tenant_id='${tenant}' and status='pending')::int as pending,(select count(*) from public.customer_cards where tenant_id='${tenant}' and summary='Synthetic hosted email preview')::int as email_cards`,
  );
  check(
    sourceBefore[0]?.cards === 2 &&
      sourceBefore[0].pending === 0 &&
      (await pendingCount()) === 0 &&
      sourceBefore[0].email_cards === 1,
    "Initial source-to-card state differs",
  );
  await communicationQuery(
    token,
    `update public.email_messages set snippet='Updated hosted email reaches existing card' where id='${email}' and tenant_id='${tenant}'`,
    { readOnly: false },
  );
  await runJob(2, "interactions.sync", 1);
  await runJob(3, "identity.resolve", 1);
  const afterLinks = await communicationQuery(
    token,
    `select id,related_person_id,metadata->'identity_delivery'->>'cardId' as card from public.interactions where tenant_id='${tenant}' order by id`,
  );
  check(
    JSON.stringify(links) === JSON.stringify(afterLinks),
    "Identity or card links changed on source refresh",
  );
  const final = (
    await communicationQuery(
      token,
      `select
 (select count(*) from public.customer_cards where tenant_id='${tenant}')::int as cards,
 (select count(*) from public.customer_cards where tenant_id='${tenant}' and summary='Updated hosted email reaches existing card')::int as refreshed_cards,
 (select count(*) from public.interactions where tenant_id='${tenant}' and processing_status='enriched')::int as enriched,
 (select count(*) from public.platform_events where tenant_id='${tenant}' and status='pending')::int as pending,
 (select count(*) from public.platform_events where tenant_id='${tenant}' and status='consumed')::int as consumed,
 (select count(*) from public.learn_interaction_projection_receipts where tenant_id='${tenant}')::int as projection_receipts,
 (select count(*) from public.learn_identity_delivery_receipts where tenant_id='${tenant}')::int as identity_receipts,
 (select count(*) from public.learn_processing_publications where tenant_id='${tenant}')::int as fenced_publications,
 (select count(*) from public.learn_processing_settlements where tenant_id='${tenant}')::int as queue_settlements,
 (select count(*) from public.phone_sync_runs where tenant_id='${tenant}')::int as provider_runs,
 (select count(*) from public.phone_recordings where tenant_id='${tenant}')::int as recordings,
 (select count(*) from public.interactions where tenant_id='${tenant}' and source_id='${call}' and source_connector_id='sipcentric')::int as actual_provider`,
    )
  )[0];
  check(
    final.fenced_publications === 6 &&
      final.queue_settlements === 10 &&
      final.cards === 2 &&
      final.refreshed_cards === 1 &&
      final.enriched === 2 &&
      final.pending === 0 &&
      final.consumed === 3 &&
      final.projection_receipts === 3 &&
      final.identity_receipts === 3 &&
      (await pendingCount()) === 0 &&
      final.provider_runs === 0 &&
      final.recordings === 0 &&
      final.actual_provider === 1,
    "Final retained source/card/event state differs",
  );
  result.state = "hosted_durable_queue_drain_and_incremental_card_refresh_verified";
  result.delivery = final;
  result.identityAndCardLinksPreserved = true;
} catch (e) {
  result.state = "requires_inspection";
  result.failure =
    typeof e?.message === "string" && e.message.length < 220
      ? e.message
      : "Hosted check unconfirmed";
  process.exitCode = 1;
} finally {
  if (journaled) {
    try {
      await communicationQuery(
        token,
        `update public.tenants set status='archived' where id='${tenant}' and metadata->>'purpose'='processing-queue-http'`,
        { readOnly: false },
      );
      const retired = (
        await communicationQuery(
          token,
          `select status='archived' as archived from public.tenants where id='${tenant}'`,
        )
      )[0]?.archived;
      const after = await communicationQuery(token, snapshot),
        catalog = await readQueueCatalog(token);
      check(
        (retired === true || retired === undefined) &&
          stable(before) === stable(after) &&
          catalog.fingerprint === schema.fingerprint,
        "Fixture retirement or preservation unconfirmed",
      );
      result.fixtureArchived = retired === true;
      result.fixtureAbsent = retired === undefined;
      result.preservedNonFixtureDatasets = 121;
      result.schemaUnchanged = true;
    } catch {
      result.state = "requires_inspection";
      result.retirementOrPreservationUnconfirmed = true;
      process.exitCode = 1;
    }
  }
  result.observedAt = new Date().toISOString();
  result.limitations = [
    "Synthetic retained Phone/Email sources and existing internal TEST authority; no real provider or signed-in browser acceptance.",
    "Synthetic records remain in an archived fixture tenant. Broader queue types and signed-in operator acceptance are separate gates.",
    "The manual interactions-sync endpoint has not been deployed; this verifies the actual queued platform-worker path.",
  ];
  writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
}
