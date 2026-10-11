/** Actual card handler + actual SQL eligibility and CAS writes; synthetic local fixture. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as calculators from "../../supabase/functions/_shared/customer_card.ts";
const container = process.argv[2];
if (!/^serviceos-processing-queue-[a-f0-9]{8}$/.test(container))
  throw Error("Offline fixture required");
const q = (v) => (v === null ? "null" : "'" + String(v).replaceAll("'", "''") + "'");
function sql(query) {
  const r = spawnSync(
    "/usr/local/bin/docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-h",
      "127.0.0.1",
      "-X",
      "-qAt",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", timeout: 30000 },
  );
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout.trim();
}
const tenant = "ed390000-aaaa-4000-8000-000000000001",
  card = "ed390000-aaaa-4000-8000-000000000003";
sql("begin;" + readFileSync("scripts/verify/learn-card-draft-probe.sql", "utf8") + "commit;");
const preserved = () =>
  sql(
    `select md5(jsonb_build_array((select jsonb_agg(to_jsonb(x) order by id) from email_messages x where tenant_id=${q(tenant)}),(select jsonb_agg(to_jsonb(x) order by id) from interactions x where tenant_id=${q(tenant)}),(select jsonb_agg(to_jsonb(x) order by id) from recommendations x where tenant_id=${q(tenant)}))::text)`,
  );
const before = preserved();
const db = {
  async rpc(name, args) {
    assert.equal(name, "learn_card_projection_inputs");
    assert.equal(args.p_tenant, tenant);
    return {
      data: JSON.parse(
        sql(
          `set role service_role;select public.learn_card_projection_inputs(${q(args.p_tenant)},${q(args.p_card)})`,
        ),
      ),
      error: null,
    };
  },
  from(table) {
    assert.ok(
      ["customer_cards", "people", "companies", "graph_nodes", "graph_edges"].includes(table),
    );
    const filters = [];
    let patch = null,
      columns = "*",
      single = false;
    const query = {
      select(s) {
        columns = s;
        return query;
      },
      eq(k, v) {
        assert.match(k, /^[a-z_]+$/);
        filters.push(`${k}=${q(v)}`);
        return query;
      },
      in(k, values) {
        assert.match(k, /^[a-z_]+$/);
        filters.push(`${k} in (${values.map(q).join(",")})`);
        return query;
      },
      update(p) {
        patch = p;
        return query;
      },
      maybeSingle() {
        single = true;
        return execute();
      },
      then(a, b) {
        return execute().then(a, b);
      },
    };
    async function execute() {
      if (table.startsWith("graph_")) return { data: [], error: null };
      assert.ok(filters.some((f) => f === `tenant_id=${q(tenant)}`));
      if (patch) {
        assert.equal(table, "customer_cards");
        assert.ok(filters.some((f) => f.startsWith("updated_at=")));
        assert.ok(
          Object.keys(patch).every((k) =>
            ["context", "title", "status", "latest_activity_at"].includes(k),
          ),
        );
        const cols = Object.keys(patch);
        const result = sql(
          `with changed as (update customer_cards c set ${cols.map((k) => `${k}=p.${k}`).join(",")} from jsonb_populate_record(null::customer_cards,${q(JSON.stringify(patch))}::jsonb)p where ${filters.map((f) => "c." + f).join(" and ")} returning c.id) select coalesce(jsonb_agg(to_jsonb(x)),'[]') from changed x`,
        );
        const rows = JSON.parse(result);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }
      assert.match(columns, /^[a-z_, *]+$/);
      const rows = JSON.parse(
        sql(
          `select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select ${columns} from ${table} where ${filters.join(" and ")})x`,
        ),
      );
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    }
    return query;
  },
};
const exports = {};
runInNewContext(
  ts.transpileModule(
    readFileSync("supabase/functions/_shared/worker_handlers/customer_card_sync.ts", "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  {
    exports,
    Date,
    Set,
    Map,
    require: (name) => {
      if (name.endsWith("/customer_card.ts")) return calculators;
      if (name.endsWith("/simwood.ts"))
        return { isUuid: (v) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v) };
      throw Error("Unexpected handler dependency");
    },
  },
);
const result = await exports.handleCustomerCardSync({
  tenantId: tenant,
  supabaseAdmin: db,
  payload: { customer_card_id: card },
});
assert.equal(result.success, true);
assert.equal(result.recordsProcessed, 1);
const saved = JSON.parse(sql(`select to_jsonb(c) from customer_cards c where id=${q(card)}`));
const p = saved.context.projection;
assert.equal(saved.context.manual_note, "keep");
assert.equal(p.communication.interaction_count, 105);
assert.equal(p.evidence.excludedDraftInteractions, 110);
assert.equal(p.evidence.sampledInteractions, 100);
assert.equal(p.business.avg_response_hours, null);
assert.equal(p.business.sentiment, null);
assert.equal(p.operations.open_recommendations, 51);
assert.equal(p.evidence.excludedDraftRecommendations, 1);
assert.equal(p.evidence.recommendationsTruncated, true);
assert.ok(p.timeline.every((x) => !x.label.includes("Draft-derived")));
assert.equal(preserved(), before);
console.log(
  "PASS: actual SQL eligibility -> real card calculator -> revision-checked saved projection excludes 110 drafts and retains every source/recommendation",
);
