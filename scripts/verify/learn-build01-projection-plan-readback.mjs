/** Read-only planner evidence for the older retained Email selector. */
import { savedCliToken } from "./learn-test-readiness.mjs";
if (process.argv.slice(2).join(" ") !== "--live-read-only")
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
async function read(query) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query/read-only`,
    { method: "POST", redirect: "error", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${savedCliToken()}`,
        "Content-Type": "application/json" }, body: JSON.stringify({ query }) },
  );
  if (!response.ok) throw Error(`LIVE planner read HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw Error("LIVE planner read shape changed");
  return rows;
}
const indexes = await read(`select tablename,indexname,indexdef
  from pg_indexes where schemaname='public'
  and tablename in('email_messages','interactions','learn_interaction_projection_receipts')
  order by tablename,indexname`);
const statistics = await read(`select relname,n_live_tup,n_dead_tup,n_mod_since_analyze,
  last_analyze,last_autoanalyze
  from pg_stat_user_tables where schemaname='public'
    and relname in('email_messages','interactions','learn_interaction_projection_receipts')
  order by relname`);
const explain = await read(`explain (format json)
  select m.id from public.email_messages m
  left join public.interactions i on i.tenant_id=m.tenant_id
    and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id='${tenant}'::uuid and i.id is null
    and not coalesce(m.provider='gmail'
      and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  order by coalesce(m.received_at,m.sent_at,m.created_at),m.id
  limit 300`);
const recentExplain = await read(`explain (format json)
  select m.id from public.email_messages m
  left join public.interactions i on i.tenant_id=m.tenant_id
    and i.source_table='email_messages' and i.source_id=m.id
  where m.tenant_id='${tenant}'::uuid and i.id is null
    and m.created_at >= now()-interval '7 days'
    and not coalesce(m.provider='gmail'
      and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  order by coalesce(m.received_at,m.sent_at,m.created_at),m.id
  limit 300`);
const lateralExplain = await read(`explain (format json)
  select m.id from public.email_messages m
  left join lateral (
    select i.id from public.interactions i
    where i.tenant_id=m.tenant_id and i.source_table='email_messages'
      and i.source_id=m.id limit 1
  ) i on true
  where m.tenant_id='${tenant}'::uuid and i.id is null
    and not coalesce(m.provider='gmail'
      and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  order by coalesce(m.received_at,m.sent_at,m.created_at),m.id
  limit 300`);
const actualUnlinkedExplain = await read(`explain (format json)
  select m.id from public.email_messages m
  where m.tenant_id='${tenant}'::uuid
    and not exists(select 1 from public.interactions i
      where i.tenant_id=m.tenant_id and i.source_table='email_messages'
        and i.source_id=m.id)
    and not coalesce(m.provider='gmail'
      and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  order by coalesce(m.received_at,m.sent_at,m.created_at),m.id
  limit 300`);
const releasedExplain = await read(`explain (format json)
  select m.id from public.email_messages m
  where m.tenant_id='${tenant}'::uuid
    and m.created_at>=clock_timestamp()-interval '30 days'
    and not exists(select 1 from public.interactions i
      where i.tenant_id=m.tenant_id and i.source_table='email_messages'
        and i.source_id=m.id)
    and not coalesce(m.provider='gmail'
      and m.raw_payload->'label_ids' @> '["DRAFT"]'::jsonb,false)
  order by m.created_at desc,m.id desc
  limit 300`);
if (statistics.length !== 3 || statistics.some((r) => typeof r.relname !== "string") ||
  indexes.length > 100 || indexes.some((r) => !["email_messages","interactions",
  "learn_interaction_projection_receipts"].includes(r.tablename) ||
  typeof r.indexname !== "string" || typeof r.indexdef !== "string") ||
  explain.length !== 1 || !Array.isArray(explain[0]?.["QUERY PLAN"]) ||
  recentExplain.length !== 1 || !Array.isArray(recentExplain[0]?.["QUERY PLAN"]) ||
  lateralExplain.length !== 1 || !Array.isArray(lateralExplain[0]?.["QUERY PLAN"]) ||
  actualUnlinkedExplain.length !== 1 || !Array.isArray(actualUnlinkedExplain[0]?.["QUERY PLAN"]) ||
  releasedExplain.length !== 1 || !Array.isArray(releasedExplain[0]?.["QUERY PLAN"]))
  throw Error("LIVE planner shape changed");
const plan = explain[0]["QUERY PLAN"][0]?.Plan;
if (!plan || typeof plan["Node Type"] !== "string")
  throw Error("LIVE planner structure changed");
function summarize(plan) {
 const nodes = [];
 function walk(node) {
  nodes.push({ type: node["Node Type"], relation: node["Relation Name"] ?? null,
    index: node["Index Name"] ?? null, rows: node["Plan Rows"] ?? null,
    cost: node["Total Cost"] ?? null });
  for (const child of node.Plans ?? []) walk(child);
 }
 walk(plan);
 return nodes;
}
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
  indexes, statistics, plan: summarize(plan),
  recentPlan: summarize(recentExplain[0]["QUERY PLAN"][0].Plan),
  lateralPlan: summarize(lateralExplain[0]["QUERY PLAN"][0].Plan),
  actualUnlinkedPlan: summarize(actualUnlinkedExplain[0]["QUERY PLAN"][0].Plan),
  releasedPlan: summarize(releasedExplain[0]["QUERY PLAN"][0].Plan),
  queryExecuted: false, messageContentReturned: false,
  productionDataWrites: false }));
