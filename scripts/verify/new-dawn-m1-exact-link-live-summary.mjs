/** Read-only aggregate LIVE count for the approved dual-ID rule. No row payloads. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const PROJECT = "tgbnakbxwcqjeimygroz";
const TENANT = "00000000-0000-0000-0000-000000000001";
const query = `with observed as materialized (
 select distinct v.connection_id,v.external_id
 from public.learn_business_input_versions v
 join public.learn_business_input_observations o on o.version_id=v.id
 join public.learn_business_input_pages p on p.id=o.page_id
  and (p.tenant_id,p.connection_id,p.provider,p.collection)=
      (v.tenant_id,v.connection_id,v.provider,v.collection)
 where v.tenant_id='${TENANT}' and v.provider='commusoft' and v.collection='jobs'
), unlinked as materialized (
 select o.* from observed o where not exists (
  select 1 from public.learn_business_input_current_links l
  where l.tenant_id='${TENANT}' and l.connection_id=o.connection_id
   and l.provider='commusoft' and l.collection='jobs' and l.external_id=o.external_id
 )
), site_mapped as (
 select distinct u.connection_id,u.external_id
 from unlinked u join public.learn_business_input_versions v
  on v.tenant_id='${TENANT}' and v.connection_id=u.connection_id
   and v.provider='commusoft' and v.collection='jobs' and v.external_id=u.external_id
 join public.learn_business_input_current_links l
  on l.tenant_id='${TENANT}' and l.connection_id=u.connection_id
   and l.provider='commusoft' and l.collection='properties' and l.entity_kind='site'
   and l.external_id=v.payload->>'propertyID'
 join public.sites s on s.tenant_id=l.tenant_id and s.id=l.entity_id
)
select clock_timestamp() observed_at,
 (select count(*)::integer from observed) observed_job_ids,
 (select count(*)::integer from unlinked) unlinked_job_ids,
 (select count(*)::integer from site_mapped) with_existing_site_mapping`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT}/database/query/read-only`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    redirect: "error",
    signal: AbortSignal.timeout(90000),
  },
);
if (!response.ok) throw Error(`Exact-link LIVE summary failed (HTTP ${response.status})`);
const rows = await response.json();
const row = rows?.[0];
if (!row || !Number.isInteger(row.observed_job_ids) ||
    !Number.isInteger(row.unlinked_job_ids) ||
    !Number.isInteger(row.with_existing_site_mapping))
  throw Error("Exact-link LIVE aggregate contract changed");

// A site mapping is necessary but not sufficient. Never call its count eligible.
console.log(JSON.stringify({
  project: PROJECT, tenant: TENANT, ...row,
  exact_dual_id_eligible: row.with_existing_site_mapping === 0 ? 0 : null,
  review_required: row.with_existing_site_mapping === 0 ? row.unlinked_job_ids : null,
  limitation: row.with_existing_site_mapping === 0
    ? "No unlinked source job has an existing mapped ServiceOS site; exact linking cannot run."
    : "Site overlap requires per-job customer, version and conflict classification.",
}));
