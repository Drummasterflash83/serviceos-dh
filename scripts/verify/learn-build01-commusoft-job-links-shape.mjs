/** Aggregate-only LIVE job-link shape; no payloads, URLs or identifiers returned. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with jobs as materialized (
  select payload from public.learn_business_input_versions
  where tenant_id='${tenant}'::uuid and provider='commusoft' and collection='jobs'
), shape as (
  select 'inventory' as level,'job_versions' as key,count(*)::int records from jobs
  union all
  select 'top' as level,key,count(*)::int records from jobs
  cross join lateral jsonb_object_keys(payload) key
  where key ~* 'appointment|schedule|link|user|assign|engineer|technician'
  group by key
  union all
  select 'links' as level,key,count(*)::int records from jobs
  cross join lateral jsonb_object_keys(
    case when jsonb_typeof(payload->'links')='object'
      then payload->'links' else '{}'::jsonb end) key
  group by key
) select level,key,records from shape order by level,key`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE job-link shape read failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 60 || rows.some(row =>
  !["inventory", "top", "links"].includes(row.level) ||
  typeof row.key !== "string" || row.key.length > 80 ||
  !Number.isInteger(row.records) || row.records < 0))
  throw Error("LIVE job-link shape changed");
console.log(JSON.stringify({ version: "learn-build01-commusoft-job-links-shape/1",
  observedAtUtc: new Date().toISOString(), project, tenant, rows,
  sourcePayloadOrUrlsReturned: false, customerContentReturned: false,
  productionDataWrites: false,
  limitation: "Keys in retained job payloads alone do not prove an appointment endpoint or current named responsibility." }));
