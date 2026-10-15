/** Aggregate-only LIVE Commusoft page freshness; no source payload or identifier leaves the query. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select collection,
  count(*)::int retained_pages,
  sum(record_count)::bigint retained_observations,
  count(*) filter(where committed_at>=now()-interval '1 hour')::int pages_last_hour,
  count(*) filter(where committed_at>=now()-interval '1 day')::int pages_last_day,
  sum(record_count) filter(where committed_at>=now()-interval '1 hour')::bigint observations_last_hour,
  max(committed_at) newest_page_at,
  min(committed_at) oldest_page_at
from public.learn_business_input_pages
where tenant_id='${tenant}'::uuid and provider='commusoft'
group by collection order by collection`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!response.ok) throw Error(`Commusoft freshness unavailable (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 30 || rows.some(row =>
  typeof row.collection !== "string" || !Number.isInteger(row.retained_pages) ||
  !Number.isInteger(row.pages_last_hour) || !Number.isInteger(row.pages_last_day)))
  throw Error("Commusoft freshness shape changed");
const stateQuery = `select s.phase,s.last_state,s.enabled,s.watermark,s.cycle_start,s.cycle_end,
  s.next_check_at,s.max_pages,s.page_size,
  a.settings->'commusoft_import'->>'resource' current_resource,
  (a.settings->'commusoft_import'->>'contactTargetCount')::int contact_target_count,
  (a.sync_cursor->>'propertiesCompleted')::int contact_properties_completed,
  (a.sync_cursor->>'pages')::int current_pages,
  a.sync_cursor->>'complete' current_complete,
  (select status from public.platform_jobs j where j.tenant_id=s.tenant_id
    and j.job_type='commusoft.source_sync'
    and j.payload->>'connector_account_id'=s.account_id::text
    order by created_at desc limit 1) latest_job_status
from public.learn_commusoft_recurring s
join public.connector_accounts a on a.id=s.account_id and a.tenant_id=s.tenant_id
where s.tenant_id='${tenant}'::uuid`;
const stateResponse = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: stateQuery }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!stateResponse.ok) throw Error(`Commusoft recurring state unavailable (HTTP ${stateResponse.status})`);
const recurring = await stateResponse.json();
if (!Array.isArray(recurring) || recurring.length > 10 || recurring.some(row =>
  !Number.isInteger(row.phase) || typeof row.enabled !== "boolean" ||
  typeof row.last_state !== "string")) throw Error("Commusoft recurring state shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant, rows, recurring,
  interpretation: "Retained page commit cadence only; no provider-current job-status or record completeness claim.",
  productionDataWrites: false, customerContentReturned: false }));
