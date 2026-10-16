/** Read-only plan for a bounded legacy Email revision candidate window. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `explain (analyze,buffers,format json)
select i.source_id from public.interactions i
where i.tenant_id='${tenant}'::uuid
  and i.source_table='email_messages'
  and i.metadata#>>'{source_projection,revision}' is null
order by i.source_id limit 32`;
const started = performance.now();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE Email legacy plan HTTP ${response.status}`);
const rows = await response.json();
const plan = rows?.[0]?.["QUERY PLAN"]?.[0];
if (!plan || typeof plan !== "object" || !plan.Plan)
  throw Error("LIVE Email legacy plan shape changed");
const nodes = [];
function walk(node) {
  nodes.push({ type: node["Node Type"], relation: node["Relation Name"] ?? null,
    index: node["Index Name"] ?? null, actualRows: node["Actual Rows"] ?? null,
    rowsRemovedByFilter: node["Rows Removed by Filter"] ?? null });
  for (const child of node.Plans ?? []) walk(child);
}
walk(plan.Plan);
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  elapsedMs: Math.round(performance.now() - started),
  executionMs: plan["Execution Time"], nodes,
  sourceIdsReturned: false, productionDataWrites: false }));
