/** Counts-only LIVE diagnosis of the active 50-item identity retry gap. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const uuid = value => typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const revision = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const token = savedCliToken();
const management = `https://api.supabase.com/v1/projects/${project}`;
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: "error",
    signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error(`Identity readback HTTP ${response.status}`);
  return await response.json();
}
async function sql(query) {
  const rows = await request(`${management}/database/query/read-only`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
  if (!Array.isArray(rows)) throw Error("Read-only SQL shape changed");
  return rows;
}
const job = (await sql(`select id::text,attempt_count,max_attempts,next_run_at
from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='identity.resolve' and status='retrying'
  and error_code='identity_delivery_unconfirmed'
order by updated_at desc limit 1`))[0];
if (!job || !uuid(job.id) || !Number.isSafeInteger(job.attempt_count) ||
    !Number.isSafeInteger(job.max_attempts))
  throw Error("Exact active identity retry unavailable");
const keys = await request(`${management}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!Array.isArray(keys)) throw Error("LIVE service key inventory shape changed");
const service = keys.filter(item => item.name === "service_role");
if (service.length !== 1 || typeof service[0].api_key !== "string")
  throw Error("LIVE service key unavailable");
const key = service[0].api_key;
const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url"));
if (claims.ref !== project || claims.role !== "service_role")
  throw Error("LIVE service key claims changed");
// This published SQL STABLE function only selects pending IDs/revisions.
// Use its existing service-role execute grant, but never print either field.
const pending = await request(`https://${project}.supabase.co/rest/v1/rpc/learn_identity_pending`, {
  method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key,
    "Content-Type": "application/json" },
  body: JSON.stringify({ p_tenant: tenant, p_limit: 50 }),
});
if (!Array.isArray(pending) || pending.length > 50 || pending.some(item =>
    !uuid(item.interaction_id) || !revision(item.source_revision)))
  throw Error("Pending identity selection shape changed");
const publications = await sql(`select source_id::text,source_revision,attempt
from public.learn_processing_publications
where tenant_id='${tenant}'::uuid and job_id='${job.id}'::uuid
  and attempt<=${job.attempt_count}`);
if (publications.length > 250 || publications.some(item =>
    !uuid(item.source_id) || !revision(item.source_revision) ||
    !Number.isSafeInteger(item.attempt)))
  throw Error("Identity publication shape changed");
const ids = pending.map(item => `'${item.interaction_id}'::uuid`).join(",");
const types = pending.length ? await sql(`select id::text,source_table,occurred_at
from public.interactions where tenant_id='${tenant}'::uuid
  and id=any(array[${ids}])`) : [];
if (types.length !== pending.length || types.some(item =>
    !uuid(item.id) || typeof item.source_table !== "string" ||
    !Number.isFinite(Date.parse(item.occurred_at))))
  throw Error("Pending source-type lookup changed");
const byId = new Map(types.map(item => [item.id, item]));
const grouped = new Map();
for (const [index, item] of pending.entries()) {
  const source = byId.get(item.interaction_id);
  const type = source.source_table;
  const occurredDay = new Date(source.occurred_at).toISOString().slice(0, 10);
  const row = grouped.get(type) ?? { sourceType: type, currentlyPending: 0,
    withCurrentAttemptReceipt: 0, withAnyAttemptReceipt: 0,
    firstPosition: index + 1, lastPosition: index + 1,
    earliestOccurredDay: occurredDay, latestOccurredDay: occurredDay };
  const exact = publications.filter(pub => pub.source_id === item.interaction_id &&
    pub.source_revision === item.source_revision);
  row.currentlyPending++;
  row.withCurrentAttemptReceipt += Number(exact.some(pub => pub.attempt === job.attempt_count));
  row.withAnyAttemptReceipt += Number(exact.length > 0);
  row.lastPosition = index + 1;
  if (occurredDay < row.earliestOccurredDay) row.earliestOccurredDay = occurredDay;
  if (occurredDay > row.latestOccurredDay) row.latestOccurredDay = occurredDay;
  grouped.set(type, row);
}
console.log(JSON.stringify({ observedAtUtc: new Date().toISOString(), project, tenant,
  retryAttempts: job.attempt_count, maximumAttempts: job.max_attempts,
  nextRetryAtUtc: job.next_run_at, pendingCount: pending.length,
  publicationCountsByAttempt: Object.entries(Object.groupBy(publications,
    pub => pub.attempt)).map(([attempt, group]) => ({ attempt: Number(attempt),
      publications: group.length })),
  pendingBySourceType: [...grouped.values()].sort((a, b) =>
    a.sourceType.localeCompare(b.sourceType)),
  firstPendingSourceType: pending.length ? byId.get(pending[0].interaction_id).source_table : null,
  sourceOrRequestIdsReturned: false, contentReturned: false,
  productionDataWrites: false }));
