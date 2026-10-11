import test from "node:test";
import assert from "node:assert/strict";
import { searchLearnCards, type LearnCardKind } from "./learn-cards.ts";
const T = "11111111-1111-4111-8111-111111111111",
  G = "22222222-2222-4222-8222-222222222222";
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
const row = (i: number) => ({
  id: id(i),
  tenant_id: T,
  title: `Customer ${i}`,
  updated_at: "2026-10-01T00:00:00Z",
});
const payload = (patch: Record<string, unknown> = {}) => ({
  version: "learn-card-search/1",
  tenantId: T,
  kind: "customer",
  query: '100%_* (A,B) "quoted"',
  page: 0,
  groupId: null,
  rows: [row(1)],
  hasMore: false,
  ...patch,
});
const query = '100%_* (A,B) "quoted"';
test("sends a bounded literal query as RPC data and validates the returned page", async () => {
  let calls = 0;
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls++;
      assert.equal(name, "learn_card_search");
      assert.deepEqual(args, {
        p_tenant: T,
        p_kind: "customer",
        p_query: query,
        p_page: 0,
        p_group: null,
      });
      return { data: payload(), error: null };
    },
  };
  const result = await searchLearnCards(db, T, "customer", `  ${query}  `);
  assert.equal(calls, 1);
  assert.equal(result.cards[0].title, "Customer 1");
  assert.equal(result.hasMore, false);
});
test("invalid scope, bounds and controls are refused before requesting data", async () => {
  const db = {
    rpc: async () => {
      throw Error("unexpected request");
    },
  };
  for (const args of [
    [T, "customer", ""],
    [T, "customer", "x".repeat(121)],
    [T, "customer", "a\nb"],
    [T, "customer", "a", -1],
    [T, "customer", "a", 10001],
    [T, "customer", "a", 0, Date.now(), G],
    ["wrong", "customer", "a"],
    [T, "unsupported", "a"],
  ])
    await assert.rejects((searchLearnCards as any)(db, ...args), /Invalid/);
});
test("foreign, stale, duplicate, truncated and malformed replies cannot become cards", async () => {
  const patches = [
    { tenantId: G },
    { kind: "job" },
    { query: "other" },
    { page: 1 },
    { groupId: G },
    { version: "future" },
    { rows: [{ ...row(1), tenant_id: G }] },
    { rows: [row(1), row(1)] },
    { rows: Array.from({ length: 25 }, (_, i) => row(i)) },
    { hasMore: true },
    { hasMore: "true" },
    { rows: null },
  ];
  for (const patch of patches)
    await assert.rejects(
      searchLearnCards(
        { rpc: async () => ({ data: payload(patch), error: null }) },
        T,
        "customer",
        query,
      ),
      /unavailable/,
    );
  await assert.rejects(
    searchLearnCards(
      { rpc: async () => ({ data: payload(), error: { message: "private failure" } }) },
      T,
      "customer",
      query,
    ),
    /unavailable/,
  );
});
test("all card scopes retain requested page and team constraints", async () => {
  for (const kind of ["job", "member", "team"] as LearnCardKind[]) {
    const group = kind === "job" ? undefined : G;
    const entry = {
      ...row(1),
      id: kind === "team" ? G : id(1),
      display_name: "Ada",
      name: "Office",
      org_unit_id: G,
      effective_to: null,
      job_number: "DH-2048",
    };
    const db = {
      rpc: async (_n: string, a: Record<string, unknown>) => {
        assert.equal(a.p_group, group ?? null);
        assert.equal(a.p_page, 2);
        return {
          data: payload({ kind, page: 2, groupId: group ?? null, rows: [entry] }),
          error: null,
        };
      },
    };
    const r = await searchLearnCards(db, T, kind, query, 2, Date.now(), group);
    assert.equal(r.cards[0].kind, kind);
    assert.equal(r.page, 2);
  }
  for (const entry of [
    { ...row(1), effective_to: null, org_unit_id: id(9) },
    { ...row(1), effective_to: "2026-10-01", org_unit_id: G },
  ])
    await assert.rejects(
      searchLearnCards(
        {
          rpc: async () => ({
            data: payload({ kind: "member", groupId: G, rows: [entry] }),
            error: null,
          }),
        },
        T,
        "member",
        query,
        0,
        Date.now(),
        G,
      ),
    );
});
