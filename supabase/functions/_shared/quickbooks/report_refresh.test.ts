import assert from "node:assert/strict";
import { test } from "node:test";
import { runReportRefresh, validReportRefreshRequest } from "./report_refresh.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = { tenantId: id(1), connectionId: id(2), requestId: id(3),
  realmId: "123456", environment: "production" as const, reason: "Dated report evidence" };
const authorized = { requestId: request.requestId, tenantId: request.tenantId,
  connectionId: request.connectionId, realmId: request.realmId, environment: request.environment };
test("refresh request binds one company and rejects extra scope", () => {
  assert.equal(validReportRefreshRequest(request), true);
  for (const candidate of [{ ...request, tenantId: id(9), extra: true },
    { ...request, realmId: "0" }, { ...request, reason: "no" },
    { ...request, environment: "other" }]) assert.equal(validReportRefreshRequest(candidate), false);
});
test("denied or mismatched operator authorization never reaches the service refresh", async () => {
  for (const data of [null, { ...authorized, connectionId: id(9) }, { ...authorized, realmId: "987" }]) {
    let serviceCalls = 0;
    await assert.rejects(runReportRefresh(request, {
      userRpc: async (name, args) => {
        assert.equal(name, "learn_quickbooks_report_refresh_authorize");
        assert.equal(args.p_reason, request.reason); return { error: null, data };
      },
      serviceRpc: async () => { serviceCalls++; return { error: null, data: null }; },
    }), /scope_denied/);
    assert.equal(serviceCalls, 0);
  }
});
test("an authorized request refreshes one saved token pair and returns only state", async () => {
  const now = Date.parse("2026-10-19T21:00:00Z");
  let acquired = 0, finished = 0, providerCalls = 0;
  const result = await runReportRefresh(request, {
    clock: () => now,
    userRpc: async () => ({ error: null, data: authorized }),
    serviceRpc: async (name, args) => {
      if (name === "learn_quickbooks_refresh_acquire") {
        acquired++; assert.deepEqual(args, { p_tenant: request.tenantId, p_connection: request.connectionId });
        return { error: null, data: { state: "ready", leaseId: id(4),
          leaseUntil: new Date(now + 100000).toISOString(), revision: 4, generation: 2,
          clientId: "synthetic-client", clientSecret: "synthetic-secret", refreshToken: "synthetic-refresh" } };
      }
      assert.equal(name, "learn_quickbooks_refresh_finish"); finished++;
      assert.equal(args.p_generation, 2); assert.equal(args.p_revision, 4);
      assert.equal((args.p_pair as Record<string, unknown>).accessToken, "synthetic-access");
      return { error: null, data: null };
    },
    fetcher: async (input, init) => {
      providerCalls++; assert.equal(String(input), "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
      assert.equal(init?.method, "POST");
      return Response.json({ token_type: "bearer", access_token: "synthetic-access",
        refresh_token: "synthetic-new-refresh", expires_in: 3600,
        x_refresh_token_expires_in: 8640000 });
    },
  });
  assert.deepEqual(result, { version: "quickbooks-report-refresh/1", requestId: request.requestId, state: "refreshed" });
  assert.equal(JSON.stringify(result).includes("synthetic"), false);
  assert.equal(acquired, 1); assert.equal(finished, 1); assert.equal(providerCalls, 1);
});
test("busy refresh lease does not call the provider", async () => {
  let called = false;
  const result = await runReportRefresh(request, {
    userRpc: async () => ({ error: null, data: authorized }),
    serviceRpc: async () => ({ error: null, data: { state: "busy" } }),
    fetcher: async () => { called = true; throw Error("unexpected"); },
  });
  assert.equal(result.state, "busy"); assert.equal(called, false);
});
