/** Counts-only LIVE readback after an ordinary card sweep attempt. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `with sweep as (
    select payload->>'sweep_since' cutoff from public.platform_jobs
    where tenant_id='${tenant}'::uuid and job_type='customer_card.sync'
      and payload ? 'sweep_since' order by created_at desc,id desc limit 1
  ), oldest_unprojected as (
    select min(updated_at) at from public.customer_cards
    where tenant_id='${tenant}'::uuid and status<>'archived'
      and not context?'projection'
  ) select
    count(*) filter(where c.status<>'archived')::int active_cards,
    count(*) filter(where c.status<>'archived' and c.context?'projection')::int projected_cards,
    count(*) filter(where c.status<>'archived' and c.updated_at<s.cutoff::timestamptz)::int remaining_before_cutoff,
    count(*) filter(where c.status<>'archived' and c.updated_at>=s.cutoff::timestamptz)::int advanced_past_cutoff,
    count(*) filter(where c.status<>'archived' and c.updated_at<u.at)::int cards_before_oldest_unprojected
  from public.customer_cards c cross join sweep s cross join oldest_unprojected u
  where c.tenant_id='${tenant}'::uuid` }),
});
if (!response.ok) throw Error(`LIVE card sweep progress HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  ["active_cards", "projected_cards", "remaining_before_cutoff", "advanced_past_cutoff",
    "cards_before_oldest_unprojected"]
    .some((key) => !Number.isInteger(rows[0]?.[key]) || rows[0][key] < 0))
  throw Error("LIVE card sweep progress shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  ...rows[0], cardIdsReturned: false, customerContentReturned: false,
  productionDataWrites: false }));
