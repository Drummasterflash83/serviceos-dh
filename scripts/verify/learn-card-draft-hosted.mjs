/** Bounded hosted service-to-service card acceptance. No new account or access grant. */
import { readFileSync, writeFileSync, openSync, writeSync, fsyncSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { TEST_PROJECT, savedCliToken } from "./learn-test-readiness.mjs";
import { communicationQuery } from "./learn-card-communication-catalog.mjs";
import { readQueueCatalog, queueInstalledSnapshot } from "./learn-processing-queue-catalog.mjs";
import { edgeInventory } from "./learn-test-email-runtime-deploy.mjs";
const prefix = ".verification-results/card-draft-hosted-service-v3";
const tenant = "ed391000-aaaa-4000-8000-000000000001",
  other = "ed391000-aaaa-4000-8000-000000000009",
  card = "ed391000-aaaa-4000-8000-000000000003";
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'",
  check = (v, s) => {
    if (!v) throw Error(s);
  };
if (
  process.argv.slice(2).join(" ") !== "--run --existing-cli-login" ||
  process.env.LEARN_TEST_ALLOW_PROJECT_REF !== TEST_PROJECT
)
  throw Error("Explicit TEST service acceptance scope required");
const token = savedCliToken(),
  sql = (query, readOnly = true) => communicationQuery(token, query, { readOnly });
const schema = await readQueueCatalog(token);
check(schema.fingerprint === "a1131b60b5fc1c022c772147078365a3", "Exact TEST 070 required");
const inventory = await edgeInventory(token);
check(
  inventory.some(
    (x) =>
      x.slug === "customer-card-sync" && x.version === 2 && x.status === "ACTIVE" && x.verify_jwt,
  ),
  "Exact card endpoint required",
);
const readback = JSON.parse(
  readFileSync(".verification-results/card-draft-runtime-readback-result.json"),
);
check(
  readback.state === "downloaded_runtime_and_handler_tests_verified" &&
    readback.reports.find((x) => x.endpoint === "customer-card-sync")
      ?.downloadedHandlerTestsPassed === 9,
  "Matching downloaded runtime acceptance required",
);
check(
  (
    await sql(
      `select not exists(select 1 from tenants where id in (${q(tenant)},${q(other)})) as absent`,
    )
  )[0]?.absent,
  "Synthetic tenant identity already exists; inspect instead of retrying",
);
const sourceSeed = readFileSync("scripts/verify/learn-card-draft-probe.sql", "utf8");
check(
  createHash("sha256").update(sourceSeed).digest("hex") ===
    "a0c573ed51d368a5a35a4d9e8ddddf2428923e1ed8ffc07017a0dfa1ad2465a7",
  "Rehearsed fixture differs",
);
const seed = sourceSeed
  .replaceAll("ed3900", "ed3910")
  .replaceAll("card-draft-rehearsal", "card-draft-service-v3")
  .replaceAll("card-draft-other", "card-draft-service-other-v3");
const catalogRows = await sql(queueInstalledSnapshot(schema.catalog.phone));
const names = [
  ...new Set([
    ...catalogRows.map((r) => r.name),
    "public.recommendations",
    "public.interaction_match_suggestions",
  ]),
];
check(
  names.length === 123 && names.every((n) => /^(public|auth|vault|storage)\.[a-z_]+$/.test(n)),
  "Complete preservation scope required",
);
const snapshot = names
  .map(
    (n) =>
      `select ${q(n)} as name,count(*)::int as count,md5(coalesce(string_agg(md5(to_jsonb(s)::text),'' order by md5(to_jsonb(s)::text)),'')) as fingerprint from ${n} s where coalesce(to_jsonb(s)->>'tenant_id','') not in (${q(tenant)},${q(other)}) ${n === "public.tenants" ? `and s.id not in (${q(tenant)},${q(other)})` : ""}`,
  )
  .join(" union all ");
const before = await sql(snapshot),
  stable = (rows) => JSON.stringify([...rows].sort((a, b) => a.name.localeCompare(b.name)));
const headers = { Authorization: `Bearer ${token}` };
const keysResponse = await fetch(
  `https://api.supabase.com/v1/projects/${TEST_PROJECT}/api-keys?reveal=true`,
  { headers, redirect: "error", signal: AbortSignal.timeout(30000) },
);
check(keysResponse.ok, "Existing TEST service credential unavailable");
const keys = await keysResponse.json(),
  matching = keys.filter((k) => k.name === "service_role");
check(matching.length === 1, "Unique existing service credential required");
const service = matching[0].api_key;
const claims = JSON.parse(Buffer.from(service.split(".")[1], "base64url").toString());
check(
  claims.ref === TEST_PROJECT && claims.role === "service_role",
  "Service credential target differs",
);
const secretResponse = await fetch(`https://api.supabase.com/v1/projects/${TEST_PROJECT}/secrets`, {
  headers,
  redirect: "error",
  signal: AbortSignal.timeout(30000),
});
check(secretResponse.ok, "Existing internal binding metadata unavailable");
const secretRows = await secretResponse.json();
const binding = secretRows.filter((x) => x.name === "SERVICEOS_INTERNAL_KEY");
const keyDigest = createHash("sha256").update(service).digest("hex");
check(
  binding.length === 1 && [binding[0].digest, binding[0].value].includes(keyDigest),
  "Existing internal binding differs; no key or permission change permitted",
);
const fd = openSync(prefix + "-journal.json", "wx", 0o600);
try {
  writeSync(
    fd,
    JSON.stringify(
      {
        projectRef: TEST_PROJECT,
        tenant,
        other,
        card,
        startedAt: new Date().toISOString(),
        before,
        scope:
          "Two synthetic tenants, zero new logins/grants, maximum three internal HTTP calls, no external provider calls",
      },
      null,
      2,
    ),
  );
  fsyncSync(fd);
} finally {
  closeSync(fd);
}
let submitted = false,
  failure = null;
const checks = [];
const retainedQuery = `select md5(jsonb_build_array((select jsonb_agg(to_jsonb(x) order by id) from email_messages x where tenant_id=${q(tenant)}),(select jsonb_agg(to_jsonb(x) order by id) from interactions x where tenant_id=${q(tenant)}),(select jsonb_agg(to_jsonb(x) order by id) from recommendations x where tenant_id=${q(tenant)}))::text) as digest`;
async function call(scope, body) {
  const r = await fetch(`https://${TEST_PROJECT}.supabase.co/functions/v1/customer-card-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${service}`,
      apikey: service,
      "x-internal-tenant-id": scope,
      "x-serviceos-internal-key": service,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = null;
  }
  return { status: r.status, data };
}
try {
  submitted = true;
  await sql(
    `begin;${seed}\nupdate tenants set metadata=coalesce(metadata,'{}')||'{"card_draft_service_fixture":"v3"}'::jsonb where id in(${q(tenant)},${q(other)});commit;`,
    false,
  );
  const retainedBefore = (await sql(retainedQuery))[0].digest;
  const denied = await call(other, { tenant_id: tenant, customer_card_id: card });
  checks.push({ name: "tenant_mismatch", status: denied.status });
  check(denied.status === 403, "Explicit tenant mismatch was not rejected");
  const isolated = await call(other, { tenant_id: other, customer_card_id: card });
  check(
    isolated.status === 200 && isolated.data?.cards_projected === 0,
    "Cross-tenant card lookup was not empty",
  );
  checks.push({
    name: "cross_tenant_empty",
    status: isolated.status,
    cardsProjected: isolated.data.cards_projected,
  });
  const accepted = await call(tenant, { tenant_id: tenant, customer_card_id: card });
  check(
    accepted.status === 200 &&
      accepted.data?.success === true &&
      accepted.data.cards_projected === 1 &&
      accepted.data.failed === 0,
    "Hosted card refresh unconfirmed",
  );
  checks.push({
    name: "synthetic_card_refresh",
    status: accepted.status,
    cardsProjected: accepted.data.cards_projected,
  });
  const result = (
    await sql(
      `select context->'projection' as projection,context->>'manual_note' as note,latest_activity_at from customer_cards where tenant_id=${q(tenant)} and id=${q(card)}`,
    )
  )[0];
  const p = result?.projection;
  check(
    result?.note === "keep" &&
      p?.communication?.interaction_count === 105 &&
      p.evidence?.excludedDraftInteractions === 110 &&
      p.evidence.sampledInteractions === 100 &&
      p.evidence.excludedDraftRecommendations === 1 &&
      p.operations?.open_recommendations === 51 &&
      p.business?.avg_response_hours === null &&
      p.business.sentiment === null,
    "Saved projection evidence differs",
  );
  check(
    (await sql(retainedQuery))[0].digest === retainedBefore,
    "Synthetic retained sources changed",
  );
  const jobs = await sql(
    `select tenant_id,status,count(*)::int as n from platform_jobs where tenant_id in(${q(tenant)},${q(other)}) group by 1,2`,
  );
  check(
    jobs.length === 2 && jobs.every((j) => j.status === "succeeded" && j.n === 1),
    "Hosted lifecycle receipt unconfirmed",
  );
} catch (e) {
  failure = e.message;
} finally {
  if (submitted) {
    try {
      await sql(
        `begin;update tenants set status='archived' where id in (${q(tenant)},${q(other)}) and metadata->>'card_draft_service_fixture'='v3';update platform_jobs set status='cancelled',cancelled_at=clock_timestamp() where tenant_id in (${q(tenant)},${q(other)}) and status in('queued','running','retrying');commit;`,
        false,
      );
    } catch {
      failure = (failure ? failure + "; " : "") + "Synthetic retirement requires inspection";
    }
  }
}
const after = await sql(snapshot),
  preserved = stable(before) === stable(after);
const retired =
  (
    await sql(
      `select count(*)=2 and bool_and(status='archived' and metadata->>'card_draft_service_fixture'='v3') as retired from tenants where id in (${q(tenant)},${q(other)})`,
    )
  )[0]?.retired === true;
const clean =
  (
    await sql(
      `select not exists(select 1 from profiles where tenant_id in(${q(tenant)},${q(other)})) and not exists(select 1 from email_accounts where tenant_id in(${q(tenant)},${q(other)})) and not exists(select 1 from provider_connections where tenant_id in(${q(tenant)},${q(other)})) and not exists(select 1 from platform_jobs where tenant_id in(${q(tenant)},${q(other)}) and status in('queued','running','retrying')) as clean`,
    )
  )[0]?.clean === true;
const report = {
  version: "learn-card-draft-hosted-service/1",
  projectRef: TEST_PROJECT,
  observedAt: new Date().toISOString(),
  state:
    !failure && preserved && retired && clean
      ? "hosted_service_refresh_verified"
      : "requires_inspection",
  checks,
  preservedDatasets: preserved ? 123 : null,
  syntheticTenantsArchived: retired,
  syntheticAccessAndJobsRetired: clean,
  usersCreated: 0,
  newAccessGrants: 0,
  providerRequests: 0,
  productionChanged: false,
  limitations: [
    "Existing TEST service identity only; this does not prove signed-in user acceptance.",
    "Synthetic fixtures and job evidence are retained in two archived tenants.",
    "No real mailbox capture, production correction, or frontend deployment.",
  ],
  failure,
};
writeFileSync(prefix + "-result.json", JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
if (report.state === "requires_inspection") process.exitCode = 1;
