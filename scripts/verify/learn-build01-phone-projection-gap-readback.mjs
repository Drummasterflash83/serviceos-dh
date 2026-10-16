/** Aggregate-only LIVE Phone source-to-interaction coverage. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with sources as materialized (
 select id,created_at from public.phone_calls
 where tenant_id='${tenant}'::uuid
), linked as materialized (
 select distinct source_id from public.interactions
 where tenant_id='${tenant}'::uuid and source_table='phone_calls'
) select count(*)::int retained_calls,
 count(*) filter(where l.source_id is not null)::int with_interaction,
 count(*) filter(where l.source_id is null)::int eligible_missing,
 count(*) filter(where l.source_id is null and s.created_at<now()-interval '1 hour')::int older_than_hour
 from sources s left join linked l on l.source_id=s.id`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE Phone projection readback HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  ["retained_calls","with_interaction","eligible_missing","older_than_hour"]
    .some((key) => !Number.isInteger(rows[0]?.[key])))
  throw Error("LIVE Phone projection readback shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  ...rows[0], sourceIdsReturned: false, productionDataWrites: false }));
