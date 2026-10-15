/** Aggregate-only LIVE identity queue timing readback; no row IDs or payloads. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select status,coalesce(error_code,'none') error_code,
  count(*)::int jobs,
  min(next_run_at) first_next_run_at,
  max(next_run_at) last_next_run_at,
  max(updated_at) latest_update_at,
  min(attempt_count)::int minimum_attempts,
  max(attempt_count)::int maximum_attempts,
  max(max_attempts)::int maximum_allowed_attempts
from public.platform_jobs
where tenant_id='${tenant}'::uuid and job_type='identity.resolve'
  and status in('queued','running','retrying','failed','dead_letter')
group by status,coalesce(error_code,'none')
order by status,error_code`;
const publicationsQuery = `select p.attempt,
  coalesce(p.receipt->>'state','unclassified') receipt_state,
  count(*)::int publications
from public.platform_jobs j
join public.learn_processing_publications p on p.job_id=j.id
  and p.tenant_id=j.tenant_id
where j.tenant_id='${tenant}'::uuid and j.job_type='identity.resolve'
  and j.status='retrying'
group by p.attempt,coalesce(p.receipt->>'state','unclassified')
order by p.attempt,receipt_state`;
const receiptShapeQuery = `select p.attempt,
  coalesce(p.receipt->>'state','unclassified') receipt_state,
  count(*)::int receipts,
  count(*) filter(where
    p.receipt->>'version' is distinct from 'learn-identity-delivery/1'
    or p.receipt->>'tenantId' is distinct from p.tenant_id::text
    or p.receipt->>'requestId' is distinct from p.request_id::text
    or p.receipt->>'interactionId' is distinct from p.source_id::text
    or p.receipt->>'sourceRevision' is distinct from p.source_revision
    or jsonb_typeof(p.receipt->'personCreated') is distinct from 'boolean'
    or jsonb_typeof(p.receipt->'companyCreated') is distinct from 'boolean'
    or jsonb_typeof(p.receipt->'cardEnriched') is distinct from 'boolean'
    or jsonb_typeof(p.receipt->'recommendations') is distinct from 'number'
    or jsonb_typeof(p.receipt->'suggestions') is distinct from 'number'
    or jsonb_typeof(p.receipt->'eventsConsumed') is distinct from 'number'
    or (p.receipt->>'eventsConsumed')::int>1
    or (p.receipt->>'state'='committed' and
      (p.receipt->'cardEnriched' is distinct from 'true'::jsonb
       or p.receipt->>'cardId' is null))
    or (p.receipt->>'state'='review_required' and
      (p.receipt->'cardEnriched' is distinct from 'false'::jsonb
       or p.receipt->'cardId' is distinct from 'null'::jsonb
       or p.receipt->'personCreated' is distinct from 'false'::jsonb
       or p.receipt->'companyCreated' is distinct from 'false'::jsonb
       or p.receipt->'recommendations' is distinct from '0'::jsonb
       or p.receipt->'suggestions' is distinct from '0'::jsonb
       or p.receipt->'eventsConsumed' is distinct from '0'::jsonb
       or jsonb_typeof(p.receipt->'reason') is distinct from 'string'))
  )::int failed_js_shape_checks
from public.platform_jobs j
join public.learn_processing_publications p on p.job_id=j.id
  and p.tenant_id=j.tenant_id
where j.tenant_id='${tenant}'::uuid and j.job_type='identity.resolve'
  and j.status='retrying'
group by p.attempt,coalesce(p.receipt->>'state','unclassified')
order by p.attempt,receipt_state`;
async function read(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`Identity queue readback failed (HTTP ${response.status})`);
  return response.json();
}
const rows = await read(query);
if (!Array.isArray(rows) || !rows.every(row =>
    typeof row.status === "string" && typeof row.error_code === "string" &&
    Number.isInteger(row.jobs) && row.jobs >= 0))
  throw Error("Identity queue readback shape changed");
const activeRetryPublications = await read(publicationsQuery);
if (!Array.isArray(activeRetryPublications) || !activeRetryPublications.every(row =>
    Number.isInteger(row.attempt) && row.attempt > 0 &&
    typeof row.receipt_state === "string" &&
    Number.isInteger(row.publications) && row.publications >= 0))
  throw Error("Identity publication readback shape changed");
const receiptShape = await read(receiptShapeQuery);
if (!Array.isArray(receiptShape) || !receiptShape.every(row =>
    Number.isInteger(row.attempt) && row.attempt > 0 &&
    typeof row.receipt_state === "string" &&
    Number.isInteger(row.receipts) && row.receipts >= 0 &&
    Number.isInteger(row.failed_js_shape_checks) && row.failed_js_shape_checks >= 0))
  throw Error("Identity receipt-shape readback changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, activeRetryPublications, receiptShape, productionDataWrites: false,
  scope: "Queued/retrying timing and review holds only; no manual rescue implied." }));
