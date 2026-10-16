/** Bounded, read-only timing of the oldest LIVE card's source scan. */
import { savedCliToken } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-read-only", "--live-read-only --no-bitmap",
  "--live-read-only --full-no-bitmap"].includes(mode))
  throw Error("Exact LIVE read-only mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const target = `select c.id,c.person_id,c.company_id from public.customer_cards c
 where c.tenant_id='${tenant}'::uuid and c.status<>'archived'
 order by c.updated_at,c.id limit 1`;
const scan = `with target as materialized (${target}),
 drafts as materialized (
  select id from public.email_messages where tenant_id='${tenant}'::uuid
  and provider='gmail' and raw_payload->'label_ids' @> '["DRAFT"]'::jsonb
 ), associated as materialized (
  select i.id,i.occurred_at,i.source_table,
    (i.source_table='email_messages' and d.id is not null) draft
  from target c join public.interactions i on i.tenant_id='${tenant}'::uuid
   and (i.related_person_id=c.person_id or i.related_company_id=c.company_id)
   and coalesce(i.status,'') not in('deleted','removed')
  left join drafts d on i.source_table='email_messages' and d.id=i.source_id
 ), eligible as materialized (select * from associated where not draft)
 select (select count(*)::int from associated) associated,
 (select count(*)::int from eligible) eligible,
 (select count(*)::int from eligible where occurred_at>=now()-interval '7 days') last7,
 (select count(*)::int from (select id from eligible order by occurred_at desc nulls last,id limit 100) x) sampled`;
const queries = mode.includes("--full-no-bitmap")
  ? [{ label: "full_function_no_bitmap", sql: `with target as (${target})
      select (public.learn_card_projection_inputs('${tenant}'::uuid,id)#>>'{coverage,eligibleInteractions}')::int eligible
      from target` }]
  : [{ label: "associated_plan", sql: `explain (analyze,buffers,format json) ${scan}` }];
for (const item of queries) {
  const started = Date.now();
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${savedCliToken()}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ query: `begin read only; set local role service_role;
        ${mode.includes("no-bitmap") ? "set local enable_bitmapscan=off;" : ""}
        ${item.sql}; rollback;`, read_only: false }),
    });
  const elapsedMs = Date.now() - started;
  if (!response.ok) throw Error(`${item.label} read-only query HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1) throw Error(`${item.label} shape changed`);
  if (mode.includes("--full-no-bitmap")) {
    if (!Number.isInteger(rows[0]?.eligible)) throw Error("Full function shape changed");
    console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
      label: item.label, elapsedMs, eligible: rows[0].eligible,
      cardIdsReturned: false, contentReturned: false, productionWrites: false }));
    continue;
  }
  if (!Array.isArray(rows[0]?.["QUERY PLAN"])) throw Error(`${item.label} shape changed`);
  const plan = rows[0]["QUERY PLAN"][0];
  const nodes = [];
  function collect(node, depth = 0) {
    if (depth > 12 || nodes.length > 100) return;
    nodes.push({ depth, type: node["Node Type"], relation: node["Relation Name"] ?? null,
      index: node["Index Name"] ?? null, rows: node["Actual Rows"] ?? null,
      timeMs: node["Actual Total Time"] ?? null,
      sharedHits: node["Shared Hit Blocks"] ?? null,
      sharedReads: node["Shared Read Blocks"] ?? null });
    for (const child of node.Plans ?? []) collect(child, depth + 1);
  }
  collect(plan.Plan);
  console.log(JSON.stringify({ observedAt: new Date().toISOString(), project,
    label: item.label, elapsedMs, executionTimeMs: plan["Execution Time"], nodes,
    cardIdsReturned: false, contentReturned: false, productionWrites: false }));
}
