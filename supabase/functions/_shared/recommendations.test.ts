import { test } from "node:test";
import assert from "node:assert/strict";
import { upsertRecommendation } from "./recommendations.ts";

const input = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  cardId: "00000000-0000-0000-0000-000000000002",
  personId: null,
  companyId: null,
  rec: {
    type: "review_new_contact", source_rule: "new_customer_review",
    severity: "medium" as const, title: "Review contact", detail: "Synthetic",
    recommended_action: "Review", impact: "Unreviewed", confidence: 0.5,
    due_at: null, interaction_id: null, evidence: [],
  },
};

function fakeClient({ lookups, insert, updateError = null }: {
  lookups: Array<{ data: { id: string } | null; error?: { code: string } | null }>;
  insert: { data: { id: string } | null; error?: { code: string } | null };
  updateError?: { code: string } | null;
}) {
  const calls: Array<{ operation: string; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      assert.equal(table, "recommendations");
      const call = { operation: "", filters: [] as Array<[string, unknown]> };
      calls.push(call);
      const chain = {
        select(_columns: string) { if (!call.operation) call.operation = "lookup"; return chain; },
        eq(key: string, value: unknown) { call.filters.push([key, value]); return chain; },
        maybeSingle() { return Promise.resolve(lookups.shift() ?? { data: null }); },
        insert(_value: unknown) { call.operation = "insert"; return chain; },
        single() { return Promise.resolve(insert); },
        update(_value: unknown) { call.operation = "update"; return chain; },
        then(resolve: (value: unknown) => void) { resolve({ error: updateError }); },
      };
      return chain;
    },
  };
  return { client: client as any, calls };
}

test("ordinary recommendation refresh updates the existing tenant-bound row without an insert", async () => {
  const { client, calls } = fakeClient({ lookups: [{ data: { id: "existing" } }],
    insert: { data: null } });
  assert.deepEqual(await upsertRecommendation(client, input), { id: "existing", created: false });
  assert.deepEqual(calls.map(c => c.operation), ["lookup", "update"]);
  assert.ok(calls.every(c => c.filters.some(([key, value]) =>
    key === "tenant_id" && value === input.tenantId)));
});

test("new recommendation inserts once; a concurrent creator is enriched after its unique conflict", async () => {
  const fresh = fakeClient({ lookups: [{ data: null }], insert: { data: { id: "new" } } });
  assert.deepEqual(await upsertRecommendation(fresh.client, input), { id: "new", created: true });
  assert.deepEqual(fresh.calls.map(c => c.operation), ["lookup", "insert"]);

  const race = fakeClient({ lookups: [{ data: null }, { data: { id: "raced" } }],
    insert: { data: null, error: { code: "23505" } } });
  assert.deepEqual(await upsertRecommendation(race.client, input),
    { id: "raced", created: false });
  assert.deepEqual(race.calls.map(c => c.operation), ["lookup", "insert", "lookup", "update"]);
});

test("failed enrichment is reported as unconfirmed", async () => {
  const { client } = fakeClient({ lookups: [{ data: { id: "existing" } }],
    insert: { data: null }, updateError: { code: "57014" } });
  assert.deepEqual(await upsertRecommendation(client, input), { id: null, created: false });
});
