/** Read-only plan for a bounded Email source-change candidate window. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `explain (analyze,buffers,format json)
select m.id from public.email_messages m
join public.interactions i on i.tenant_id=m.tenant_id
 and i.source_table='email_messages' and i.source_id=m.id
where m.tenant_id='${tenant}'::uuid
 and i.metadata#>>'{source_projection,revision}' is not null
 and m.updated_at>coalesce((select max(r.created_at)
  from public.learn_interaction_projection_receipts r
  where r.tenant_id=m.tenant_id and r.source_kind='email'
   and r.source_id=m.id and r.receipt->>'state'='committed'),'-infinity'::timestamptz)
order by m.updated_at desc,m.id desc limit 32`;
const started = performance.now();
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
  headers: { Authorization: `Bearer ${savedCliToken()}`,
    "Content-Type": "application/json" }, body: JSON.stringify({ query }),
});
if (!response.ok) throw Error(`LIVE Email updated plan HTTP ${response.status}`);
const rows = await response.json();
const plan = rows?.[0]?.["QUERY PLAN"]?.[0];
if (!plan || !plan.Plan) throw Error("LIVE Email updated plan shape changed");
const nodes = [];
function walk(node) {
  nodes.push({ type: node["Node Type"], relation: node["Relation Name"] ?? null,
    index: node["Index Name"] ?? null, actualRows: node["Actual Rows"] ?? null,
    loops: node["Actual Loops"] ?? null });
  for (const child of node.Plans ?? []) walk(child);
}
walk(plan.Plan);
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  elapsedMs: Math.round(performance.now() - started),
  executionMs: plan["Execution Time"], nodes,
  sourceIdsReturned: false, productionDataWrites: false }));
