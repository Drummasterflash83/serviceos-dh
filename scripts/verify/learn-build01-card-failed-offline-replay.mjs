/** Read one failed LIVE card into memory, replay projection against a no-write stub.
 * Emits only stage/counts. No source IDs, names, messages or patches leave memory. */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as calculators from "../../supabase/functions/_shared/customer_card.ts";
import { savedCliToken } from "./learn-test-readiness.mjs";

const mode = process.argv.slice(2).join(" ");
if (!["--live-read-only", "--live-rollback-update-diagnostic"].includes(mode))
  throw Error("Exact LIVE diagnostic mode required");
const project = "tgbnakbxwcqjeimygroz";
const tenant = "00000000-0000-0000-0000-000000000001";
const query = `with stopped as (
  select payload->>'sweep_since' cutoff from public.platform_jobs
  where tenant_id='${tenant}'::uuid and job_type='customer_card.sync'
    and status='dead_letter' and error_code='card_partial_failure'
  order by created_at desc,id desc limit 1
), target as (
  select c.* from public.customer_cards c cross join stopped s
  where c.tenant_id='${tenant}'::uuid and c.status<>'archived'
    and c.updated_at<s.cutoff::timestamptz
  order by c.updated_at,c.id limit 1
) select to_jsonb(c) card,to_jsonb(p) person,to_jsonb(co) company,
  public.learn_card_projection_inputs('${tenant}'::uuid,c.id) inputs,
  (select coalesce(jsonb_agg(to_jsonb(n)),'[]'::jsonb)
    from public.graph_nodes n where n.tenant_id=c.tenant_id
      and n.node_type='person' and n.source_table='people'
      and n.source_id=c.person_id) nodes,
  (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb)
    from public.graph_edges e where e.tenant_id=c.tenant_id
      and exists(select 1 from public.graph_nodes n where n.tenant_id=c.tenant_id
        and n.node_type='person' and n.source_table='people'
        and n.source_id=c.person_id and (e.from_node_id=n.id or e.to_node_id=n.id))) edges
from target c left join public.people p on p.id=c.person_id and p.tenant_id=c.tenant_id
left join public.companies co on co.id=c.company_id and co.tenant_id=c.tenant_id`;
const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
  method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
  headers: { Authorization: `Bearer ${savedCliToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `begin read only; set local role service_role;
    set local statement_timeout='8s'; ${query}; rollback;`, read_only: false }),
});
if (!response.ok) throw Error(`LIVE card replay read HTTP ${response.status}`);
const rows = await response.json();
if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.card ||
  !rows[0]?.inputs || !Array.isArray(rows[0]?.nodes) ||
  !Array.isArray(rows[0]?.edges)) throw Error("LIVE card replay input shape changed");
const record = rows[0];
const source = readFileSync(new URL("../../supabase/functions/_shared/worker_handlers/customer_card_sync.ts", import.meta.url), "utf8");
const exports = {};
runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports, Date, Set, Map,
  require: (name) => {
    if (name.endsWith("/customer_card.ts")) return calculators;
    if (name.endsWith("/simwood.ts")) return {
      isUuid: (value) => typeof value === "string" &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value),
    };
    throw Error("Unexpected replay dependency");
  },
});
let patch = null;
function table(name) {
  let filters = [], after = null, limit = null;
  const values = { customer_cards: [record.card], people: record.person ? [record.person] : [],
    companies: record.company ? [record.company] : [], graph_nodes: record.nodes,
    graph_edges: record.edges }[name];
  if (!values) throw Error("Unexpected replay table");
  const q = {
    select() { return q; },
    eq(key, value) { filters.push((row) => row[key] === value); return q; },
    in(key, set) { filters.push((row) => set.includes(row[key])); return q; },
    or() { return q; },
    order() { return q; },
    limit(value) { limit = value; return q; },
    gt(key, value) { after = [key, value]; return q; },
    update(value) { if (name !== "customer_cards") throw Error("Unexpected replay update");
      patch = value; return q; },
    maybeSingle() { return execute(true); },
    then(resolve, reject) { return execute(false).then(resolve, reject); },
  };
  async function execute(single) {
    if (patch) return { data: single ? { id: record.card.id } : null, error: null };
    const matched = values.filter((row) => filters.every((filter) => filter(row)))
      .filter((row) => !after || row[after[0]] > after[1]);
    const bounded = limit === null ? matched : matched.slice(0, limit);
    return { data: single ? bounded[0] ?? null : bounded, error: null };
  }
  return q;
}
const result = await exports.handleCustomerCardSync({ tenantId: tenant,
  payload: { customer_card_id: record.card.id },
  supabaseAdmin: { from: table,
    rpc: async (name) => name === "learn_card_projection_inputs"
      ? { data: record.inputs, error: null } : { data: null, error: { code: "unavailable" } } },
});
let rollbackUpdate = null;
if (mode === "--live-rollback-update-diagnostic") {
  if (!result.success || !patch || record.card.tenant_id !== tenant ||
    (record.person && record.person.tenant_id !== tenant) ||
    (record.company && record.company.tenant_id !== tenant) ||
    Object.keys(patch).some((key) => !["context", "title", "status",
      "latest_activity_at"].includes(key)) || !record.card.updated_at)
    throw Error("Rollback card update preflight failed");
  const quote = (value) => value === null ? "null"
    : `'${String(value).replaceAll("'", "''")}'`;
  const assignments = [
    `context=${quote(JSON.stringify(patch.context))}::jsonb`,
    ...(Object.hasOwn(patch, "title") ? [`title=${quote(patch.title)}::text`] : []),
    ...(Object.hasOwn(patch, "status") ? [`status=${quote(patch.status)}::text`] : []),
    ...(Object.hasOwn(patch, "latest_activity_at")
      ? [`latest_activity_at=${quote(patch.latest_activity_at)}::timestamptz`] : []),
  ];
  const guarded = `begin;
    set local role service_role;
    set local statement_timeout='8s';
    set local standard_conforming_strings=on;
    create temp table pg_temp.learn_card_update_diagnostic
      (sqlstate text, matched integer) on commit drop;
    do $diagnostic$ declare n integer; state text; begin
      begin
        update public.customer_cards set ${assignments.join(",")}
          where tenant_id='${tenant}'::uuid and id=${quote(record.card.id)}::uuid
            and updated_at=${quote(record.card.updated_at)}::timestamptz;
        get diagnostics n = row_count;
        insert into pg_temp.learn_card_update_diagnostic values('00000',n);
      exception when others then
        get stacked diagnostics state = returned_sqlstate;
        insert into pg_temp.learn_card_update_diagnostic values(state,0);
      end;
    end $diagnostic$;
    select sqlstate,matched from pg_temp.learn_card_update_diagnostic;
    rollback;`;
  const check = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${savedCliToken()}`,
      "Content-Type": "application/json" },
    body: JSON.stringify({ query: guarded, read_only: false }),
  });
  if (!check.ok) throw Error(`Rollback card update HTTP ${check.status}`);
  const rows = await check.json();
  if (!Array.isArray(rows) || rows.length !== 1 ||
    !/^[A-Z0-9]{5}$/.test(rows[0]?.sqlstate ?? "") ||
    !Number.isInteger(rows[0]?.matched) || rows[0].matched < 0 || rows[0].matched > 1)
    throw Error("Rollback card update result shape changed");
  rollbackUpdate = { sqlstate: rows[0].sqlstate, matched: rows[0].matched,
    committed: false };
}
console.log(JSON.stringify({ observedAt: new Date().toISOString(), project, tenant,
  offlineReplaySuccess: result.success, recordsProcessed: result.recordsProcessed ?? 0,
  failedCards: result.result?.failed ?? null, safeErrorCode: result.error?.code ?? null,
  patchPresent: patch !== null,
  patchJsonChars: patch === null ? null : JSON.stringify(patch).length,
  rollbackUpdate,
  sourceIdsReturned: false, customerContentReturned: false,
  rollbackOnlyUpdateAttempted: mode === "--live-rollback-update-diagnostic",
  committedProductionDataWrites: false }));
