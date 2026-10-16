/** Read-only LIVE plan inspection; never prints email IDs or content. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-plan-only", "--live-analyze", "--live-analyze-recent"].includes(mode))
  throw Error("Explicit LIVE plan-only or read-only analyze mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const recent = mode === "--live-analyze-recent";
const query = `explain (${mode !== "--live-plan-only" ? "analyze, buffers, " : ""}format json)
select m.id from public.email_messages m
where m.tenant_id='${tenant}'::uuid
 ${recent ? "and coalesce(m.received_at,m.sent_at,m.created_at)>=now()-interval '1 day'" : ""}
 and not exists(select 1 from public.interactions i
  where i.tenant_id=m.tenant_id and i.source_table='email_messages' and i.source_id=m.id)
 and not coalesce(m.provider='gmail' and
  m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
order by coalesce(m.received_at,m.sent_at,m.created_at),m.id
limit ${recent ? 100 : 300}`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query/read-only`, {
  method: "POST", headers: { Authorization: `Bearer ${savedCliToken()}`,
    "content-type": "application/json" }, body: JSON.stringify({ query }),
  redirect: "error", signal: AbortSignal.timeout(mode === "--live-plan-only" ? 30000 : 45000),
});
if (!response.ok) throw Error(`Email selector plan HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1) throw Error("Email selector plan shape changed");
const value = Object.values(rows[0])[0];
const plan = typeof value === "string" ? JSON.parse(value) : value;
if (!Array.isArray(plan) || !plan[0]?.Plan) throw Error("Email selector plan unavailable");
function summarise(node) {
  return { node: node["Node Type"], relation: node["Relation Name"] ?? null,
    index: node["Index Name"] ?? null, join: node["Join Type"] ?? null,
    startupCost: node["Startup Cost"], totalCost: node["Total Cost"],
    planRows: node["Plan Rows"], actualRows: node["Actual Rows"] ?? null,
    actualTotalMs: node["Actual Total Time"] ?? null,
    sharedReadBlocks: node["Shared Read Blocks"] ?? null,
    children: (node.Plans ?? []).map(summarise) };
}
console.log(JSON.stringify({ version: "learn-build01-email-selector-plan/1",
  observedAtUtc: new Date().toISOString(), project, queryExecuted: mode !== "--live-plan-only",
  recentOneDay: recent,
  plan: summarise(plan[0].Plan), productionDataWrites: false,
  sourceRowsPrinted: false }));
