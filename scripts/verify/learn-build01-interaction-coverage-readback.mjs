/** Aggregate-only LIVE interaction/link distribution; no content or row IDs. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `select source_table,processing_status,
  count(*)::int interactions,
  count(*) filter(where related_person_id is not null)::int person_linked,
  count(*) filter(where related_company_id is not null)::int company_linked,
  count(*) filter(where related_job_id is not null)::int job_linked,
  min(created_at) earliest_created_at,
  max(created_at) latest_created_at
from public.interactions
where tenant_id='${tenant}'::uuid
group by source_table,processing_status
order by source_table,processing_status`;
const reasonQuery = `select source_table,
  coalesce(metadata#>>'{identity_delivery,reason}','unspecified') review_reason,
  count(*)::int interactions
from public.interactions
where tenant_id='${tenant}'::uuid and processing_status='identity_review'
group by source_table,coalesce(metadata#>>'{identity_delivery,reason}','unspecified')
order by source_table,review_reason`;
async function read(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }), redirect: "error", signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw Error(`Interaction coverage readback failed (HTTP ${response.status})`);
  return response.json();
}
const rows = await read(query);
if (!Array.isArray(rows) || !rows.every(row =>
    typeof row.source_table === "string" && typeof row.processing_status === "string" &&
    ["interactions", "person_linked", "company_linked", "job_linked"]
      .every(key => Number.isInteger(row[key]) && row[key] >= 0)))
  throw Error("Interaction coverage readback shape changed");
const reviewReasons = await read(reasonQuery);
if (!Array.isArray(reviewReasons) || !reviewReasons.every(row =>
    typeof row.source_table === "string" && typeof row.review_reason === "string" &&
    Number.isInteger(row.interactions) && row.interactions >= 0))
  throw Error("Interaction review-reason shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, reviewReasons, productionDataWrites: false,
  scope: "Source/status aggregates only; missing links may require human review or source evidence." }));
