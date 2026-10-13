import { test } from "node:test";
import assert from "node:assert/strict";
import { quickBooksDiagnosticFetch } from "./provider_trace.ts";
import type { QuickBooksProviderTrace } from "./provider_trace.ts";
import { requestQuickBooksTokens } from "./token_transport.ts";
import { readQuickBooksCompany } from "./company_info.ts";
import { readQuickBooksPage } from "./read_page.ts";
const tokenUrl = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const queryUrl =
  "https://sandbox-quickbooks.api.intuit.com/v3/company/123456789/query?query=SELECT%20private%20data";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tid = "4245c696-3710-1548-d1e0-d85918e22ebe";

test("response diagnostics preserve bodies and log only bounded support metadata", async () => {
  for (const status of [200, 400, 401, 403, 429, 500]) {
    const events: QuickBooksProviderTrace[] = [];
    const response = new Response("private financial payload", {
      status,
      headers: { Intuit_Tid: tid, "set-cookie": "private-cookie" },
    });
    let requests = 0;
    const request = { method: "GET", headers: { Authorization: "Bearer private-token" } };
    const f = quickBooksDiagnosticFetch(
      async (url, init) => {
        requests++;
        assert.equal(url, queryUrl);
        assert.equal(init, request);
        return response;
      },
      (event) => {
        events.push(event);
      },
    );
    assert.equal(await f(queryUrl, request), response);
    assert.equal(response.bodyUsed, false);
    assert.equal(await response.text(), "private financial payload");
    assert.equal(requests, 1);
    assert.equal(events.length, 1);
    assert.deepEqual(Object.keys(events[0]).sort(), [
      "environment",
      "event",
      "intuitTid",
      "observedAt",
      "operation",
      "outcome",
      "status",
    ]);
    assert.equal(events[0].intuitTid, tid);
    assert.equal(events[0].status, status);
    assert.equal(events[0].environment, "sandbox");
    assert.equal(events[0].operation, "query");
    assert.ok(Number.isFinite(Date.parse(events[0].observedAt)));
    for (const excluded of ["private", "123456789", "Authorization", "query="])
      assert.equal(JSON.stringify(events).includes(excluded), false);
  }
});
test("missing and malformed trace IDs cannot inject arbitrary log content", async () => {
  for (const value of [null, "has spaces", "<html>", "x".repeat(129), "comma,combined"]) {
    const events: QuickBooksProviderTrace[] = [];
    const headers = new Headers();
    if (value !== null) headers.set("intuit_tid", value);
    await quickBooksDiagnosticFetch(
      async () => new Response(null, { headers }),
      (e) => {
        events.push(e);
      },
    )(tokenUrl, { method: "POST" });
    assert.equal(events[0].intuitTid, null);
  }
  const events: QuickBooksProviderTrace[] = [];
  await quickBooksDiagnosticFetch(
    async () => new Response(null, { headers: { "intuit-tid": tid } }),
    (e) => {
      events.push(e);
    },
  )(tokenUrl, { method: "POST" });
  assert.equal(events[0].intuitTid, tid);
});
test("logging failure never changes the response or repeats a provider request", async () => {
  for (const sink of [
    () => {
      throw Error("logger failed");
    },
    () => Promise.reject(Error("logger failed")),
  ]) {
    let count = 0;
    const response = new Response(null);
    const f = quickBooksDiagnosticFetch(async () => {
      count++;
      return response;
    }, sink);
    assert.equal(await f(tokenUrl, { method: "POST" }), response);
    assert.equal(count, 1);
  }
});
test("network uncertainty emits no provider payload and is never retried", async () => {
  const events: QuickBooksProviderTrace[] = [];
  let count = 0;
  const f = quickBooksDiagnosticFetch(
    async () => {
      count++;
      throw Error("private token and URL");
    },
    (e) => {
      events.push(e);
    },
  );
  await assert.rejects(
    f(tokenUrl, { method: "POST" }),
    /^Error: quickbooks_transport_unconfirmed$/,
  );
  assert.equal(count, 1);
  assert.equal(events[0].outcome, "transport_unconfirmed");
  assert.equal(events[0].status, null);
  assert.equal(events[0].intuitTid, null);
  assert.equal(JSON.stringify(events).includes("private"), false);
});
test("only the existing fixed read, token and revoke endpoints reach the provider", async () => {
  let count = 0;
  const f = quickBooksDiagnosticFetch(
    async () => {
      count++;
      return new Response(null);
    },
    () => {},
  );
  for (const [url, method] of [
    ["https://other.example/query", "GET"],
    [queryUrl, "POST"],
    ["https://quickbooks.api.intuit.com/v3/company/123/invoice", "POST"],
    [tokenUrl + "?secret=private", "POST"],
    ["https://quickbooks.api.intuit.com/v3/company/123/companyinfo/456", "GET"],
  ])
    await assert.rejects(f(url, { method }), /quickbooks_transport_invalid/);
  assert.equal(count, 0);
  await f("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", { method: "POST" });
  await f(new Request("https://quickbooks.api.intuit.com/v3/company/123/companyinfo/123"));
  assert.equal(count, 2);
});
test("actual token, company and query transports retain traces without changing their results", async () => {
  const events: QuickBooksProviderTrace[] = [];
  const now = Date.now();
  const log = (e: QuickBooksProviderTrace) => {
    events.push(e);
  };
  const pair = await requestQuickBooksTokens(
    { clientId: "synthetic", clientSecret: "secret" },
    { kind: "refresh", refreshToken: "private-refresh" },
    {
      fetcher: quickBooksDiagnosticFetch(
        async () =>
          Response.json(
            {
              token_type: "bearer",
              access_token: "private-access",
              refresh_token: "private-refresh",
              expires_in: 3600,
              x_refresh_token_expires_in: 86400,
            },
            { headers: { intuit_tid: tid } },
          ),
        log,
      ),
    },
  );
  assert.equal(pair.accessToken, "private-access");
  const company = await readQuickBooksCompany(
    { environment: "sandbox", realmId: "123", accessToken: pair.accessToken, minorVersion: 75 },
    {
      stillAuthorized: async () => true,
      fetcher: quickBooksDiagnosticFetch(
        async () =>
          Response.json(
            { CompanyInfo: { Id: "1", CompanyName: "Private company" } },
            { headers: { intuit_tid: tid } },
          ),
        log,
      ),
    },
  );
  assert.equal(company.companyName, "Private company");
  const binding = {
    tenantId: id(1),
    connectionId: id(2),
    environment: "sandbox" as const,
    realmId: "123",
  };
  const page = await readQuickBooksPage(
    { ...binding, entity: "Invoice", startPosition: 1, pageSize: 20, minorVersion: 75 },
    { ...binding, accessToken: pair.accessToken, expiresAt: pair.accessExpiresAt },
    {
      stillAuthorized: async () => true,
      reserveRequest: async () => ({
        permitId: id(3),
        expiresAt: new Date(now + 60000).toISOString(),
      }),
      fetcher: quickBooksDiagnosticFetch(
        async () =>
          Response.json(
            { QueryResponse: {}, time: new Date().toISOString() },
            { headers: { intuit_tid: tid } },
          ),
        log,
      ),
    },
  );
  assert.equal(page.traversalExhausted, true);
  assert.deepEqual(
    events.map((e) => e.operation),
    ["token", "company_info", "query"],
  );
  assert.ok(events.every((e) => e.intuitTid === tid));
  assert.equal(JSON.stringify(events).includes("private"), false);
});
