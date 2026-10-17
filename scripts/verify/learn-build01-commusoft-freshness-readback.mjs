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
  s.next_check_at,s.updated_at,s.max_pages,s.page_size,
  a.settings->'commusoft_import'->>'resource' current_resource,
  a.settings->'commusoft_import'->>'expiresAt' current_approval_expires_at,
  a.settings->'commusoft_import'->>'approvalId'=s.current_request::text approval_matches_scope,
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
const laneQuery = `select f.enabled,f.last_state,f.next_check_at,f.updated_at,
  f.current_request is not null current_request_active,
  (select j.status from public.platform_jobs j
    where j.tenant_id=f.tenant_id and j.job_type='commusoft.source_sync'
      and j.job_key='commusoft.source:'||f.account_id::text||':'||f.current_request::text
    order by j.created_at desc limit 1) current_job_status,
  (select max(r.created_at) from public.learn_commusoft_current_job_receipts r
    where r.tenant_id=f.tenant_id and r.account_id=f.account_id
      and r.stage='completed') latest_completed_receipt
from public.learn_commusoft_current_jobs f
where f.tenant_id='${tenant}'::uuid`;
const laneResponse = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: laneQuery }), redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
if (!laneResponse.ok) throw Error(`Commusoft current-jobs lane unavailable (HTTP ${laneResponse.status})`);
const currentJobs = await laneResponse.json();
if (!Array.isArray(currentJobs) || currentJobs.length > 10 || currentJobs.some(row =>
  typeof row.enabled !== "boolean" || typeof row.last_state !== "string" ||
  typeof row.current_request_active !== "boolean"))
  throw Error("Commusoft current-jobs lane shape changed");
const scopeJobsQuery = `select j.status,j.error_code,j.attempt_count,j.available_at,
  j.lease_expires_at,j.updated_at,j.completed_at,
  (select count(*)::int from public.learn_business_input_request_permits p
    where p.tenant_id=j.tenant_id and p.job_id=j.id) permits,
  (select count(*)::int from public.learn_business_input_pages p
    where p.tenant_id=j.tenant_id and p.job_id=j.id) retained_pages,
  j.result is null result_absent,
  (select array_agg(key order by key) from jsonb_object_keys(j.result) key) result_keys
from public.learn_commusoft_recurring s
join public.platform_jobs j on j.tenant_id=s.tenant_id
  and j.job_type='commusoft.source_sync'
  and j.job_key='commusoft.source:'||s.account_id::text||':'||s.current_request::text
where s.tenant_id='${tenant}'::uuid
order by j.created_at desc limit 8`;
const scopeJobsResponse = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: scopeJobsQuery }), redirect: "error",
    signal: AbortSignal.timeout(45000),
  });
if (!scopeJobsResponse.ok) throw Error(`Commusoft contact-scope jobs unavailable (HTTP ${scopeJobsResponse.status})`);
const scopeJobs = await scopeJobsResponse.json();
if (!Array.isArray(scopeJobs) || scopeJobs.length > 8 || scopeJobs.some(row =>
  typeof row.status !== "string" || !Number.isInteger(row.attempt_count)))
  throw Error("Commusoft contact-scope jobs shape changed");
const stepsQuery = `select recent.phase,recent.cycle_start,recent.cycle_end,
  recent.created_at as phase_started_at,j.status job_status,j.completed_at,
  (select count(*)::int from public.learn_business_input_pages p
    where p.tenant_id=recent.tenant_id and p.provider='commusoft'
    and p.checkpoint_after->>'approvalId'=recent.request_id::text) retained_pages,
  (select count(*)::int from public.learn_commusoft_contact_targets t
    where t.tenant_id=recent.tenant_id and t.approval_id=recent.request_id) contact_targets
from (select * from public.learn_commusoft_recurring_steps
  where tenant_id='${tenant}'::uuid order by created_at desc limit 8) recent
left join public.platform_jobs j on j.id=recent.job_id and j.tenant_id=recent.tenant_id
order by recent.created_at desc`;
const stepsResponse = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: stepsQuery }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!stepsResponse.ok) throw Error(`Commusoft phase history unavailable (HTTP ${stepsResponse.status})`);
const steps = await stepsResponse.json();
if (!Array.isArray(steps) || steps.length > 8 || steps.some(row =>
  !Number.isInteger(row.phase) || !Number.isInteger(row.retained_pages) ||
  !Number.isInteger(row.contact_targets))) throw Error("Commusoft phase history shape changed");
const timingQuery = `select r.stage,r.created_at from public.learn_commusoft_current_job_receipts r
where r.tenant_id='${tenant}'::uuid and r.created_at between
  '2026-10-17 08:40:00+00'::timestamptz and '2026-10-17 09:05:00+00'::timestamptz
order by r.created_at limit 20`;
const timingResponse = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: timingQuery }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
if (!timingResponse.ok) throw Error(`Commusoft current-job timing unavailable (HTTP ${timingResponse.status})`);
const currentJobTiming = await timingResponse.json();
if (!Array.isArray(currentJobTiming) || currentJobTiming.length > 20 || currentJobTiming.some(row =>
  typeof row.stage !== "string" || !Number.isFinite(Date.parse(row.created_at))))
  throw Error("Commusoft current-job timing shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, recurring, currentJobs, scopeJobs, steps, currentJobTiming,
  interpretation: "Retained page commit cadence only; no provider-current job-status or record completeness claim.",
  productionDataWrites: false, customerContentReturned: false }));
