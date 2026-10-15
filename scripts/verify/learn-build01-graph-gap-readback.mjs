/** Aggregate-only LIVE readback of eligible interactions awaiting Graph nodes. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");

const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with existing as materialized (
  select source_id from public.graph_nodes
  where tenant_id='${tenant}'::uuid and node_type='interaction'
    and source_table='interactions'
), missing as (
  select i.created_at,i.occurred_at from public.interactions i
  left join existing n on n.source_id=i.id
  where i.tenant_id='${tenant}'::uuid
    and i.processing_status in ('ready','enriched') and n.source_id is null
) select count(*)::int eligible_missing,
  count(*) filter(where created_at<now()-interval '1 day')::int older_than_day,
  min(occurred_at) oldest_occurred_at,
  max(occurred_at) newest_occurred_at from missing`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST",
    headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }), redirect: "error", signal: AbortSignal.timeout(45000),
  },
);
if (!response.ok) throw Error(`Graph gap readback failed (HTTP ${response.status})`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 ||
  !Number.isInteger(rows[0]?.eligible_missing)) throw Error("Graph gap shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, ...rows[0], productionDataWrites: false }));
