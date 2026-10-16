/** Counts-only graph-page pressure for the next ordinary LIVE card batch. */
import { savedCliToken } from "./learn-test-readiness.mjs";

if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with job as (
 select (payload->>'sweep_since')::timestamptz boundary
 from public.platform_jobs where tenant_id='${tenant}'::uuid
  and job_type='customer_card.sync' and status='retrying'
  and payload ? 'sweep_since'
 order by created_at desc,id desc limit 1
), cards as materialized (
 select row_number() over(order by c.updated_at,c.id) position,
  c.person_id from public.customer_cards c cross join job j
 where c.tenant_id='${tenant}'::uuid and c.status<>'archived'
  and c.updated_at<j.boundary order by c.updated_at,c.id limit 10
), nodes as (
 select c.position,n.id node_id from cards c
 left join public.graph_nodes n on n.tenant_id='${tenant}'::uuid
  and n.node_type='person' and n.source_table='people'
  and n.source_id=c.person_id
), counts as (
 select n.position,count(e.id)::int edges from nodes n
 left join public.graph_edges e on e.tenant_id='${tenant}'::uuid
  and (e.from_node_id=n.node_id or e.to_node_id=n.node_id)
 group by n.position
)
select position,edges from counts order by position`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" }, body: JSON.stringify({ query }),
  });
if (!response.ok) throw Error(`LIVE card graph pressure HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 10 || rows.some((row, i) =>
  row.position !== i + 1 || !Number.isInteger(row.edges) || row.edges < 0))
  throw Error("LIVE card graph pressure shape changed");
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  tenant, edgesByPosition: rows.map((row) => row.edges),
  graphNodeIdsReturned: false, cardIdsReturned: false,
  customerContentReturned: false, productionDataWrites: false }));
