import assert from "node:assert/strict";
import test from "node:test";
import { runInvoiceCheck, validateInvoiceCheckRequest } from "./invoice_check.ts";
const tenantId = "00000000-0000-0000-0000-000000000001";
const connectionId = "00000000-0000-0000-0000-000000000002";
const requestId = "00000000-0000-0000-0000-000000000003";
const ids = ["00000000-0000-0000-0000-000000000004", "00000000-0000-0000-0000-000000000005"];
const request = { tenantId, connectionId, requestId, versionIds: ids, reason: "Bounded finance verification" };
test("rejects arbitrary or repeated invoice scope", () => {
  assert.equal(validateInvoiceCheckRequest({ ...request, versionIds: [ids[0]] }), false);
  assert.equal(validateInvoiceCheckRequest({ ...request, versionIds: [ids[0], ids[0]] }), false);
  assert.equal(validateInvoiceCheckRequest({ ...request, versionIds: [...ids, ids[0], ids[1]] }), false);
  assert.equal(validateInvoiceCheckRequest({ ...request, reason: "  " }), false);
  assert.equal(validateInvoiceCheckRequest({ ...request, invoiceId: "arbitrary" }), false);
  assert.equal(validateInvoiceCheckRequest(request), true);
});
test("denied operator never acquires credential or calls provider", async () => {
  let serviceCalls = 0, fetches = 0;
  await assert.rejects(runInvoiceCheck(request, {
    userRpc: async () => ({ data: null, error: { code: "42501" } }),
    serviceRpc: async () => { serviceCalls++; return { data: null, error: null }; },
    fetcher: async () => { fetches++; return new Response(); },
  }), /scope_denied/);
  assert.equal(serviceCalls, 0); assert.equal(fetches, 0);
});
test("reads only the two bound GET invoice URLs and passes raw decimal JSON to SQL", async () => {
  const calls: string[] = [], raws: string[] = [];
  const provider = (id: string) => `{"Invoice":{"Id":"${id}","Balance":12345678901234567890.01,"DueDate":"2026-10-19"}}`;
  const result = await runInvoiceCheck(request, {
    userRpc: async (name) => { calls.push(name); return { data: { requestId, state: "prepared" }, error: null }; },
    serviceRpc: async (name, args) => {
      calls.push(name);
      if (name.endsWith("_acquire")) return { data: { requestId, tenantId, connectionId, realmId: "123", environment: "production", accessToken: "secret", items: ids.map((versionId, i) => ({ versionId, invoiceId: String(i + 7) })) }, error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      if (name.endsWith("_finish")) { raws.push(...args.p_raw as string[]); return { data: { request_id: requestId, rows: [{}, {}] }, error: null }; }
      throw Error("unexpected RPC");
    },
    fetcher: async (url, init) => {
      assert.equal(init?.method, "GET");
      assert.equal(new URL(String(url)).origin, "https://quickbooks.api.intuit.com");
      assert.match(String(url), /^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/123\/invoice\/[78]$/);
      return new Response(provider(String(url).split("/").at(-1)!), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(result, { request_id: requestId, rows: [{}, {}] });
  assert.equal(raws.length, 2);
  assert.match(raws[0], /12345678901234567890\.01/);
  assert.equal(calls.filter(x => x.endsWith("_finish")).length, 1);
});
test("changed binding stops before first provider read", async () => {
  let fetches = 0;
  await assert.rejects(runInvoiceCheck(request, {
    userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
    serviceRpc: async (name) => name.endsWith("_acquire")
      ? { data: { requestId, tenantId, connectionId, realmId: "123", environment: "production", accessToken: "secret", items: ids.map((versionId, i) => ({ versionId, invoiceId: String(i + 7) })) }, error: null }
      : { data: false, error: null },
    fetcher: async () => { fetches++; return new Response(); },
  }), /scope_changed/);
  assert.equal(fetches, 0);
});
test("claim bound to another tenant or connection cannot reach provider", async () => {
  for (const changed of [{ tenantId: connectionId }, { connectionId: tenantId }]) {
    let fetches = 0;
    await assert.rejects(runInvoiceCheck(request, {
      userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
      serviceRpc: async () => ({ data: { requestId, tenantId, connectionId, ...changed, realmId: "123",
        environment: "production", accessToken: "secret", items: ids.map((versionId, i) => ({ versionId, invoiceId: String(i + 7) })) }, error: null }),
      fetcher: async () => { fetches++; return new Response(); },
    }), /claim_unavailable/);
    assert.equal(fetches, 0);
  }
});
test("failed provider read records one bounded failure and never calls finish", async () => {
  const rpcNames: string[] = [];
  await assert.rejects(runInvoiceCheck(request, {
    userRpc: async () => ({ data: { requestId, state: "prepared" }, error: null }),
    serviceRpc: async (name) => {
      rpcNames.push(name);
      if (name.endsWith("_acquire")) return { data: { requestId, tenantId, connectionId, realmId: "123", environment: "production", accessToken: "secret", items: ids.map((versionId, i) => ({ versionId, invoiceId: String(i + 7) })) }, error: null };
      if (name.endsWith("_current")) return { data: true, error: null };
      return { data: null, error: null };
    },
    fetcher: async () => new Response("", { status: 503 }),
  }), /provider_unavailable/);
  assert.equal(rpcNames.filter(x => x.endsWith("_fail")).length, 1);
  assert.equal(rpcNames.filter(x => x.endsWith("_finish")).length, 0);
});
