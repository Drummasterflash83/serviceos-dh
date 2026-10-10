import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCommusoftConnection } from "./verify_connection.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-10T12:00:00Z");
const apiKey = "SYNTHETIC_VERIFICATION_KEY";
const sourceText = "SYNTHETIC_PRIVATE_CUSTOMER";
function fixture() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const network: { url: string; init: RequestInit }[] = [];
  let authorityReads = 0;
  const state = {
    acquisition: {
      state: "ready",
      apiKey,
      permitId: id(3),
      region: "uk",
      sendBefore: now + 5000,
    } as unknown,
    acquireError: false,
    finishError: false,
    authority: [true, true],
    status: 200,
    body: {
      data: [{ id: 123, privateText: sourceText }],
      pagination: { hasMore: true, nextCursor: 123 },
    } as unknown,
    headers: {} as Record<string, string>,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "learn_commusoft_verify_acquire")
        return { data: state.acquisition, error: state.acquireError };
      if (name === "learn_commusoft_verify_authorized")
        return { data: state.authority[authorityReads++], error: null };
      if (name === "learn_commusoft_verify_finish")
        return {
          data: {
            tenant_id: id(1),
            request_id: id(2),
            state: "recorded",
            code: args.p_code,
            unexpected: apiKey,
          },
          error: state.finishError ? { message: apiKey } : null,
        };
      throw Error("Unexpected RPC");
    },
    fetcher: (async (url: URL | RequestInfo, init: RequestInit) => {
      network.push({ url: String(url), init });
      return Response.json(state.body, { status: state.status, headers: state.headers });
    }) as typeof fetch,
  };
  return {
    state,
    calls,
    network,
    run: () => verifyCommusoftConnection(id(1), id(2), { ...state, clock: () => now }),
  };
}

test("one bounded GET verifies access; source records and secrets never leave execution", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { state: "finished" });
  assert.equal(f.network.length, 1);
  assert.equal(f.network[0].url, "https://app.commusoft.co.uk/api/v2/properties?limit=1");
  assert.equal(f.network[0].init.method, "GET");
  assert.equal(f.network[0].init.redirect, "error");
  assert.equal(
    (f.network[0].init.headers as Record<string, string>)["Authorization"],
    `Bearer ${apiKey}`,
  );
  assert.deepEqual(
    f.calls.map((c) => c.name),
    [
      "learn_commusoft_verify_acquire",
      "learn_commusoft_verify_authorized",
      "learn_commusoft_verify_authorized",
      "learn_commusoft_verify_finish",
    ],
  );
  assert.equal(f.calls.at(-1)?.args.p_code, "access_verified");
  assert.ok(!JSON.stringify(f.calls).includes(sourceText));
  assert.ok(!JSON.stringify(f.calls).includes(apiKey));
});
test("shared quota wait and unavailable acquisition cause no provider request", async () => {
  for (const acquisition of [
    null,
    {},
    { state: "ready", apiKey },
    { state: "wait", retryAt: now - 1 },
  ]) {
    const f = fixture();
    f.state.acquisition = acquisition;
    assert.deepEqual(await f.run(), { state: "unconfirmed" });
    assert.equal(f.network.length, 0);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  f.state.acquisition = { state: "wait", retryAt: now + 60000 };
  assert.deepEqual(await f.run(), { state: "waiting", retryAt: now + 60000 });
  assert.equal(f.network.length, 0);
  assert.equal(f.calls.length, 1);
});
test("invalid scope, expired send permit and revoked authority cannot contact provider", async () => {
  const invalid = fixture();
  assert.deepEqual(await verifyCommusoftConnection("wrong", id(2), invalid.state), {
    state: "unconfirmed",
  });
  assert.equal(invalid.calls.length, 0);
  for (const revoke of [false, true]) {
    const f = fixture();
    if (revoke) f.state.authority = [false];
    else (f.state.acquisition as any).sendBefore = now;
    await f.run();
    assert.equal(f.network.length, 0);
    assert.equal(f.calls.at(-1)?.args.p_code, "authority_unavailable");
  }
});
test("provider authentication, permissions, malformed data and throttling never become success", async () => {
  for (const [status, code] of [
    [401, "authentication_required"],
    [403, "access_denied"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
  ] as const) {
    const f = fixture();
    f.state.status = status;
    f.state.body = { message: apiKey };
    f.state.headers = { "retry-after": "120" };
    assert.deepEqual(await f.run(), { state: "finished" });
    assert.equal(f.calls.at(-1)?.args.p_code, code);
    assert.equal(
      f.calls.at(-1)?.args.p_retry_at,
      status === 429 ? new Date(now + 120000).toISOString() : null,
    );
    assert.equal(f.network.length, 1);
    assert.ok(!JSON.stringify(f.calls).includes(apiKey));
  }
  const f = fixture();
  f.state.body = { data: [{ id: 1 }, { id: 2 }], pagination: { hasMore: false } };
  await f.run();
  assert.equal(f.calls.at(-1)?.args.p_code, "invalid_response");
});
test("revocation during read discards source; success can extend exhausted shared quota", async () => {
  const revoked = fixture();
  revoked.state.authority = [true, false];
  await revoked.run();
  assert.equal(revoked.calls.at(-1)?.args.p_code, "authority_unavailable");
  const exhausted = fixture();
  exhausted.state.headers = { "x-ratelimit-remaining": "0", "retry-after": "120" };
  await exhausted.run();
  assert.equal(exhausted.calls.at(-1)?.args.p_retry_at, new Date(now + 120000).toISOString());
});
test("lost acquisition/finalization replies and thrown errors are unconfirmed, without automatic retries", async () => {
  const acquire = fixture();
  acquire.state.acquireError = true;
  assert.deepEqual(await acquire.run(), { state: "unconfirmed" });
  assert.equal(acquire.network.length, 0);
  const finish = fixture();
  finish.state.finishError = true;
  assert.deepEqual(await finish.run(), { state: "unconfirmed" });
  assert.equal(finish.network.length, 1);
  assert.equal(finish.calls.filter((c) => c.name === "learn_commusoft_verify_finish").length, 1);
  const throws = fixture();
  throws.state.rpc = async () => {
    throw Error(apiKey);
  };
  assert.deepEqual(await throws.run(), { state: "unconfirmed" });
});
