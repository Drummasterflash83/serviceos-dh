/** Counts-only LIVE readback: published policies and saved subject scores. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select
  (select count(*)::int from public.learn_scorecard_publications
    where tenant_id='${tenant}'::uuid) published_policies,
  (select count(*)::int from public.learn_scorecard_publications
    where tenant_id='${tenant}'::uuid and scope like 'job:%') published_job_policies,
  (select count(*)::int from public.measurements
    where tenant_id='${tenant}'::uuid and subject_kind='job') saved_job_measurements,
  (select count(*)::int from public.learn_assessments
    where tenant_id='${tenant}'::uuid and subject_kind='job') saved_job_assessments,
  (select count(*)::int from public.learn_assessments
    where tenant_id='${tenant}'::uuid) saved_all_subject_assessments,
  (select count(*)::int from public.recommendations
    where tenant_id='${tenant}'::uuid and status='open') open_recommendations,
  (select count(*)::int from public.recommendations
    where tenant_id='${tenant}'::uuid and status='open' and card_id is not null)
    open_recommendations_with_card,
  (select count(*)::int from public.recommendations
    where tenant_id='${tenant}'::uuid and status='open'
      and case when jsonb_typeof(evidence)='array'
        then jsonb_array_length(evidence)>0 else false end)
    open_recommendations_with_evidence,
  (select count(*)::int from public.recommendations
    where tenant_id='${tenant}'::uuid and status='open'
      and updated_at<now()-interval '1 day') open_recommendations_older_than_day,
  (select max(updated_at) from public.recommendations
    where tenant_id='${tenant}'::uuid and status='open') latest_recommendation_update,
  (select status from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='recommendation.sync' order by created_at desc limit 1)
    latest_recommendation_job_status,
  (select max(completed_at) from public.platform_jobs where tenant_id='${tenant}'::uuid
    and job_type='recommendation.sync' and status='succeeded')
    latest_recommendation_success`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`Scorecard hold readback HTTP ${response.status}`);
const rows = await response.json();
const row = rows?.[0];
if (!Array.isArray(rows) || rows.length !== 1 || !row ||
    !["published_policies","published_job_policies","saved_job_measurements",
      "saved_job_assessments","saved_all_subject_assessments","open_recommendations",
      "open_recommendations_with_card","open_recommendations_with_evidence",
      "open_recommendations_older_than_day"]
      .every(key => Number.isSafeInteger(row[key]) && row[key] >= 0))
  throw Error("Scorecard hold readback shape changed");
const typeQuery = `select type,count(*)::int open_recommendations,
  count(*) filter(where case when jsonb_typeof(evidence)='array'
    then jsonb_array_length(evidence)=0 else true end)::int without_evidence,
  count(*) filter(where updated_at<now()-interval '1 day')::int older_than_day,
  max(updated_at) latest_update
from public.recommendations where tenant_id='${tenant}'::uuid and status='open'
group by type order by open_recommendations desc,type`;
const typeResponse = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: typeQuery }),
});
if (!typeResponse.ok) throw Error(`Recommendation rule readback HTTP ${typeResponse.status}`);
const types = await typeResponse.json();
if (!Array.isArray(types) || types.length > 100 || types.some(item =>
  typeof item.type !== "string" || !Number.isSafeInteger(item.open_recommendations) ||
  !Number.isSafeInteger(item.without_evidence) || !Number.isSafeInteger(item.older_than_day)))
  throw Error("Recommendation rule readback shape changed");
const gapQuery = `select coalesce(c.status,'missing_card') card_status,
  coalesce(r.source_rule,'no_rule') source_rule,count(*)::int recommendations,
  count(*) filter(where r.updated_at<now()-interval '1 day')::int older_than_day,
  max(r.updated_at) latest_update
from public.recommendations r left join public.customer_cards c
  on c.tenant_id=r.tenant_id and c.id=r.card_id
where r.tenant_id='${tenant}'::uuid and r.status='open' and r.type='review_new_contact'
  and case when jsonb_typeof(r.evidence)='array'
    then jsonb_array_length(r.evidence)=0 else true end
group by coalesce(c.status,'missing_card'),coalesce(r.source_rule,'no_rule')
order by recommendations desc`;
const gapResponse = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: gapQuery }),
});
if (!gapResponse.ok) throw Error(`Recommendation evidence-gap readback HTTP ${gapResponse.status}`);
const evidenceGaps = await gapResponse.json();
if (!Array.isArray(evidenceGaps) || evidenceGaps.length > 30 || evidenceGaps.some(item =>
  typeof item.card_status !== "string" || typeof item.source_rule !== "string" ||
  !Number.isSafeInteger(item.recommendations) || !Number.isSafeInteger(item.older_than_day)))
  throw Error("Recommendation evidence-gap readback shape changed");
const jobsQuery = `select status,coalesce(records_processed,0)::int records_processed,
  coalesce((result->>'created')::int,0) created,
  coalesce((result->>'updated')::int,0) updated,
  coalesce((result->>'closed')::int,0) closed,
  coalesce((result->>'selected')::int,0) selected,
  coalesce((result->>'swept')::int,0) swept,
  coalesce((result->>'urgent')::int,0) urgent,
  coalesce((result->>'failed')::int,0) failed,
  (payload ? 'sweep_after') continuation_page,
  case when completed_at is not null then
    extract(epoch from completed_at-created_at)::int end duration_seconds,
  created_at,completed_at
from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='recommendation.sync' order by created_at desc limit 8`;
const jobsResponse = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: jobsQuery }),
});
if (!jobsResponse.ok) throw Error(`Recommendation job readback HTTP ${jobsResponse.status}`);
const recommendationJobs = await jobsResponse.json();
if (!Array.isArray(recommendationJobs) || recommendationJobs.length > 8 ||
    recommendationJobs.some(item => typeof item.status !== "string" ||
      !Number.isSafeInteger(item.records_processed) || !Number.isSafeInteger(item.failed) ||
      !["selected", "swept", "urgent"].every(key => Number.isSafeInteger(item[key])) ||
      typeof item.continuation_page !== "boolean"))
  throw Error("Recommendation job readback shape changed");
console.log(JSON.stringify({ observedAtUtc: new Date().toISOString(), project, tenant,
  ...row, recommendationTypes: types, emptyEvidenceGroups: evidenceGaps,
  recommendationJobs,
  subjectIdsOrValuesReturned: false, recommendationContentReturned: false,
  productionDataWrites: false }));
