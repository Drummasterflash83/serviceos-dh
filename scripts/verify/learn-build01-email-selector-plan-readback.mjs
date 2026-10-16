/** Read-only planner summary for the older Email unlinked tail; no row data. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-twelve-read-only", "--live-thirty-two-read-only"].includes(mode))
  throw Error("Exact LIVE read-only planner mode required");
const window = mode === "--live-twelve-read-only" ? 12 : 32;
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `explain (format json)
select m.id from public.email_messages m
where m.tenant_id='${tenant}'::uuid
  and m.created_at>=clock_timestamp()-interval '30 days'
  and not exists(select 1 from public.interactions i
    where i.tenant_id=m.tenant_id and i.source_table='email_messages'
      and i.source_id=m.id)
  and not coalesce(m.provider='gmail' and
    m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
order by m.created_at desc,m.id desc limit ${window}`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE Email planner readback HTTP ${response.status}`);
const rows = await response.json();
const plan = rows?.[0]?.["QUERY PLAN"]?.[0]?.Plan;
if (!plan || typeof plan !== "object") throw Error("Planner shape changed");
const nodes = [];
function walk(node, depth) {
  nodes.push({ depth, type: node["Node Type"], join: node["Join Type"] ?? null,
    index: node["Index Name"] ?? null, rows: node["Plan Rows"] ?? null,
    cost: node["Total Cost"] ?? null });
  for (const child of node.Plans ?? []) walk(child, depth + 1);
}
walk(plan, 0);
console.log(JSON.stringify({ observedAt: new Date().toISOString(), window,
  nodes, sourceRowsReturned: false, productionDataWrites: false }));
