import test from "node:test";
import assert from "node:assert/strict";
import { loadDiscoveryHistory } from "../supabase/functions/_shared/controlplane/discovery_history.ts";
const tenant = "10000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000001";
const id = (n) => `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-11T00:00:00Z");
const tables = ["data_imports", "email_sync_runs", "phone_sync_runs"];
const row = (n, values = {}) => ({
  id: id(n),
  tenant_id: tenant,
  provider: "sipcentric",
  source_system: "csv",
  sync_type: "calls",
  entity_type: "contacts",
  status: "success",
  started_at: "2026-10-10T00:00:00.000001Z",
  completed_at: "2026-10-10T01:00:00Z",
  created_at: "2026-10-09T00:00:00Z",
  records_processed: 4,
  row_count: 4,
  ...values,
});
const stamp = (s) =>
  BigInt(Date.parse(s)) * 1000n +
  BigInt((s.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
function split(s) {
  let depth = 0,
    start = 0,
    parts = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")") depth--;
    if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}
function match(r, expression) {
  if (expression.startsWith("and("))
    return split(expression.slice(4, -1)).every((e) => match(r, e));
  const [, key, op, v] = expression.match(/^(\w+)\.(is|eq|lt|lte)\.(.*)$/) ?? [];
  assert.ok(key, expression);
  if (op === "is") return r[key] === null;
  if (r[key] == null) return false;
  const a = key.endsWith("_at") ? stamp(r[key]) : r[key],
    b = key.endsWith("_at") ? stamp(v) : v;
  return op === "eq" ? a === b : op === "lt" ? a < b : a <= b;
}
function database(records, transform = (r) => r, cap = 7) {
  const calls = [];
  return {
    calls,
    from(table) {
      let rows = [...(records[table] ?? [])],
        columns = [],
        head = false,
        limit = Infinity,
        orders = [];
      const q = {},
        c = { table, head: false };
      q.select = (s, o) => {
        columns = s.split(",");
        head = o?.head === true;
        c.head = head;
        return q;
      };
      q.eq = (k, v) => {
        rows = rows.filter((r) => r[k] === v);
        return q;
      };
      q.lte = (k, v) => {
        rows = rows.filter((r) => r[k] != null && stamp(r[k]) <= stamp(v));
        return q;
      };
      q.or = (s) => {
        c.where = s;
        rows = rows.filter((r) => split(s).some((e) => match(r, e)));
        return q;
      };
      q.order = (k, o) => {
        orders.push([k, o]);
        return q;
      };
      q.limit = (n) => {
        limit = n;
        return q;
      };
      q.then = (resolve, reject) => {
        calls.push(c);
        rows.sort((a, b) => {
          for (const [k, o] of orders) {
            if (a[k] === b[k]) continue;
            if (a[k] === null) return o.nullsFirst ? -1 : 1;
            if (b[k] === null) return o.nullsFirst ? 1 : -1;
            const x = k.endsWith("_at") ? stamp(a[k]) : a[k],
              y = k.endsWith("_at") ? stamp(b[k]) : b[k];
            if (x === y) continue;
            return (x < y ? -1 : 1) * (o.ascending ? 1 : -1);
          }
          return 0;
        });
        return Promise.resolve(
          transform(
            {
              data: head
                ? null
                : rows
                    .slice(0, Math.min(limit, cap))
                    .map((r) => Object.fromEntries(columns.map((k) => [k, r[k]]))),
              count: rows.length,
              error: null,
            },
            c,
            calls,
          ),
        ).then(resolve, reject);
      };
      return q;
    },
  };
}
const fixture = () =>
  Object.fromEntries(
    tables.map((t) => [
      t,
      Array.from({ length: 17 }, (_, n) =>
        row(n + 1, { provider: t === "email_sync_runs" ? "google_workspace" : "sipcentric" }),
      ),
    ]),
  );
async function all(db, opts = {}) {
  const out = [];
  let cursor = null;
  do {
    const r = await loadDiscoveryHistory(db, tenant, { page_size: 10, ...opts, cursor }, now);
    out.push(...r.runs);
    cursor = r.next_cursor;
  } while (cursor);
  return out;
}
test("merged cursor reads all three sources across lower caps, duplicate IDs and timestamp ties", async () => {
  const db = database(fixture());
  const rows = await all(db);
  assert.equal(rows.length, 51);
  assert.equal(new Set(rows.map((r) => r.source + ":" + r.run_id)).size, 51);
  assert.deepEqual(
    rows.map((r) => r.source),
    tables.flatMap((t) => Array(17).fill(t)),
  );
  assert.equal(rows[0].run_id, id(17));
  assert.equal(rows.at(-1).run_id, id(1));
});
test("microsecond timestamps, timezone offsets and null import starts retain deterministic chronology", async () => {
  const f = {
    phone_sync_runs: [
      row(1, { started_at: "2026-10-10T00:00:00.000009Z" }),
      row(2, { started_at: "2026-10-10T00:00:00.000001Z" }),
    ],
    email_sync_runs: [row(3, { started_at: "2026-10-10T01:00:00.000005+01:00" })],
    data_imports: [row(4, { started_at: null }), row(5, { started_at: null })],
  };
  const rows = await all(database(f), { page_size: 1 });
  assert.deepEqual(
    rows.map((r) => r.run_id),
    [1, 3, 2, 5, 4].map(id),
  );
  assert.equal(rows.at(-1).started_at, null);
});
test("provider and status filters apply before paging; foreign and future runs stay out", async () => {
  const f = fixture();
  f.phone_sync_runs.push(
    row(99, { tenant_id: other }),
    row(100, { started_at: "2027-01-01T00:00:00Z" }),
    row(101, { status: "failed", error_message: "Timeout retained" }),
  );
  f.data_imports.push(row(102, { created_at: "2027-01-01T00:00:00Z", started_at: null }));
  const rows = await all(database(f), { provider: "sipcentric", status: "failed" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].error, "Timeout retained");
  assert.equal((await all(database(f))).length, 52);
});
test("thousands of rows remain navigable without full-table data responses", async () => {
  const f = Object.fromEntries(
    tables.map((t) => [t, Array.from({ length: 2503 }, (_, n) => row(n + 1))]),
  );
  const db = database(f, undefined, 37);
  const rows = await all(db, { page_size: 100 });
  assert.equal(rows.length, 7509);
  assert.equal(new Set(rows.map((r) => r.source + ":" + r.run_id)).size, 7509);
  assert.equal(rows.at(-1).run_id, id(1));
});
test("counts changing between pages require refresh rather than silently shifting the page", async () => {
  const f = fixture(),
    db = database(f);
  const first = await loadDiscoveryHistory(db, tenant, { page_size: 10 }, now);
  f.phone_sync_runs.push(row(100));
  await assert.rejects(
    loadDiscoveryHistory(db, tenant, { page_size: 10, cursor: first.next_cursor }, now),
    /History changed/,
  );
});
test("errors, missing counts, premature empty pages and foreign records cannot become successful history", async () => {
  for (const table of tables) {
    for (const mutate of [
      (r) => ({ ...r, error: { message: "offline" } }),
      (r) => ({ ...r, count: null }),
      (r) => ({ ...r, data: r.data?.map((x) => ({ ...x, tenant_id: other })) }),
    ])
      await assert.rejects(
        loadDiscoveryHistory(
          database(fixture(), (r, c) => (c.table === table ? mutate(r) : r)),
          tenant,
          {},
          now,
        ),
      );
  }
  await assert.rejects(
    loadDiscoveryHistory(
      database(fixture(), (r, c) =>
        !c.head && c.table === "data_imports" ? { ...r, data: [] } : r,
      ),
      tenant,
      {},
      now,
    ),
    /truncated/,
  );
});
test("cursor is bound to company, filters and page size, and malformed navigation is rejected", async () => {
  const db = database(fixture());
  const first = await loadDiscoveryHistory(db, tenant, { page_size: 10 }, now);
  for (const opts of [
    { page_size: 11 },
    { provider: "other" },
    { status: "failed" },
    { page: 999 },
  ])
    await assert.rejects(
      loadDiscoveryHistory(db, tenant, { page_size: 10, cursor: first.next_cursor, ...opts }, now),
    );
  await assert.rejects(
    loadDiscoveryHistory(db, other, { page_size: 10, cursor: first.next_cursor }, now),
  );
  for (const cursor of ["bad!", btoa("null"), btoa("[]"), btoa("false")])
    await assert.rejects(loadDiscoveryHistory(db, tenant, { cursor }, now));
  for (const opts of [
    { page: -1 },
    { page: 1 },
    { page_size: 0 },
    { page_size: 101 },
    { page_size: 1.5 },
  ])
    await assert.rejects(loadDiscoveryHistory(db, tenant, opts, now));
});
test("empty history is truthful and Unicode provider filters survive cursor round trips", async () => {
  assert.equal((await loadDiscoveryHistory(database({}), tenant, {}, now)).total, 0);
  const provider = "système d’équipe";
  const rows = await all(
    database({
      data_imports: [row(1, { source_system: provider }), row(2, { source_system: provider })],
    }),
    { provider, page_size: 1 },
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.provider === provider));
});
