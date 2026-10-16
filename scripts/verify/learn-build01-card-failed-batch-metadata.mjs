/** Bounded metadata only for the first LIVE card batch after a stopped sweep. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with stopped as (
  select payload->>'sweep_since' cutoff from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type='customer_card.sync'
    and status='dead_letter' and error_code='card_partial_failure'
  order by created_at desc,id desc limit 1
), batch as (
  select row_number() over(order by c.updated_at,c.id)::int position,
    c.status,c.context,c.locked_fields,c.person_id,c.company_id,c.updated_at,
    p.id is not null person_present,co.id is not null company_present,
    coalesce(p.primary_email ~* '@example\\.invalid$',false) synthetic_person
  from public.customer_cards c cross join stopped s
  left join public.people p on p.id=c.person_id and p.tenant_id=c.tenant_id
  left join public.companies co on co.id=c.company_id and co.tenant_id=c.tenant_id
  where c.tenant_id='${tenant}'::uuid and c.status<>'archived'
    and c.updated_at<s.cutoff::timestamptz
  order by c.updated_at,c.id limit 10
) select position,updated_at,status,context?'projection' has_projection,
  jsonb_typeof(context) context_type,length(context::text)::int context_chars,
  cardinality(locked_fields)::int locked_field_count,
  person_id is not null has_person,person_present,
  company_id is not null has_company,company_present,synthetic_person
from batch order by position`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE card metadata HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length > 10 || rows.some((row, i) =>
  row?.position !== i + 1 || !Number.isInteger(row.context_chars) ||
  !Number.isInteger(row.locked_field_count))) throw Error("LIVE card metadata shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  rows, cardIdsReturned: false, customerContentReturned: false,
  productionDataWrites: false }));
