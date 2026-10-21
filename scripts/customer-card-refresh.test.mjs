import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as calculators from "../supabase/functions/_shared/customer_card.ts";
const source = readFileSync(
  new URL("../supabase/functions/_shared/worker_handlers/customer_card_sync.ts", import.meta.url),
  "utf8",
);
const exports = {};
runInNewContext(
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  {
    exports,
    Date,
    Set,
    Map,
    require: (name) => {
      if (name.endsWith("/customer_card.ts")) return calculators;
      if (name.endsWith("/simwood.ts"))
        return {
          isUuid: (v) =>
            typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v),
        };
      throw Error("Unexpected dependency");
    },
  },
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture({
  fail,
  missingPerson = false,
  synthetic = false,
  locked = false,
  inputOverride,
  conflict = false,
  size = 2,
  graphEdges,
  graphCountOverride,
} = {}) {
  const numbers = Array.from({ length: size }, (_, i) => i + 1);
  const cards = numbers.map((n) => ({
    id: id(n),
    tenant_id: id(100),
    person_id: id(n + 10),
    company_id: id(30),
    updated_at: "2026-01-01T00:00:00Z",
    title: "Retained title",
    status: "attention",
    context: {
      manual_note: "preserve",
      projection: { generated_at: "2026-01-01T00:00:00Z", business: { health: "critical" } },
    },
    locked_fields: locked ? ["title", "status"] : [],
  }));
  const original = structuredClone(cards),
    writes = [];
  let graphCountCalls = 0;
  const tables = {
    customer_cards: cards,
    people: numbers
      .filter((n) => !(missingPerson && n === 1))
      .map((n) => ({
        id: id(n + 10),
        display_name: "Person " + n,
        primary_email: synthetic ? "test@example.invalid" : `test${n}@example.org`,
      })),
    companies: [{ id: id(30), name: "Example company" }],
    graph_nodes: graphEdges ? numbers.map(n => ({ id: id(1000 + n), source_id: id(n + 10) })) : [{ id: id(40), source_id: id(11) }],
    graph_edges: graphEdges ?? [],
    interactions: [
      {
        id: id(50),
        interaction_type: "email_message",
        direction: "inbound",
        occurred_at: new Date().toISOString(),
        source_type: "email",
      },
    ],
    recommendations: [],
  };
  const db = {
    async rpc(name, args) {
      if (name === "learn_customer_card_relationship_counts") {
        assert.equal(args.p_tenant, id(100));
        assert.ok(args.p_node_ids.length >= 1 && args.p_node_ids.length <= 40, "bounded graph count batch");
        graphCountCalls++;
        const error = typeof fail === "function"
          ? fail({ table: "graph_edges", batchIndex: graphCountCalls, filter: "" })
          : fail === "graph_edges";
        if (error) return { data: null, error: { message: "PRIVATE DATABASE CONTENT" } };
        const rows = args.p_node_ids.map(node_id => ({
          node_id,
          edge_count: tables.graph_edges.reduce((n, e) =>
            n + Number(e.from_node_id === node_id) + Number(e.to_node_id === node_id), 0),
        }));
        if (graphCountOverride) graphCountOverride(rows);
        return { data: rows, error: null };
      }
      assert.equal(name, "learn_card_projection_inputs");
      assert.equal(args.p_tenant, id(100));
      const card = args.p_card;
      const filter = card === id(1) ? id(11) : id(12);
      if (
        ["interactions", "recommendations"].some((table) =>
          typeof fail === "function" ? fail({ table, filter, card }) : fail === table,
        )
      )
        return { data: null, error: { message: "PRIVATE DATABASE CONTENT" } };
      const data = {
        version: "learn-card-inputs/1",
        tenantId: id(100),
        cardId: card,
        capturedAt: new Date().toISOString(),
        interactions: tables.interactions,
        recommendations: tables.recommendations,
        coverage: {
          eligibleInteractions: 1,
          excludedDraftInteractions: 0,
          interactionsLast7: 1,
          interactionsPrev7: 0,
          eligibleRecommendations: 0,
          urgentRecommendations: 0,
          excludedDraftRecommendations: 0,
          interactionLimit: 100,
          recommendationLimit: 50,
        },
      };
      if (inputOverride) inputOverride(data);
      return { data, error: null };
    },
    from(table) {
      let eqs = [],
        filter = "",
        patch,
        cap, inFilter, after, orderBy,
        neqFilters = [], ltFilters = [], gtFilters = [], isFilters = [];
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          eqs.push([k, v]);
          return q;
        },
        neq(k, v) {
          neqFilters.push([k, v]);
          return q;
        },
        lt(k, v) {
          ltFilters.push([k, v]);
          return q;
        },
        order(k, options) {
          orderBy = [k, options?.ascending !== false];
          return q;
        },
        limit(n) {
          cap = n;
          return q;
        },
        in(k, values) {
          assert.ok(values.length <= 40, "bounded identity query");
          inFilter = [k, values];
          return q;
        },
        gt(k, value) {
          if (k === "id") after = value;
          else gtFilters.push([k, value]);
          return q;
        },
        is(k, value) {
          isFilters.push([k, value]);
          return q;
        },
        or(v) {
          assert.ok(v.length < 3500, "bounded graph URL");
          filter = v;
          return q;
        },
        update(v) {
          patch = v;
          return q;
        },
        maybeSingle() {
          return exec(true);
        },
        then(resolve, reject) {
          return exec(false).then(resolve, reject);
        },
      };
      async function exec(single) {
        assert.ok(
          eqs.some(([k, v]) => k === "tenant_id" && v === id(100)),
          "tenant scoped",
        );
        const card = eqs.find(([k]) => k === "card_id")?.[1];
        const error =
          typeof fail === "function" ? fail({ table, filter, card, patch, after }) : fail === table;
        if (error) return { data: null, error: { message: "PRIVATE DATABASE CONTENT" } };
        if (patch) {
          const key = eqs.find(([k]) => k === "id")?.[1];
          if (eqs.some(([k]) => k === "updated_at") && conflict) return { data: null, error: null };
          writes.push({ id: key, patch });
          Object.assign(
            cards.find((c) => c.id === key),
            structuredClone(patch),
            { updated_at: new Date().toISOString() },
          );
          return { data: single ? { id: key } : null, error: null };
        }
        let rows = tables[table];
        if (inFilter) rows = rows.filter(r => inFilter[1].includes(r[inFilter[0]]));
        for (const [k, v] of neqFilters) rows = rows.filter(r => r[k] !== v);
        for (const [k, v] of ltFilters) rows = rows.filter(r => r[k] < v);
        for (const [k, v] of gtFilters) rows = rows.filter(r => r[k] > v);
        for (const [k, v] of isFilters) {
          if (k === "context->>projection")
            rows = rows.filter(r => (r.context?.projection ?? null) === v);
          else rows = rows.filter(r => (r[k] ?? null) === v);
        }
        if (table === "graph_edges" && filter) {
          const ids = filter.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g) ?? [];
          rows = rows.filter(r => ids.includes(r.from_node_id) || ids.includes(r.to_node_id))
            .sort((a, b) => a.id.localeCompare(b.id));
          if (after) rows = rows.filter(r => r.id > after);
        }
        if (table === "customer_cards") {
          for (const [k, v] of eqs) if (k !== "tenant_id") rows = rows.filter(r => r[k] === v);
        }
        if (orderBy) {
          const [k, ascending] = orderBy;
          rows = [...rows].sort((a, b) =>
            String(a[k]).localeCompare(String(b[k])) * (ascending ? 1 : -1));
        }
        if (cap) rows = rows.slice(0, cap);
        return { data: single ? (rows[0] ?? null) : rows, error: null };
      }
      return q;
    },
  };
  return {
    cards,
    original,
    writes,
    graphCountCalls: () => graphCountCalls,
    run: (payload) =>
      exports.handleCustomerCardSync({
        tenantId: id(100),
        supabaseAdmin: db,
        payload: payload ?? {},
      }),
  };
}
test("500-card sweep paginates ten at a time and preserves cross-batch and self-loop counts", async () => {
  const graphEdges = Array.from({length: 1001}, (_, i) => ({id: id(10000 + i), from_node_id: id(1001), to_node_id: id(1041)}));
  graphEdges.push({id: id(20000), from_node_id: id(1001), to_node_id: id(1001)});
  const f = fixture({size: 500, graphEdges});
  const sweep_since = "2026-10-21T00:00:00Z";
  let projected = 0;
  for (let page = 0; page < 50; page++) {
    const r = await f.run({limit: 500, sweep_since});
    assert.equal(r.success, true);
    assert.equal(r.recordsProcessed, 10);
    projected += r.recordsProcessed;
  }
  assert.equal(projected, 500);
  assert.equal((await f.run({sweep_since})).recordsProcessed, 0);
  assert.equal(f.cards[0].context.projection.business.relationship_count, 1003);
  assert.equal(f.cards[40].context.projection.business.relationship_count, 1001);
  assert.equal(f.cards[499].context.projection.business.relationship_count, 0);
  assert.equal(f.graphCountCalls(), 50);
});
test("a later graph count batch failure retains that batch's saved projections", async () => {
  const graphEdges = Array.from({length: 501}, (_, i) => ({id: id(10000 + i), from_node_id: id(1001), to_node_id: id(1041)}));
  const f = fixture({size: 200, graphEdges, fail: q => q.table === 'graph_edges' && q.batchIndex === 2});
  const sweep_since = "2026-10-21T00:00:00Z";
  assert.equal((await f.run({sweep_since})).success, true);
  assert.equal(f.writes.length, 10);
  assert.equal((await f.run({sweep_since})).success, false);
  assert.equal(f.writes.length, 10);
  assert.deepEqual(f.cards.slice(10), f.original.slice(10));
});
test("malformed graph degree envelopes never overwrite saved cards", async () => {
  for (const mutate of [
    rows => rows.pop(),
    rows => { rows[0].node_id = id(9999); },
    rows => { rows[0].edge_count = -1; },
    rows => { rows[0].edge_count = 0.5; },
    rows => { if (rows.length > 1) rows[1].node_id = rows[0].node_id; },
  ]) {
    const f = fixture({ graphEdges: [], graphCountOverride: mutate });
    const r = await f.run();
    assert.equal(r.success, false);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.cards, f.original);
  }
});
test("shared identity and graph read failures preserve every prior card and redact database prose", async () => {
  for (const table of ["customer_cards", "people", "companies", "graph_nodes", "graph_edges"]) {
    const f = fixture({ fail: table });
    const r = await f.run();
    assert.equal(r.success, false, table);
    assert.equal(r.error.retryable, true);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.cards, f.original);
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
  const f = fixture({ fail: "graph_nodes" });
  assert.equal((await f.run({ graph_node_id: id(40) })).success, false);
  assert.equal(f.writes.length, 0);
});
test("one failed interaction or recommendation read keeps that card intact while other cards refresh", async () => {
  for (const table of ["interactions", "recommendations"]) {
    const f = fixture({
      fail: (q) => q.table === table && (q.filter.includes(id(11)) || q.card === id(1)),
    });
    const r = await f.run();
    assert.equal(r.success, false);
    assert.equal(r.result.failed, 1);
    assert.equal(r.result.cards_projected, 1);
    assert.deepEqual(f.cards[0], f.original[0]);
    assert.equal(f.writes[0].id, id(2));
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});
test("missing linked identity never replaces a saved card with unresolved zeroes", async () => {
  const f = fixture({ missingPerson: true });
  const r = await f.run();
  assert.equal(r.result.failed, 1);
  assert.deepEqual(f.cards[0], f.original[0]);
  assert.equal(r.result.cards_projected, 1);
});
test("healthy reads refresh cards, preserve manual context and respect locked title/status", async () => {
  const f = fixture({ locked: true });
  const r = await f.run();
  assert.equal(r.success, true);
  assert.equal(r.recordsProcessed, 2);
  assert.equal(f.cards[0].context.manual_note, "preserve");
  assert.equal(f.cards[0].title, "Retained title");
  assert.equal(f.cards[0].status, "attention");
  assert.equal(f.cards[0].context.projection.communication.interaction_count, 1);
});
test("unconfirmed synthetic sweep cursor writes fail without claiming a skip; successful skips are counted", async () => {
  const bad = fixture({ synthetic: true, fail: (q) => q.table === "customer_cards" && !!q.patch });
  const r = await bad.run();
  assert.equal(r.success, false);
  assert.equal(r.result.failed, 2);
  assert.equal(r.result.skipped, 0);
  assert.deepEqual(bad.cards, bad.original);
  const good = fixture({ synthetic: true });
  const done = await good.run();
  assert.equal(done.success, true);
  assert.equal(done.result.skipped, 2);
  assert.equal(done.recordsProcessed, 0);
});
test("HTTP wrapper marks partial card refresh failed, never complete, and preserves failure counts", async () => {
  const actual = await fixture({
    fail: (q) => q.table === "interactions" && q.filter.includes(id(11)),
  }).run();
  for (const result of [
    actual,
    { success: true, recordsProcessed: 2, result: { cards_projected: 2, failed: 0 } },
  ]) {
    let handler;
    const calls = [];
    const code = readFileSync(
      new URL("../supabase/functions/customer-card-sync/index.ts", import.meta.url),
      "utf8",
    );
    runInNewContext(
      ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
      {
        exports: {},
        Deno: { serve: (fn) => (handler = fn) },
        Request,
        Response,
        require: (name) => {
          if (name.endsWith("/simwood.ts"))
            return {
              corsHeaders: {},
              createSupabaseAdmin: () => ({}),
              failResponse: (code, message, status) =>
                Response.json({ success: false, error: { code, message } }, { status }),
              jsonResponse: (d) => Response.json(d),
            };
          if (name.endsWith("/authz.ts"))
            return {
              requireTenantUser: async () => ({
                ok: true,
                ctx: { tenantId: id(100), userId: id(101) },
              }),
              assertSameTenant: () => null,
            };
          if (name.endsWith("/customer_card_sync.ts"))
            return { handleCustomerCardSync: async () => result };
          if (name.endsWith("/platform_jobs.ts"))
            return {
              createPlatformJob: async () => ({ id: id(102) }),
              startPlatformJob: async () => {},
              completePlatformJob: async (...args) => calls.push(["complete", ...args]),
              failPlatformJob: async (...args) => calls.push(["failed", ...args]),
            };
          throw Error("Unexpected wrapper import");
        },
      },
    );
    const response = await handler(
      new Request("https://test.invalid", { method: "POST", body: "{}" }),
    );
    assert.equal(response.status, result.success ? 200 : 500);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], result.success ? "complete" : "failed");
    if (!result.success) assert.equal(calls[0][4].failed, 1);
  }
});

test("eligibility failure or malformed tenant/count envelope preserves prior cards", async () => {
  for (const change of [
    (d) => {
      d.tenantId = id(999);
    },
    (d) => {
      d.coverage.eligibleInteractions = 0;
    },
    (d) => {
      d.interactions = null;
    },
    (d) => {
      d.capturedAt = "invalid";
    },
  ]) {
    const f = fixture({ inputOverride: change });
    const r = await f.run();
    assert.equal(r.success, false);
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.cards, f.original);
  }
});
test("draft-only projection clears stale activity and produces no sent reply evidence", async () => {
  const f = fixture({
    inputOverride: (d) => {
      d.interactions = [];
      Object.assign(d.coverage, {
        eligibleInteractions: 0,
        interactionsLast7: 0,
        excludedDraftInteractions: 2,
        excludedDraftRecommendations: 1,
      });
    },
  });
  const r = await f.run();
  assert.equal(r.success, true);
  const p = f.cards[0].context.projection;
  assert.equal(p.communication.interaction_count, 0);
  assert.equal(p.communication.last_interaction_at, null);
  assert.equal(f.cards[0].latest_activity_at, null);
  assert.equal(p.business.avg_response_hours, null);
  assert.equal(p.timeline.length, 0);
  assert.equal(p.evidence.excludedDraftInteractions, 2);
  assert.equal(f.cards[0].context.manual_note, "preserve");
});
test("concurrent card edit is not overwritten or reported as a successful refresh", async () => {
  const f = fixture({ conflict: true });
  const r = await f.run();
  assert.equal(r.success, false);
  assert.equal(r.result.failed, 2);
  assert.equal(r.recordsProcessed, 0);
  assert.deepEqual(f.cards, f.original);
});
