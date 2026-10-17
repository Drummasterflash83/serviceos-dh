/** Hosted TEST-only proof that a post-cursor card is projected during the old sweep. */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";

if (process.argv.slice(2).join(" ") !== "--test --existing-cli-login" ||
    process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT)
  throw Error("Explicit TEST-only card freshness allowlist required");
const prefix = ".verification-results/build01-card-freshness-hosted-test";
if (existsSync(prefix + "-journal.json") || existsSync(prefix + "-result.json"))
  throw Error("Prior hosted card freshness test requires inspection");
const token = savedCliToken();
const tenant = randomUUID(), job = randomUUID();
const cutoff = "2026-10-17T13:17:01.157Z";
const oldAt = "2026-10-16T12:00:00Z";
const freshAt = "2026-10-17T14:48:19Z";
const fixtures = Array.from({ length: 11 }, (_, n) => ({
  person: randomUUID(), card: randomUUID(), n,
}));
const result = { version: "learn-build01-card-freshness-hosted-test/1",
  state: "unconfirmed", project: TEST_PROJECT, tenant,
  workerVersion: null, workerWireSha256: null,
  candidateHandlerSha256: null, candidateClosureSha256: null,
  productionChanged: false, providerRequests: 0, newUsers: 0 };
let fixtureWritten = false;
try {
  const inv = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/functions`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!inv.ok) throw Error("TEST worker inventory unavailable");
  const worker = (await inv.json()).find((row) => row.slug === "platform-worker");
  const release = JSON.parse(readFileSync(
    ".verification-results/build01-card-freshness-worker-test-result.json", "utf8"));
  if (release.state !== "deployed_needs_hosted_acceptance" ||
      worker?.version !== release.afterVersion ||
      worker?.ezbr_sha256 !== release.afterWireSha256 ||
      worker?.status !== "ACTIVE" || worker.verify_jwt !== false)
    throw Error("Exact TEST worker release changed");
  result.workerVersion = worker.version;
  result.workerWireSha256 = worker.ezbr_sha256;
  result.candidateHandlerSha256 = release.candidateHandlerSha256;
  result.candidateClosureSha256 = release.candidateClosureSha256;
  writeFileSync(prefix + "-journal.json", JSON.stringify({ state: "prepared",
    tenant, job, workerVersion: worker.version, workerWire: worker.ezbr_sha256 },
  null, 2) + "\n", { flag: "wx", mode: 0o600 });

  const seed = `begin;
    insert into public.tenants(id,slug,display_name,status,metadata)
    values('${tenant}','build01-card-fresh-${tenant}',
      'Synthetic card freshness acceptance','active',
      '{"synthetic":true,"purpose":"build01-card-freshness-hosted"}'::jsonb);
    insert into public.people(id,tenant_id,display_name,primary_email,metadata)
    values ${fixtures.map(({ person, n }) => `('${person}','${tenant}',
      'Synthetic card ${n}','fresh-${n}@example.invalid',
      '{"synthetic":true}'::jsonb)`).join(",")};
    insert into public.customer_cards(id,tenant_id,person_id,title,status,context,updated_at)
    values ${fixtures.map(({ card, person, n }) => `('${card}','${tenant}',
      '${person}','Synthetic card ${n}','grey',
      ${n === 10 ? "'{}'" : "'{\"projection\":{\"version\":1}}'"}::jsonb,
      '${n === 10 ? freshAt : oldAt}'::timestamptz)`).join(",")};
    insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,
      job_key,status,priority,max_attempts,payload)
    values('${job}','${tenant}','openfolk-core','core.customer-card',
      'customer_card.sync','customer_card.sync:${tenant}','queued',50,1,
      '{"limit":10,"sweep_since":"${cutoff}"}'::jsonb);
    commit;`;
  fixtureWritten = true;
  await communicationQuery(token, seed, { readOnly: false });
  const before = await communicationQuery(token, `select
    count(*)::int cards,
    count(*) filter(where context?'projection')::int projected,
    count(*) filter(where updated_at='${oldAt}'::timestamptz)::int old_at,
    count(*) filter(where updated_at='${freshAt}'::timestamptz)::int fresh_at
    from public.customer_cards where tenant_id='${tenant}'::uuid`);
  if (before.length !== 1 || before[0].cards !== 11 ||
      before[0].projected !== 10 || before[0].old_at !== 10 ||
      before[0].fresh_at !== 1)
    throw Error("Synthetic card fixture changed before worker call");

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
    throw Error("TEST key scope changed");
  const call = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { apikey: service, Authorization: `Bearer ${service}`,
      "x-serviceos-internal-key": service, "x-internal-tenant-id": tenant,
      "Content-Type": "application/json" },
    body: JSON.stringify({ batch_size: 1, job_types: ["customer_card.sync"] }),
  });
  const reply = await call.json().catch(() => null);
  result.http = { status: call.status, claimed: reply?.claimed ?? null,
    succeeded: reply?.succeeded ?? null, failed: reply?.failed ?? null,
    unconfirmed: reply?.unconfirmed ?? null };
  const observed = await communicationQuery(token, `select
    (select status from public.platform_jobs where id='${job}'::uuid) job_status,
    (select coalesce((result->>'swept')::int,-1) from public.platform_jobs
      where id='${job}'::uuid) swept,
    (select coalesce((result->>'skipped')::int,-1) from public.platform_jobs
      where id='${job}'::uuid) skipped,
    (select count(*)::int from public.platform_jobs where tenant_id='${tenant}'::uuid
      and job_type='customer_card.sync' and id<>'${job}'::uuid) successors,
    (select count(*)::int from public.customer_cards where tenant_id='${tenant}'::uuid
      and id='${fixtures[10].card}'::uuid
      and updated_at>'${freshAt}'::timestamptz) fresh_advanced,
    (select count(*)::int from public.customer_cards where tenant_id='${tenant}'::uuid
      and id<>'${fixtures[10].card}'::uuid
      and updated_at>'${oldAt}'::timestamptz) old_advanced,
    (select count(*)::int from public.customer_cards where tenant_id='${tenant}'::uuid)
      retained_cards`);
  result.observed = observed[0] ?? null;
  if (call.status !== 200 || reply?.claimed !== 1 || reply?.succeeded !== 1 ||
      observed.length !== 1 || observed[0].job_status !== "succeeded" ||
      observed[0].swept !== 10 || observed[0].skipped !== 10 ||
      observed[0].successors !== 1 || observed[0].fresh_advanced !== 1 ||
      observed[0].old_advanced !== 9 || observed[0].retained_cards !== 11)
    throw Error("Hosted post-cursor priority and old-sweep progress unconfirmed");
  result.state = "accepted";
} catch (error) {
  result.state = "requires_inspection";
  result.failure = error instanceof Error ? error.message.slice(0, 150) : "Unknown failure";
  process.exitCode = 1;
} finally {
  if (fixtureWritten) {
    try {
      await communicationQuery(token, `begin;
        update public.tenants set status='archived' where id='${tenant}'::uuid
          and metadata->>'purpose'='build01-card-freshness-hosted';
        update public.platform_jobs set status='cancelled',
          cancelled_at=clock_timestamp() where tenant_id='${tenant}'::uuid
          and job_type='customer_card.sync' and status='queued' and attempt_count=0;
        commit;`, { readOnly: false });
      const archived = await communicationQuery(token,
        `select status from public.tenants where id='${tenant}'::uuid`);
      result.fixtureArchived = archived[0]?.status === "archived";
      if (!result.fixtureArchived) {
        result.state = "requires_inspection";
        process.exitCode = 1;
      }
    } catch {
      result.fixtureArchived = false;
      result.state = "requires_inspection";
      process.exitCode = 1;
    }
  }
  result.observedAt = new Date().toISOString();
  writeFileSync(prefix + "-result.json", JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify(result));
}
