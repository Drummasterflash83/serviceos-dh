/** Hosted TEST-only full-sweep rehearsal using six removable synthetic cards. */
import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

if (process.argv.length !== 4 || process.argv[2] !== "--manifest")
  throw Error("Exact TEST stage manifest required");
const privateRoot = resolve(".verification-results");
const manifestPath = resolve(process.argv[3]);
if (!manifestPath.startsWith(privateRoot + "/") || realpathSync(manifestPath) !== manifestPath)
  throw Error("Private TEST manifest path invalid");
const stage = JSON.parse(readFileSync(manifestPath, "utf8"));
if (stage.version !== "learn-build01-recommendation-sweep-stage/1" ||
    stage.label !== "test" || stage.project !== TEST_PROJECT || stage.results.length !== 1 ||
    stage.results[0].slug !== "platform-worker")
  throw Error("TEST recommendation stage changed");
const release = JSON.parse(readFileSync(join(stage.root, "deploy-journal.json"), "utf8"));
const compiled = JSON.parse(readFileSync(join(stage.root, "compile-manifest-network.json"), "utf8"));
if (release.state !== "exact_candidates_deployed" ||
    release.completed[0]?.bodySha256 !== compiled.results[0]?.sha256)
  throw Error("Exact TEST candidate not released");

const tenant = "7cc33974-4051-48eb-b1e2-9af565468709";
const cards = Array.from({ length: 6 }, (_, n) =>
  `f7000000-0000-4000-8000-${(n + 1).toString(16).padStart(12, "0")}`);
const marker = "f7000000-0000-4000-8001-000000000006";
const job = randomUUID();
const token = savedCliToken();
const base = `https://api.supabase.com/v1/projects/${TEST_PROJECT}`;
async function management(path, options = {}) {
  const response = await fetch(base + path, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    redirect: "error", signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`TEST management ${path.split("?")[0]} HTTP ${response.status}`);
  return await response.json();
}
async function sql(query, readOnly = true) {
  const rows = await management(`/database/query${readOnly ? "/read-only" : ""}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, ...(readOnly ? {} : { read_only: false }) }),
  });
  if (!Array.isArray(rows)) throw Error("TEST SQL response shape changed");
  return rows;
}
const current = (await management("/functions")).find(row => row.slug === "platform-worker");
if (!current || current.version !== stage.results[0].version + 1 ||
    current.ezbr_sha256 !== release.completed[0].wireSha256 || current.status !== "ACTIVE")
  throw Error("TEST worker changed since release");
const preflight = (await sql(`select
  (select status from public.tenants where id='${tenant}'::uuid) tenant_status,
  (select count(*)::int from public.customer_cards
    where tenant_id='${tenant}'::uuid and status<>'archived') existing_active_cards,
  (select count(*)::int from public.customer_cards
    where tenant_id='${tenant}'::uuid and id=any(array[${cards.map(id => `'${id}'::uuid`).join(",")}])) fixture_cards,
  (select count(*)::int from public.recommendations where id='${marker}'::uuid) fixture_recommendations,
  (select count(*)::int from public.platform_jobs where job_type='recommendation.sync'
    and status in ('queued','running','retrying')) active_recommendation_jobs`))[0];
if (preflight?.tenant_status !== "archived" || preflight.existing_active_cards < 1 ||
    preflight.fixture_cards !== 0 || preflight.fixture_recommendations !== 0 ||
    preflight.active_recommendation_jobs !== 0)
  throw Error("Archived synthetic TEST fixture or queue changed");
const journalPath = join(stage.root, "hosted-test-journal.json");
const journal = { state: "preflight", startedAtUtc: new Date().toISOString(),
  project: TEST_PROJECT, tenant, cards, marker, job,
  existingActiveCards: preflight.existing_active_cards, workerVersion: current.version };
const save = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
writeFileSync(journalPath, JSON.stringify(journal, null, 2) + "\n", { flag: "wx", mode: 0o600 });

const keys = (await management("/api-keys?reveal=true"))
  .filter(item => item.name === "service_role");
if (keys.length !== 1 || typeof keys[0].api_key !== "string")
  throw Error("TEST service key unavailable");
const key = keys[0].api_key;
const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
if (claims.ref !== TEST_PROJECT || claims.role !== "service_role")
  throw Error("TEST service key claims changed");
const workerUrl = `https://${TEST_PROJECT}.supabase.co/functions/v1/platform-worker`;
const denied = await fetch(workerUrl, { method: "POST", body: "{}",
  headers: { "Content-Type": "application/json" }, redirect: "error",
  signal: AbortSignal.timeout(15000) });
await denied.body?.cancel();
if (denied.status !== 403) throw Error("Unsigned TEST worker request not denied");

const cardValues = cards.map((id, n) =>
  `('${id}'::uuid,'${tenant}'::uuid,'Build 01 synthetic recommendation sweep ${n + 1}',
    'amber','2020-01-0${n + 1}T00:00:00Z'::timestamptz,
    '{"projection":{"business":{},"operations":{}}}'::jsonb)`).join(",");
journal.state = "fixture_insert_pending"; save();
await sql(`begin;set local lock_timeout='3s';
  insert into public.customer_cards(id,tenant_id,title,status,latest_activity_at,context)
    values ${cardValues};
  insert into public.recommendations(id,tenant_id,type,title,status,card_id,created_by,evidence)
    values('${marker}'::uuid,'${tenant}'::uuid,'review_new_contact',
      'Build 01 synthetic stale action','open','${cards.at(-1)}'::uuid,'system','[]'::jsonb);
  insert into public.platform_jobs(id,tenant_id,connector_id,module_id,job_type,job_key,
    status,priority,max_attempts,payload)
    values('${job}'::uuid,'${tenant}'::uuid,'openfolk-core','core.recommendations',
      'recommendation.sync','recommendation.sync:${tenant}','queued',50,1,
      '{"limit":4}'::jsonb);
  commit;`, false);
journal.state = "fixture_inserted"; save();

const startedAt = journal.startedAtUtc;
async function jobs() {
  return await sql(`select status,error_code,coalesce((result->>'selected')::int,0) selected,
    coalesce((result->>'swept')::int,0) swept,
    coalesce((result->>'urgent')::int,0) urgent,
    coalesce((result->>'failed')::int,0) failed,
    available_at,created_at,payload
  from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='recommendation.sync' and job_key='recommendation.sync:${tenant}'
    and created_at>='${startedAt}'::timestamptz
  order by created_at`);
}
let chain = [];
for (let turn = 0; turn < 7; turn++) {
  chain = await jobs();
  if (chain.some(row => row.status in { failed: 1, dead_letter: 1 }))
    throw Error("TEST recommendation chain failed");
  const last = chain.at(-1);
  if (last?.status === "succeeded" && last.swept < 3 &&
      !chain.some(row => ["queued", "running", "retrying"].includes(row.status))) break;
  if (last?.status === "queued") {
    const delay = Date.parse(last.available_at) - Date.now() + 1000;
    if (delay > 0) await new Promise(done => setTimeout(done, Math.min(delay, 70_000)));
  }
  const response = await fetch(workerUrl, { method: "POST", redirect: "error",
    signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${key}`, apikey: key,
      "x-serviceos-internal-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ batch_size: 1, job_types: ["recommendation.sync"] }),
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw Error(`TEST worker HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!Number.isSafeInteger(body.claimed) || !Number.isSafeInteger(body.succeeded) ||
      body.failed !== 0 || body.unconfirmed !== 0)
    throw Error("TEST worker settlement changed");
  journal.lastWorker = { claimed: body.claimed, succeeded: body.succeeded,
    failed: body.failed, unconfirmed: body.unconfirmed };
  journal.state = "worker_observed"; save();
  console.log(JSON.stringify({ state: "test_sweep_progress", observedJobs: chain.length,
    claimed: body.claimed, succeeded: body.succeeded }));
}
chain = await jobs();
const markerState = (await sql(`select status from public.recommendations
  where tenant_id='${tenant}'::uuid and id='${marker}'::uuid`))[0]?.status;
const totalSwept = chain.reduce((n, row) => n + row.swept, 0);
const accepted = chain.length >= 3 && chain.length <= 5 &&
  chain.every(row => row.status === "succeeded" && row.failed === 0) &&
  totalSwept === preflight.existing_active_cards + cards.length &&
  chain.at(-1)?.swept < 3 && markerState === "resolved";
journal.chain = chain.map(row => ({ status: row.status, selected: row.selected,
  swept: row.swept, urgent: row.urgent, failed: row.failed }));
journal.markerState = markerState;
journal.totalSwept = totalSwept;
journal.state = accepted ? "verified_cleanup_pending" : "requires_inspection"; save();
if (!accepted) throw Error("Hosted TEST full sweep unverified; fixture retained");

await sql(`begin;set local lock_timeout='3s';
  delete from public.recommendations where tenant_id='${tenant}'::uuid and id='${marker}'::uuid;
  delete from public.customer_cards where tenant_id='${tenant}'::uuid
    and id=any(array[${cards.map(id => `'${id}'::uuid`).join(",")}]);
  commit;`, false);
const cleanup = (await sql(`select
  (select count(*)::int from public.customer_cards where tenant_id='${tenant}'::uuid
    and id=any(array[${cards.map(id => `'${id}'::uuid`).join(",")}])) cards,
  (select count(*)::int from public.recommendations where tenant_id='${tenant}'::uuid
    and id='${marker}'::uuid) recommendations`))[0];
if (cleanup?.cards !== 0 || cleanup.recommendations !== 0)
  throw Error("TEST synthetic fixture cleanup unconfirmed");
journal.state = "hosted_test_full_sweep_verified";
journal.cleanup = cleanup;
journal.finishedAtUtc = new Date().toISOString(); save();
const receipt = { state: journal.state, project: TEST_PROJECT,
  workerVersion: current.version,
  candidateHandlerSha256: stage.results[0].candidateHandlerSha256,
  workerArtifactSha256: compiled.results[0].sha256,
  syntheticCards: cards.length, existingActiveCards: preflight.existing_active_cards,
  settledJobs: chain.length, totalSwept, markerResolved: true,
  cleanupVerified: true, unsignedStatus: denied.status,
  providerRequests: 0, liveWrites: 0 };
writeFileSync(join(stage.root, "hosted-test-receipt.json"), JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(receipt));
