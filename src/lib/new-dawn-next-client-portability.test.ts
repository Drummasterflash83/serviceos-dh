import test from "node:test";
import assert from "node:assert/strict";
import { selectedWorkspace } from "./client-workspace-nav.ts";
import { searchLearnCards } from "./learn-cards.ts";

const first = "11111111-1111-4111-8111-111111111111";
const second = "22222222-2222-4222-8222-222222222222";
const fixtures = [
  { tenant_id: first, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "Drummonds job", job_number: "001", status: "open", verified: false },
  { tenant_id: second, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Housing association repair", job_number: "HA-17", status: "open", verified: false },
];

test("the same job-card path serves two synthetic tenants without crossing names or source codes", async () => {
  const requested: string[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "learn_card_search");
      assert.equal(args.p_kind, "job");
      requested.push(String(args.p_tenant));
      const tenant = String(args.p_tenant);
      return { data: {
        version: "learn-card-search/1", tenantId: tenant, kind: "job", query: args.p_query,
        page: 0, groupId: null,
        rows: fixtures.filter((row) => row.tenant_id === tenant && row.title.toLowerCase().includes(String(args.p_query).toLowerCase())),
        hasMore: false,
      }, error: null };
    },
  };
  const workspaces = [{ tenant_id: first }, { tenant_id: second }];
  assert.equal(selectedWorkspace(workspaces, second)?.tenant_id, second);
  assert.equal(selectedWorkspace(workspaces, "33333333-3333-4333-8333-333333333333"), undefined);

  const a = await searchLearnCards(db, first, "job", "r");
  const b = await searchLearnCards(db, second, "job", "r");
  assert.deepEqual(requested, [first, second]);
  assert.deepEqual(a.cards.map(({ title, subtitle }) => [title, subtitle]), [["Drummonds job", "001"]]);
  assert.deepEqual(b.cards.map(({ title, subtitle }) => [title, subtitle]), [["Housing association repair", "HA-17"]]);
  assert.equal(a.cards[0].recordState, "Job record needs review");
  assert.equal(b.cards[0].recordState, "Job record needs review");
});

test("a provider or cache that returns a foreign tenant's job is rejected", async () => {
  const db = { rpc: async () => ({ data: {
    version: "learn-card-search/1", tenantId: second, kind: "job", query: "repair",
    page: 0, groupId: null, rows: [fixtures[1]], hasMore: false,
  }, error: null }) };
  await assert.rejects(searchLearnCards(db, first, "job", "repair"), /unavailable/);
  const mixed = { rpc: async () => ({ data: {
    version: "learn-card-search/1", tenantId: first, kind: "job", query: "repair",
    page: 0, groupId: null, rows: fixtures, hasMore: false,
  }, error: null }) };
  await assert.rejects(searchLearnCards(mixed, first, "job", "repair"), /unavailable/);
});
