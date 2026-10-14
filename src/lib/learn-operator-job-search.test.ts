import test from "node:test";
import assert from "node:assert/strict";
import { searchOperatorJobs } from "./learn-operator-job-search.ts";
const id = (n: number) => `bc170000-aaaa-4000-8000-${String(n).padStart(12, "0")}`;
const args = { tenant: id(1), actor: id(10), query: "001", reason: "Review selected job" };
const row = (n: number) => ({
  id: id(n),
  fields: {
    job_number: "001",
    title: "008. Servicing",
    status: "open",
    customer: "Synthetic",
    address: null,
    postcode: null,
  },
});
const page = () => ({
  version: "openfolk-job-search/1",
  tenant_id: id(1),
  actor_id: id(10),
  query: "001",
  after: null,
  rows: [row(100)],
  next_after: null,
  observed_at: new Date().toISOString(),
  audit_id: id(500),
});
const signal = new AbortController().signal;
const client = (data: unknown, error: unknown = null) => ({
  rpc: () => ({ abortSignal: async () => ({ data, error }) }),
});
test("binds selected tenant, literal query and cursor; preserves leading zero codes", async () => {
  const found = await searchOperatorJobs(
    {
      rpc(name, a) {
        assert.equal(name, "learn_operator_job_search");
        assert.deepEqual(a, {
          p_tenant: id(1),
          p_query: "001",
          p_reason: args.reason,
          p_after: null,
        });
        return {
          abortSignal: async (s) => {
            assert.equal(s, signal);
            return { data: page(), error: null };
          },
        };
      },
    },
    args,
    signal,
  );
  assert.equal(found.rows[0].fields.job_number, "001");
  assert.equal(found.rows[0].fields.title, "008. Servicing");
});
test("rejects stale, cross-tenant, unaudited and wrong-search results", async () => {
  for (const patch of [
    { tenant_id: id(2) },
    { actor_id: id(11) },
    { query: "016" },
    { after: id(100) },
    { audit_id: null },
    { observed_at: "2020-01-01" },
    { observed_at: null },
    { rows: [{ ...row(100), fields: { ...row(100).fields, job_number: 1 } }] },
  ])
    await assert.rejects(searchOperatorJobs(client({ ...page(), ...patch }), args, signal));
});
test("validates pagination and rejects duplicate or out-of-order rows", async () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(100 + i));
  assert.equal(
    (await searchOperatorJobs(client({ ...page(), rows, next_after: id(124) }), args, signal))
      .next_after,
    id(124),
  );
  for (const patch of [
    { rows: [row(100), row(100)] },
    { rows: [row(101), row(100)] },
    { rows, next_after: id(125) },
    { rows: rows.slice(0, 24), next_after: id(123) },
  ])
    await assert.rejects(searchOperatorJobs(client({ ...page(), ...patch }), args, signal));
  await assert.rejects(
    searchOperatorJobs(client({ ...page(), after: id(100) }), { ...args, after: id(100) }, signal),
  );
});
test("invalid arguments do not read and backend internals remain private", async () => {
  for (const patch of [
    { query: "x".repeat(121) },
    { tenant: "bad" },
    { reason: "" },
    { after: "bad" },
  ])
    await assert.rejects(
      searchOperatorJobs(
        {
          rpc() {
            throw Error("Must not call");
          },
        },
        { ...args, ...patch },
        signal,
      ),
      /could not be verified/,
    );
  await assert.rejects(
    searchOperatorJobs(client(null, { message: "PRIVATE_DETAIL" }), args, signal),
    (e) => !String(e).includes("PRIVATE_DETAIL"),
  );
});
