/** Counts-only LIVE Email receipt progress; detects repeated unchanged batches. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with recent as materialized (
 select p.source_id,p.source_revision,p.created_at,p.receipt->>'action' action
 from public.learn_processing_publications p
 join public.platform_jobs j on j.id=p.job_id and j.tenant_id=p.tenant_id
 where p.tenant_id='${tenant}'::uuid and p.source_kind='email'
  and p.receipt->>'state'='committed'
  and j.job_type='interactions.sync' and j.payload->>'source'='email'
  and j.payload->>'lane' is null
  and p.created_at>='2026-10-16T21:55:00Z'::timestamptz
), by_source as (
 select source_id,count(*) receipts from recent group by source_id
)
select (select count(*)::int from recent) committed_receipts,
 (select count(*)::int from recent where action='unchanged') unchanged_receipts,
 (select count(*)::int from by_source) distinct_sources,
 (select count(*)::int from by_source where receipts>1) repeated_sources,
 (select max(receipts)::int from by_source) max_receipts_per_source,
 (select min(created_at) from recent) first_receipt_at,
 (select max(created_at) from recent) latest_receipt_at`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`Email receipt progress HTTP ${response.status}`);
const rows = await response.json();
const result = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !result ||
  ["committed_receipts", "unchanged_receipts", "distinct_sources",
    "repeated_sources"].some((key) =>
      !Number.isInteger(result[key]) || result[key] < 0) ||
  (result.max_receipts_per_source !== null &&
    !Number.isInteger(result.max_receipts_per_source)))
  throw Error("Email receipt progress shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, ...result, sourceIdsReturned: false,
  messageContentReturned: false, productionDataWrites: false }));
