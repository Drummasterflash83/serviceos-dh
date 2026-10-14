import test from "node:test";
import assert from "node:assert/strict";
import { disconnectQuickBooks } from "./disconnect.ts";
import { handleQuickBooksDisconnect } from "./disconnect_http.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = {
  tenantId: id(1),
  connectionId: id(2),
  requestId: id(3),
  revision: 1,
  reason: "Disconnect selected company",
};
const now = Date.parse("2026-10-13T18:00:00Z");
function fixture(
  options: {
    deny?: boolean;
    current?: boolean;
    status?: number;
    throwFetch?: boolean;
    loseFinish?: boolean;
    acquired?: string;
    badLease?: boolean;
  } = {},
) {
  let calls = 0;
  const methods: string[] = [];
  const serviceRpc = async (name: string, args: Record<string, unknown>) => {
    methods.push(name);
    assert.equal(args.p_request, id(3));
    if (name === "learn_quickbooks_disconnect_acquire")
      return {
        error: null,
        data: {
          state: options.acquired ?? "ready",
          requestId: id(3),
          leaseId: id(4),
          leaseUntil: new Date(now + (options.badLease ? -1 : 90000)).toISOString(),
          clientId: "synthetic-client",
          clientSecret: "synthetic-secret",
          refreshToken: "synthetic-refresh",
        },
      };
    assert.equal(args.p_lease, id(4));
    if (name === "learn_quickbooks_disconnect_current")
      return { error: null, data: options.current !== false };
    assert.equal(name, "learn_quickbooks_disconnect_finish");
    if (options.loseFinish) throw new Error("private backend text must not escape");
    return { error: null, data: { state: args.p_revoked ? "revoked" : "manual_review" } };
  };
  return {
    methods,
    calls: () => calls,
    ports: {
      clock: () => now,
      userRpc: async () => ({
        error: options.deny ? {} : null,
        data: { id: id(3), connectionId: id(2), localCaptureStopped: true, state: "queued" },
      }),
      serviceRpc,
      fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
        calls++;
        assert.equal(url, "https://developer.api.intuit.com/v2/oauth2/tokens/revoke");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        assert.deepEqual(JSON.parse(String(init?.body)), { token: "synthetic-refresh" });
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          `Basic ${btoa("synthetic-client:synthetic-secret")}`,
        );
        if (options.throwFetch) throw new Error("secret provider payload");
        return new Response(null, { status: options.status ?? 200 });
      }) as typeof fetch,
    },
  };
}
test("disconnect binds a user request, checks authority and sends exactly one revoke", async () => {
  const f = fixture();
  assert.equal((await disconnectQuickBooks(input, f.ports)).state, "revoked");
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.methods, [
    "learn_quickbooks_disconnect_acquire",
    "learn_quickbooks_disconnect_current",
    "learn_quickbooks_disconnect_finish",
  ]);
});
test("denied authority and invalid leases never send provider requests", async () => {
  const denied = fixture({ deny: true });
  await assert.rejects(disconnectQuickBooks(input, denied.ports), /disconnect_not_confirmed/);
  assert.equal(denied.methods.length, 0);
  for (const options of [{ current: false }, { badLease: true }]) {
    const f = fixture(options);
    assert.equal((await disconnectQuickBooks(input, f.ports)).state, "manual_review");
    assert.equal(f.calls(), 0);
  }
});
test("uncertain and rejected revokes retain local stop and are not retried", async () => {
  for (const options of [
    { throwFetch: true },
    { status: 401 },
    { status: 429 },
    { status: 500 },
    { status: 204 },
  ]) {
    const f = fixture(options),
      result = await disconnectQuickBooks(input, f.ports);
    assert.equal(result.state, "manual_review");
    assert.equal(result.localCaptureStopped, true);
    assert.equal(f.calls(), 1);
    assert.ok(!JSON.stringify(result).includes("synthetic"));
  }
});
test("lost finish reply requests status without repeating revocation", async () => {
  const f = fixture({ loseFinish: true });
  assert.equal((await disconnectQuickBooks(input, f.ports)).state, "check_status");
  assert.equal(f.calls(), 1);
  for (const state of ["revoking", "revoked", "manual_review", "reviewed"]) {
    const f = fixture({ acquired: state });
    assert.equal((await disconnectQuickBooks(input, f.ports)).state, state);
    assert.equal(f.calls(), 0);
  }
});
test("disconnect HTTP rejects foreign origins, unsigned calls and malformed bodies", async () => {
  const f = fixture();
  const ports = {
    ...f.ports,
    siteOrigin: "https://test.openfolk.ai",
    minorVersion: 75,
    userRpc: async () => f.ports.userRpc,
  };
  for (const [headers, body, status] of [
    [{ origin: "https://evil.invalid" }, input, 403],
    [{}, input, 401],
    [
      { authorization: `Bearer ${"a".repeat(30)}`, "content-type": "application/json" },
      { ...input, extra: true },
      400,
    ],
  ] as const) {
    const response = await handleQuickBooksDisconnect(
      new Request("https://example.invalid/disconnect", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
      ports,
    );
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(f.calls(), 0);
});
