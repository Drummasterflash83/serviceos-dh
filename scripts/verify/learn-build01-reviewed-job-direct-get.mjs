/** Bounded LIVE comparison of three reviewed source-linked jobs to current provider GETs.
 * Job IDs, source values and provider response bodies stay in this process only. */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const keyPath = resolve(".verification-results/commusoft-existing-private-key");
const idValid = value => typeof value === "string" && /^[1-9][0-9]{0,15}$/.test(value);
const query = `with source as materialized (
  select s.external_id,s.source_status,s.observed_at,s.property_reference,
    s.relationship_state from public.provider_connections c
  cross join lateral public.learn_commusoft_source_job_rows(c.tenant_id,c.id) s
  where c.tenant_id='${tenant}'::uuid and c.provider='commusoft'
    and c.revoked_at is null and s.reviewed_job_id is not null
    and s.source_status in ('Open','ongoing','pending','on_hold')
), ranked as (
  select *,row_number() over(partition by relationship_state
    order by observed_at desc,external_id) rank_in_relationship from source
)
select external_id,source_status,observed_at,property_reference,relationship_state
from ranked where
  (relationship_state='customer_source_retained' and rank_in_relationship<=2)
  or (relationship_state='site_customer_source_retained' and rank_in_relationship=1)
order by relationship_state,observed_at desc`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `begin read only;set local statement_timeout=45000;
    set local enable_nestloop=off;${query};commit;` }),
});
if (!response.ok) throw Error(`Reviewed-job source query HTTP ${response.status}`);
const jobs = await response.json();
if (!Array.isArray(jobs) || jobs.length !== 3 ||
    jobs.filter(row => row.relationship_state === "customer_source_retained").length !== 2 ||
    jobs.filter(row => row.relationship_state === "site_customer_source_retained").length !== 1 ||
    jobs.some(row => !idValid(row.external_id) || !idValid(row.property_reference) ||
      !["Open", "ongoing", "pending", "on_hold"].includes(row.source_status) ||
      !Number.isFinite(Date.parse(row.observed_at))))
  throw Error("Reviewed-job sample changed");

const keyStat = lstatSync(keyPath);
if (!keyStat.isFile() || keyStat.isSymbolicLink() || keyStat.uid !== process.getuid() ||
    (keyStat.mode & 0o077) !== 0 || keyStat.size < 16 || keyStat.size > 4096 ||
    realpathSync(keyPath) !== keyPath)
  throw Error("Existing private Commusoft key unavailable");
const key = readFileSync(keyPath, "utf8").trim();
if (key.length < 16 || key.length > 4096 || /\s/.test(key))
  throw Error("Existing private Commusoft key shape changed");

async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("Reviewed-job response body unavailable");
  const parts = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 256 * 1024) {
      await reader.cancel();
      throw Error("Reviewed-job response over bound");
    }
    parts.push(value);
  }
  const bytes = Buffer.concat(parts);
  try { return JSON.parse(bytes.toString("utf8")); }
  finally { bytes.fill(0); for (const part of parts) part.fill(0); }
}

const observations = [];
for (const job of jobs) {
  const current = await fetch(`https://app.commusoft.co.uk/api/v2/jobs/${job.external_id}`, {
    method: "GET", redirect: "error", cache: "no-store", credentials: "omit",
    signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${key}`, "X-API-VERSION": "2.0",
      "User-Agent": "OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)", Accept: "application/json" },
  });
  if (current.status !== 200) {
    await current.body?.cancel();
    throw Error(`Reviewed-job direct GET HTTP ${current.status}`);
  }
  const record = await boundedJson(current);
  if (String(record?.id) !== job.external_id) throw Error("Reviewed-job provider identity changed");
  observations.push({ relationship: job.relationship_state,
    retainedStatus: job.source_status, currentStatus: record.status,
    statusMatches: record.status === job.source_status,
    propertyMatches: String(record.propertyID) === job.property_reference,
    retainedObservationAgeHours: Math.round((Date.now() - Date.parse(job.observed_at)) / 3600000),
    assignmentFieldPresent: Array.isArray(record.usersCurrentlyAssignedToJob),
    assignedUsersCount: Array.isArray(record.usersCurrentlyAssignedToJob)
      ? record.usersCurrentlyAssignedToJob.length : null,
  });
  await new Promise(done => setTimeout(done, 1000));
}
console.log(JSON.stringify({ observedAtUtc: new Date().toISOString(), project, tenant,
  reviewedSourceLinkedSample: observations.length, observations,
  jobIdsOrProviderBodiesReturned: false, providerWrites: false, databaseWrites: false,
  limitation: "Three current provider GETs do not prove all 295 recorded open jobs are current, confirm a technician, or authorize a score." }));
