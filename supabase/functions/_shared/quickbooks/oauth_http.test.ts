import { test } from "node:test";
import assert from "node:assert/strict";
import { handleQuickBooksStart, handleQuickBooksCallback } from "./oauth_http.ts";
const ports = {
  siteOrigin: "https://test.example.invalid",
  minorVersion: 75,
  userRpc: async () => null,
  serviceRpc: async () => ({ data: null, error: null }),
};
test("start rejects anonymous, foreign origin, wrong methods and invalid origin configuration before RPC", async () => {
  let auth = 0;
  for (const [req, status] of [
    [new Request("https://example.invalid/start", { method: "POST" }), 401],
    [
      new Request("https://example.invalid/start", {
        method: "POST",
        headers: { origin: "https://foreign.invalid" },
      }),
      403,
    ],
    [new Request("https://example.invalid/start"), 405],
  ] as const) {
    assert.equal(
      (
        await handleQuickBooksStart(req, {
          ...ports,
          userRpc: async () => {
            auth++;
            return null;
          },
        })
      ).status,
      status,
    );
  }
  assert.equal(auth, 0);
  assert.equal(
    (
      await handleQuickBooksStart(new Request("https://example.invalid/start"), {
        ...ports,
        siteOrigin: "https://test.example.invalid/path",
      })
    ).status,
    503,
  );
});
test("start denies invalid sessions and rejects oversized JSON without database work", async () => {
  const headers = { Authorization: "Bearer " + "a".repeat(30), "content-type": "application/json" };
  const invalid = await handleQuickBooksStart(
    new Request("https://example.invalid/start", { method: "POST", headers, body: "{}" }),
    ports,
  );
  assert.equal(invalid.status, 401);
  let calls = 0;
  const large = await handleQuickBooksStart(
    new Request("https://example.invalid/start", {
      method: "POST",
      headers,
      body: JSON.stringify({ reason: "x".repeat(9000) }),
    }),
    {
      ...ports,
      userRpc: async () => async () => {
        calls++;
        return { data: null, error: null };
      },
    },
  );
  assert.equal(large.status, 400);
  assert.equal(calls, 0);
});
test("callback never reflects OAuth errors, codes, state or unsafe return destinations", async () => {
  const response = await handleQuickBooksCallback(
    new Request(
      "https://example.invalid/callback?error=access_denied&code=private&state=private&return=https://foreign.invalid",
    ),
    ports,
  );
  assert.equal(response.status, 303);
  const text = await response.text();
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("foreign.invalid"), false);
  assert.equal(text, "");
  assert.equal(response.headers.get("Location"), "https://test.example.invalid/quickbooks?mode=connect&result=needs_check#");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("saved callback returns a clean frontend redirect only after persistence", async () => {
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const now = Date.now(), realm = "9130357990011111";
  const app = { registrationId:id(4), clientId:"synthetic-client", environment:"sandbox", redirectUri:"https://example.invalid/callback" };
  let saved = false;
  const response = await handleQuickBooksCallback(new Request(`${app.redirectUri}?state=${"a".repeat(43)}&code=synthetic-code&realmId=${realm}`), {
    ...ports,
    serviceRpc: async (name) => {
      if(name === "learn_quickbooks_claim") return {error:null,data:{requestId:id(5),claimId:id(6),claimUntil:new Date(now+120000).toISOString(),tenantId:id(1),connectionId:id(2),actorId:id(3),expectedRealmId:null,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+599000).toISOString(),clientSecret:"synthetic-secret",app}};
      if(name === "learn_quickbooks_claim_current") return {error:null,data:true};
      assert.equal(name,"learn_quickbooks_finish");saved=true;
      return {error:null,data:{state:"saved",connectionId:id(2)}};
    },
    fetcher: async (_url, options) => options?.method === "POST"
      ? Response.json({token_type:"bearer",access_token:"synthetic-access",refresh_token:"synthetic-refresh",expires_in:3600,x_refresh_token_expires_in:8640000})
      : Response.json({CompanyInfo:{Id:"1",CompanyName:"Synthetic Company"}}),
  });
  assert.equal(saved,true);
  assert.equal(response.status,303);
  assert.equal(response.headers.get("Location"),"https://test.example.invalid/quickbooks?mode=connect&result=review#");
  assert.equal(await response.text(),"");
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  assert.equal(response.headers.get("Referrer-Policy"),"no-referrer");
});
