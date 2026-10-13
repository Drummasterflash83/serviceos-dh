import { test } from "node:test";
import assert from "node:assert/strict";
import { newQuickBooksAuthorization, quickBooksAuthorizationUrl, validateQuickBooksCallback,
  QuickBooksAuthorizationError } from "./oauth_contract.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-13T14:00:00Z");
const input = { tenantId: id(1), connectionId: id(2), actorId: id(3), app: {
  registrationId: id(4), clientId: "synthetic-app", environment: "sandbox" as const,
  redirectUri: "https://test.example.invalid/functions/v1/quickbooks-oauth-callback",
} };
const pending = () => newQuickBooksAuthorization(input, now);
const callback = (p = pending()) => `${p.app.redirectUri}?${new URLSearchParams({ code: "synthetic-code", realmId: "12345678901234567890", state: p.state })}`;
const fail = (error: unknown) => {
  assert.ok(error instanceof QuickBooksAuthorizationError);
  assert.equal(error.message, "authorization_invalid"); return true;
};
test("authorization uses independent random state, exact app callback and Accounting scope only", () => {
  const a = pending(), b = pending();
  assert.notEqual(a.state, b.state); assert.equal(a.state.length, 43);
  const url = new URL(quickBooksAuthorizationUrl(a, now));
  assert.equal(url.origin, "https://appcenter.intuit.com");
  assert.equal(url.searchParams.get("scope"), "com.intuit.quickbooks.accounting");
  assert.equal(url.searchParams.get("redirect_uri"), input.app.redirectUri);
  assert.equal(url.searchParams.has("client_secret"), false);
  assert.deepEqual(validateQuickBooksCallback(callback(a), a, input.app, now), {
    code: "synthetic-code", realmId: "12345678901234567890",
  });
});
test("a changed app registration, environment or callback requires a fresh authorization", () => {
  const p = pending();
  for (const change of [{ registrationId: id(8) }, { clientId: "other-app" },
    { environment: "production" as const }, { redirectUri: "https://live.example.invalid/callback" }])
    assert.throws(() => validateQuickBooksCallback(callback(p), p, { ...input.app, ...change }, now), fail);
});
test("replayed, expired, future or excessive-duration states fail", () => {
  for (const change of [{ usedAt: new Date(now).toISOString() },
    { expiresAt: new Date(now).toISOString() }, { createdAt: new Date(now + 1).toISOString() },
    { expiresAt: new Date(now + 600001).toISOString() }, { state: "short" }, { tenantId: "other" }]) {
    const p = { ...pending(), ...change };
    assert.throws(() => validateQuickBooksCallback(callback(p), p, input.app, now), fail);
  }
});
test("callback injection, duplicate query parameters and OAuth denial reveal no sensitive error details", () => {
  const p = pending(), good = callback(p);
  for (const bad of [good + "&state=other", good + "&code=extra", good + "&realmId=2",
    good + "&error=access_denied&error_description=private", good + "#fragment",
    good.replace("test.example.invalid", "attacker.invalid"), good.replace(p.state, "wrong"),
    good.replace("12345678901234567890", "1%2Fescape"), good.replace("synthetic-code", "%0Asecret")])
    assert.throws(() => validateQuickBooksCallback(bad, p, input.app, now), fail);
});
test("only canonical HTTPS server callback URLs can be configured", () => {
  for (const redirectUri of ["http://test.example.invalid/callback", "https://user:pass@test.example.invalid/callback",
    "https://test.example.invalid/callback?next=evil", "https://test.example.invalid/callback#x", "https://test.example.invalid/"])
    assert.throws(() => newQuickBooksAuthorization({ ...input, app: { ...input.app, redirectUri } }, now), fail);
});
