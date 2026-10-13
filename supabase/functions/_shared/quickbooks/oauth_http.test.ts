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
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("foreign.invalid"), false);
  assert.ok(text.includes("https://test.example.invalid/openfolk"));
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.ok(response.headers.get("Content-Security-Policy")?.includes("default-src 'none'"));
});
