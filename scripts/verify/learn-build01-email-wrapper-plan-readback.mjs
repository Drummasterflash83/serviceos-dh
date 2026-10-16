/** Analyze only the Email branch's exact retained-source SELECT, no row output. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const headers = { Authorization: `Bearer ${savedCliToken()}`,
  "Content-Type": "application/json" };
async function query(sql, timeout = 75000, writeEndpoint = false) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query${writeEndpoint ? "" : "/read-only"}`, {
    method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(timeout),
    body: JSON.stringify({ query: sql, ...(writeEndpoint ? { read_only: false } : {}) }),
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok) throw Error(`Email plan readback HTTP ${response.status} (${rows?.code ?? rows?.[0]?.code ?? "unknown"}; ${String(rows?.message ?? rows?.[0]?.message ?? "").slice(0, 160)})`);
  return rows;
}
const rows = await query("select pg_get_functiondef('public.learn_projection_pending(uuid,text,integer)'::regprocedure) definition");
const definition = rows?.[0]?.definition;
if (typeof definition !== "string" || !definition.includes("learn_projection_pending_bounded_fallback"))
  throw Error("Email wrapper baseline changed");
const start = definition.lastIndexOf("return query with unlinked as materialized (");
const end = definition.indexOf("\n get diagnostics selected=row_count;", start);
if (start < 0 || end < start) throw Error("Email wrapper SELECT anchor changed");
const sql = definition.slice(start + "return query ".length, end).trim().replace(/;$/, "")
  .replace(/\bp_tenant\b/g, "'00000000-0000-0000-0000-000000000001'::uuid")
  .replace(/\bp_source\b/g, "'email'")
  .replace(/\bbound\b/g, "10");
const explain = await query(`begin read only;
 set local enable_nestloop=off;set local statement_timeout='60s';
 explain (analyze,buffers,format json) ${sql};rollback;`, 75000, true);
const plan = explain?.[0]?.["QUERY PLAN"]?.[0];
if (!Number.isFinite(plan?.["Execution Time"])) throw Error("Email wrapper plan unavailable");
function nodes(p, output = []) {
  output.push({ node: p["Node Type"], relation: p["Relation Name"] ?? null,
    actualMs: p["Actual Total Time"] ?? null, loops: p["Actual Loops"] ?? null,
    rows: p["Actual Rows"] ?? null });
  for (const child of p.Plans ?? []) nodes(child, output);
  return output;
}
console.log(JSON.stringify({ observedAt: new Date().toISOString(),
  executionTimeMs: plan["Execution Time"], returnedRows: plan.Plan["Actual Rows"],
  nodes: nodes(plan.Plan).slice(0, 35),
  sourceIdsReturned: false, productionDataWrites: false }));
