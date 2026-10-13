import { test } from "node:test";
import assert from "node:assert/strict";
import { requestQuickBooksTokens, QuickBooksTokenError } from "./token_transport.ts";
const now = Date.parse("2026-10-13T15:00:00Z");
const client = { clientId: "synthetic-app", clientSecret: "synthetic-secret" };
const code = { kind: "code" as const, code: "synthetic-code", redirectUri: "https://test.example.invalid/callback" };
const response = { token_type: "bearer", access_token: "synthetic-access", refresh_token: "synthetic-new-refresh",
  expires_in: 3600, x_refresh_token_expires_in: 8640000, x_refresh_token_hard_expires_in: 31536000 };
const fail = (expected: string) => (error: unknown) => {
  assert.ok(error instanceof QuickBooksTokenError); assert.equal(error.code, expected);
  assert.equal(error.message, expected); assert.ok(!JSON.stringify(error).includes("synthetic-secret")); return true;
};
test("code exchange uses the official fixed endpoint, Basic auth and an exact form-encoded redirect", async () => {
  const pair = await requestQuickBooksTokens(client, code, { clock: () => now, fetcher: async (url, init) => {
    assert.equal(url, "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), `Basic ${btoa("synthetic-app:synthetic-secret")}`);
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "authorization_code"); assert.equal(body.get("redirect_uri"), code.redirectUri);
    assert.equal(body.has("client_secret"), false); return Response.json(response);
  } });
  assert.equal(pair.accessExpiresAt, new Date(now + 3600000).toISOString());
  assert.equal(pair.refreshToken, response.refresh_token);
  assert.equal(pair.refreshHardExpiresAt, new Date(now + 31536000000).toISOString());
});
test("refresh returns the replacement pair and supports optional hard expiry", async () => {
  const { x_refresh_token_hard_expires_in: _, ...withoutHardExpiry } = response;
  const pair = await requestQuickBooksTokens(client, { kind: "refresh", refreshToken: "synthetic-old-refresh" }, {
    clock: () => now, fetcher: async (_url, init) => {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("grant_type"), "refresh_token"); assert.equal(form.get("refresh_token"), "synthetic-old-refresh");
      assert.equal(form.has("code"), false); return Response.json(withoutHardExpiry);
    },
  });
  assert.equal(pair.refreshToken, "synthetic-new-refresh"); assert.equal(pair.refreshHardExpiresAt, null);
});
test("unsafe redirects, malformed grants and invalid app credentials cannot reach Intuit", async () => {
  let calls = 0; const fetcher = async () => { calls++; return Response.json(response); };
  for (const grant of [{ ...code, redirectUri: "http://invalid.test/callback" }, { ...code, code: "bad\ncode" },
    { kind: "refresh" as const, refreshToken: "" }])
    await assert.rejects(requestQuickBooksTokens(client, grant, { fetcher }), fail("invalid_request"));
  await assert.rejects(requestQuickBooksTokens({ ...client, clientId: "app:secret" }, code, { fetcher }), fail("invalid_request"));
  assert.equal(calls, 0);
});
test("failed and uncertain exchanges are sanitised and never automatically retried", async () => {
  for (const [status, expected] of [[400, "authentication_required"], [401, "authentication_required"],
    [429, "rate_limited"], [503, "outcome_unknown"], [403, "provider_rejected"]] as const) {
    let calls = 0;
    await assert.rejects(requestQuickBooksTokens(client, code, { fetcher: async () => {
      calls++; return new Response("synthetic-secret provider detail", { status });
    } }), fail(expected));
    assert.equal(calls, 1);
  }
  await assert.rejects(requestQuickBooksTokens(client, code, { fetcher: async () => { throw Error("synthetic-secret"); } }), fail("outcome_unknown"));
});
test("incomplete or oversized token responses cannot be persisted as a valid pair", async () => {
  for (const value of [{ ...response, refresh_token: undefined }, { ...response, expires_in: -1 },
    { ...response, token_type: "other" }, { ...response, x_refresh_token_hard_expires_in: "3600" },
    { ...response, error: "private" }, { ...response, padding: "x".repeat(65537) }])
    await assert.rejects(requestQuickBooksTokens(client, code, { clock: () => now, fetcher: async () => Response.json(value) }), fail("invalid_response"));
});
