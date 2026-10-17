import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(
  new URL("../../supabase/functions/_shared/worker_handlers/recommendation_sync.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const touched = [];
const stubs = {
  "../simwood.ts": { isUuid: value => typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) },
  "../recommendations.ts": {
    buildRecommendationsForCard: () => [],
    closeResolvedRecommendations: async (_admin, { cardId }) => { touched.push(cardId); return 0; },
    upsertRecommendation: () => { throw Error("No recommendation expected in selector test"); },
  },
};
const exports = {};
new Function("require", "exports", compiled)((name) => {
  if (!(name in stubs)) throw Error(`Unexpected import ${name}`);
  return stubs[name];
}, exports);
const { handleRecommendationSync } = exports;
const tenant = "f8c114fa-fee7-4983-8970-f6e7f5fd3129";
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const cards = Array.from({ length: 6 }, (_, n) => ({
  id: id(n + 1), tenant_id: tenant, status: "amber", person_id: null,
  company_id: null, confidence: null,
  latest_activity_at: new Date(Date.UTC(2026, 9, n + 1)).toISOString(),
  context: { projection: { business: {}, operations: {} } },
}));

function adminFor(rows) {
  return {
    from(table) {
      assert.equal(table, "customer_cards");
      const filters = [];
      const sort = [];
      let count = Infinity;
      const query = {
        select() { return this; },
        eq(field, value) { filters.push(row => row[field] === value); return this; },
        neq(field, value) { filters.push(row => row[field] !== value); return this; },
        gt(field, value) { filters.push(row => row[field] > value); return this; },
        lte(field, value) { filters.push(row => row[field] <= value); return this; },
        order(field, options) { sort.push({ field, ascending: options.ascending }); return this; },
        limit(value) { count = value; return this; },
        then(resolve, reject) {
          try {
            const data = rows.filter(row => filters.every(check => check(row)))
              .sort((a, b) => {
                for (const { field, ascending } of sort) {
                  const difference = String(a[field]).localeCompare(String(b[field]));
                  if (difference) return ascending ? difference : -difference;
                }
                return 0;
              }).slice(0, count);
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          } catch (error) { return Promise.reject(error).then(resolve, reject); }
        },
      };
      return query;
    },
  };
}

test("full recommendation scan reaches older cards while reserving a recent card", async () => {
  touched.length = 0;
  const admin = adminFor(cards);
  const first = await handleRecommendationSync({ supabaseAdmin: admin, tenantId: tenant,
    payload: { limit: 4 } });
  assert.equal(first.success, true);
  assert.equal(first.result.selected, 4);
  assert.equal(first.result.swept, 3);
  assert.equal(first.result.urgent, 1);
  assert.ok(first.continuation);
  assert.deepEqual(new Set(touched), new Set([id(1), id(2), id(3), id(6)]));

  const second = await handleRecommendationSync({ supabaseAdmin: admin, tenantId: tenant,
    payload: first.continuation.payload });
  assert.equal(second.success, true);
  assert.equal(second.result.selected, 3);
  assert.equal(second.result.swept, 3);
  assert.ok(second.continuation);
  assert.deepEqual(new Set(touched), new Set(cards.map(card => card.id)));

  const third = await handleRecommendationSync({ supabaseAdmin: admin, tenantId: tenant,
    payload: second.continuation.payload });
  assert.equal(third.success, true);
  assert.equal(third.result.swept, 0);
  assert.equal(third.continuation, undefined);
});

test("targeted recommendation read stays bounded and does not continue", async () => {
  touched.length = 0;
  const result = await handleRecommendationSync({ supabaseAdmin: adminFor(cards),
    tenantId: tenant, payload: { customer_card_id: id(2), limit: 1 } });
  assert.equal(result.success, true);
  assert.equal(result.result.selected, 1);
  assert.equal(result.continuation, undefined);
  assert.deepEqual(touched, [id(2)]);
});

test("new activity is considered without extending the pinned full-scan boundary", async () => {
  touched.length = 0;
  const rows = cards.map(card => ({ ...card }));
  const admin = adminFor(rows);
  const first = await handleRecommendationSync({ supabaseAdmin: admin, tenantId: tenant,
    payload: { limit: 4 } });
  assert.ok(first.continuation);
  rows.push({ ...cards[0], id: id(7),
    latest_activity_at: new Date(Date.UTC(2026, 9, 17)).toISOString() });
  const second = await handleRecommendationSync({ supabaseAdmin: admin, tenantId: tenant,
    payload: first.continuation.payload });
  assert.ok(touched.includes(id(7)), "new activity is admitted by the urgent slot");
  assert.equal(second.result.swept, 3, "the old scan still reaches its pinned end");
  const third = await handleRecommendationSync({ supabaseAdmin: admin, tenantId: tenant,
    payload: second.continuation.payload });
  assert.equal(third.continuation, undefined);
  assert.equal(third.result.swept, 0);
});

test("invalid sweep cursor fails closed", async () => {
  const result = await handleRecommendationSync({ supabaseAdmin: adminFor(cards),
    tenantId: tenant, payload: { sweep_after: id(3), limit: 4 } });
  assert.equal(result.success, false);
  assert.equal(result.error.code, "recommendation_sync_error");
});
