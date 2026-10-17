/** Counts-only TEST/LIVE readback of Email-to-card/Graph drain and claims. */
import { savedCliToken, TEST_PROJECT } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--test-read-only", "--live-read-only"].includes(mode))
  throw Error("Exact TEST or LIVE read-only mode required");

const project = mode === "--test-read-only" ? TEST_PROJECT : "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const sql = {
  jobs: `select job_type,status,coalesce(error_code,'none') error_code,
      count(*)::int jobs,min(next_run_at) next_run_at,
      min(available_at) available_at,min(priority)::int priority,
      max(lease_expires_at) lease_expires_at,
      max(updated_at) latest_update_at,
      max(attempt_count)::int max_attempts,
      max((payload->>'limit')::int) payload_limit
    from public.platform_jobs
    where tenant_id='${tenant}'::uuid
      and job_type in('identity.resolve','graph.sync')
      and status in('queued','running','retrying')
    group by job_type,status,coalesce(error_code,'none')
    order by job_type,status,error_code`,
  coverage: `with fresh as materialized (
      select i.id,i.processing_status,i.related_person_id,i.related_company_id
      from public.interactions i
      where i.tenant_id='${tenant}'::uuid
        and i.created_at >= '2026-10-17 14:31:38+00'::timestamptz
        and i.source_type='email'
    ) select processing_status,count(*)::int interactions,
      count(*) filter(where related_person_id is not null)::int person_linked,
      count(*) filter(where related_company_id is not null)::int company_linked,
      count(*) filter(where exists(
        select 1 from public.customer_cards c
        where c.tenant_id='${tenant}'::uuid and c.person_id=f.related_person_id
      ))::int card_linked,
      count(*) filter(where exists(
        select 1 from public.graph_nodes n
        where n.tenant_id='${tenant}'::uuid and n.node_type='interaction'
          and n.source_table='interactions' and n.source_id=f.id
      ))::int graph_linked
    from fresh f group by processing_status order by processing_status`,
};
async function read(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${savedCliToken()}`,
        "Content-Type": "application/json" }, body: JSON.stringify({ query }),
    },
  );
  if (!response.ok) throw Error(`LIVE lane readback HTTP ${response.status}`);
  return response.json();
}
const [jobs, coverage] = await Promise.all([read(sql.jobs), read(sql.coverage)]);
if (!Array.isArray(jobs) || !Array.isArray(coverage) ||
    jobs.some(r => !Number.isSafeInteger(r.jobs) || r.jobs < 0) ||
    coverage.some(r => !Number.isSafeInteger(r.interactions) ||
      ["person_linked", "company_linked", "card_linked", "graph_linked"]
        .some(key => !Number.isSafeInteger(r[key]) || r[key] < 0 ||
          r[key] > r.interactions)))
  throw Error("LIVE lane readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  windowStart: "2026-10-17T14:31:38Z", jobs, coverage,
  sourceContentReturned: false, identityReturned: false,
  productionDataWrites: false }));
