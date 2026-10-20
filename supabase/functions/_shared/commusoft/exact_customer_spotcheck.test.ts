import assert from "node:assert/strict";
import test from "node:test";
import { runCustomerSpotcheck, validateSpotcheckRequest } from "./exact_customer_spotcheck.ts";

const batchId = "10000000-0000-4000-8000-000000000001";
const tenantId = "10000000-0000-4000-8000-000000000002";
const source = "10000000-0000-4000-8000-000000000003";
const check = { action: "check" as const, batchId, ordinal: 1 };

test("only one exact ten-ID registration or one numbered check is accepted", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ external_id: String(i + 1), source_version_id: source }));
  const registration = { action: "register", batchId, tenantId, reason: "Current source spot check", items };
  assert.equal(validateSpotcheckRequest(registration), true);
  assert.equal(validateSpotcheckRequest({ ...registration, items: items.slice(0, 9) }), false);
  assert.equal(validateSpotcheckRequest({ ...registration, items: [items[0], ...items.slice(0, 9)] }), false);
  assert.equal(validateSpotcheckRequest({ ...registration, extra: true }), false);
  assert.equal(validateSpotcheckRequest(check), true);
  assert.equal(validateSpotcheckRequest({ ...check, ordinal: 0 }), true);
  assert.equal(validateSpotcheckRequest({ ...check, ordinal: 11 }), false);
});

test("registration is a user-scoped RPC and never contacts provider", async () => {
  const calls: string[] = [];
  const items = Array.from({ length: 10 }, (_, i) => ({ external_id: String(i + 1), source_version_id: source }));
  const response = await runCustomerSpotcheck({ action: "register", batchId, tenantId,
    reason: "Current source spot check", items }, {
    userRpc: async (name) => { calls.push(name); return { data: { state: "prepared", batch_id: batchId, count: 10 }, error: null }; },
    serviceRpc: async () => { throw Error("service credential must remain untouched"); },
    fetcher: async () => { throw Error("provider request not permitted"); },
  });
  assert.equal((response as { state: string }).state, "prepared");
  assert.deepEqual(calls, ["new_dawn_commusoft_customer_spotcheck_register"]);
});

test("scope must stay current before and after one exact GET", async () => {
  const calls: string[] = [];
  let current = 0;
  const raw = { id: 21, type: "customer", customerType: 2, companyName: "Fixture" };
  const result = await runCustomerSpotcheck(check, {
    userRpc: async () => ({ data: { state: "prepared", batch_id: batchId, ordinal: 1 }, error: null }),
    serviceRpc: async (name, args) => {
      calls.push(name);
      if (name.endsWith("_acquire")) return { data: { state: "ready", resource: "customer", batch_id: batchId,
        ordinal: 1, external_id: "21", source_version_id: source, region: "uk", api_key: "fixture-key" }, error: null };
      if (name.endsWith("_current")) { current++; return { data: true, error: null }; }
      if (name.endsWith("_finish")) {
        assert.equal(args.p_raw, JSON.stringify(raw));
        return { data: { state: "complete", batch_id: batchId, ordinal: 1,
          source_version_id: source, type_matches: true }, error: null };
      }
      throw Error(name);
    },
    fetcher: async (url, init) => {
      assert.equal(url, "https://app.commusoft.co.uk/api/v2/properties/21");
      assert.equal(init?.method, "GET");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fixture-key");
      return Response.json(raw);
    },
  });
  assert.equal((result as { state: string }).state, "complete");
  assert.equal(current, 2);
  assert.deepEqual(calls, ["new_dawn_commusoft_customer_spotcheck_acquire",
    "new_dawn_commusoft_customer_spotcheck_current",
    "new_dawn_commusoft_customer_spotcheck_current",
    "new_dawn_commusoft_customer_spotcheck_finish"]);
});

test("identity mismatch never reaches finish and records a bounded failure", async () => {
  const calls: string[] = [];
  await assert.rejects(runCustomerSpotcheck(check, {
    userRpc: async () => ({ data: { state: "prepared", batch_id: batchId, ordinal: 1 }, error: null }),
    serviceRpc: async (name) => {
      calls.push(name);
      if (name.endsWith("_acquire")) return { data: { state: "ready", resource: "customer", batch_id: batchId,
        ordinal: 1, external_id: "21", source_version_id: source, region: "uk", api_key: "fixture-key" }, error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      if (name.endsWith("_fail")) return { data: null, error: null };
      throw Error("finish must not be called");
    },
    fetcher: async () => Response.json({ id: 22, type: "customer", customerType: 2 }),
  }), /response_invalid/);
  assert.equal(calls.includes("new_dawn_commusoft_customer_spotcheck_finish"), false);
  assert.equal(calls.at(-1), "new_dawn_commusoft_customer_spotcheck_fail");
});

test("one separately invoked customer-type GET returns labels as evidence only", async () => {
  const req = { ...check, ordinal: 0 };
  const result = await runCustomerSpotcheck(req, {
    userRpc: async () => ({ data: { state: "prepared", batch_id: batchId, ordinal: 0 }, error: null }),
    serviceRpc: async (name, args) => {
      if (name.endsWith("_acquire")) return { data: { state: "ready", resource: "customer_types",
        batch_id: batchId, ordinal: 0, external_id: null, source_version_id: null,
        region: "uk", api_key: "fixture-key" }, error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      if (name.endsWith("_finish")) {
        assert.equal(args.p_raw, JSON.stringify([{ id: 2, name: "Company", companyNameRequired: "Yes" }]));
        return { data: { state: "complete", batch_id: batchId, ordinal: 0,
          resource: "customer_types", types: [{ id: "2", name: "Company" }] }, error: null };
      }
      throw Error(name);
    },
    fetcher: async (url, init) => {
      assert.equal(url, "https://app.commusoft.co.uk/api/v2/customerTypes");
      assert.equal(init?.method, "GET");
      return Response.json([{ id: 2, name: "Company", companyNameRequired: "Yes" }]);
    },
  });
  assert.equal((result as { resource: string }).resource, "customer_types");
});

test("denied customer-type endpoint records access_denied without reading a second resource", async () => {
  const names: string[] = [];
  await assert.rejects(runCustomerSpotcheck({ ...check, ordinal: 0 }, {
    userRpc: async () => ({ data: { state: "prepared", batch_id: batchId, ordinal: 0 }, error: null }),
    serviceRpc: async (name, args) => {
      names.push(name);
      if (name.endsWith("_acquire")) return { data: { state: "ready", resource: "customer_types",
        batch_id: batchId, ordinal: 0, external_id: null, source_version_id: null,
        region: "uk", api_key: "fixture-key" }, error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      if (name.endsWith("_fail")) {
        assert.equal(args.p_code, "access_denied"); return { data: null, error: null };
      }
      throw Error("unexpected service RPC");
    },
    fetcher: async () => new Response("Forbidden", { status: 403 }),
  }), /access_denied/);
  assert.equal(names.at(-1), "new_dawn_commusoft_customer_spotcheck_fail");
  assert.equal(names.includes("new_dawn_commusoft_customer_spotcheck_finish"), false);
});
