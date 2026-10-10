import { test } from "node:test";
import assert from "node:assert/strict";
import { readCommusoftPage, CommusoftReadError } from "./read_page.ts";
import type { CommusoftReadRequest } from "./read_page.ts";

const request: CommusoftReadRequest = {
  region: "uk",
  resource: "properties",
  after: null,
  limit: 2,
};
const key = "synthetic-private-app-fixture";
const now = Date.parse("2026-10-10T12:00:00Z");
const envelope = (
  data: unknown[] = [{ id: 1 }, { id: 2 }],
  hasMore = true,
  nextCursor: unknown = 2,
) => ({
  meta: { serverTime: "2026-10-10T12:00:00Z" },
  data,
  pagination: { hasMore, nextCursor, prevCursor: 1 },
});
function fixture(body: unknown = envelope(), status = 200, headers: Record<string, string> = {}) {
  let checks = 0;
  const calls: { url: string; options: RequestInit }[] = [];
  const ports = {
    stillAuthorized: async () => {
      checks++;
      return true;
    },
    clock: () => now,
    fetcher: (async (url: string | URL | Request, options: RequestInit) => {
      calls.push({ url: String(url), options });
      return Response.json(body, { status, headers });
    }) as typeof fetch,
  };
  return {
    ports,
    calls,
    checks: () => checks,
    run: (r = request) => readCommusoftPage(r, key, ports),
  };
}
const errorCode = (code: string) => (error: unknown) => {
  assert.ok(error instanceof CommusoftReadError);
  assert.equal(error.message, code);
  assert.equal(error.code, code);
  assert.equal(JSON.stringify(error).includes(key), false);
  return true;
};

test("GET binds UK endpoint and private-app header; retains unknown fields without following links", async () => {
  const raw = envelope(
    [{ id: 1, links: { self: "https://untrusted.example" }, extra: { retained: true } }],
    false,
    1,
  );
  const f = fixture(raw),
    page = await f.run();
  assert.deepEqual(page.rawEnvelope, raw);
  assert.equal(page.nextCursor, null);
  assert.equal(page.collectionExhausted, true);
  assert.equal(f.checks(), 2);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://app.commusoft.co.uk/api/v2/properties?limit=2");
  assert.equal(f.calls[0].options.method, "GET");
  assert.equal(f.calls[0].options.redirect, "error");
  assert.equal(f.calls[0].options.credentials, "omit");
  assert.deepEqual(f.calls[0].options.headers, { "x-api-key": key, Accept: "application/json" });
});

test("US contacts require explicit property type; provider cursor continues without inferred offsets", async () => {
  const f = fixture(envelope([{ id: 50 }, { id: 88 }], true, 88));
  const page = await f.run({
    region: "us",
    resource: "propertyContacts",
    contactType: "workaddress",
    after: 30,
    limit: 2,
  });
  assert.equal(page.nextCursor, 88);
  assert.equal(
    f.calls[0].url,
    "https://app.commusoft.us/api/v2/propertyContacts?limit=2&after=30&type=workaddress",
  );
  assert.equal(page.collectionExhausted, false);
});

test("jobs use the required API version from the published endpoint schema", async () => {
  const f = fixture();
  await f.run({ ...request, resource: "jobs" });
  assert.equal(new Headers(f.calls[0].options.headers).get("x-api-version"), "2.1");
});

test("invalid resource, region, bounds, contact scope or header rejected before traffic", async () => {
  for (const change of [
    { resource: "../jobs" },
    { region: "toString" },
    { limit: 0 },
    { limit: 101 },
    { after: -1 },
    { after: Number.MAX_SAFE_INTEGER + 1 },
    { resource: "propertyContacts" },
    { contactType: "supplier" },
  ]) {
    const f = fixture();
    await assert.rejects(
      f.run({ ...request, ...change } as CommusoftReadRequest),
      errorCode("invalid_request"),
    );
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  await assert.rejects(
    readCommusoftPage(request, "key\r\nx-other: secret", f.ports),
    errorCode("invalid_request"),
  );
  assert.equal(f.calls.length, 0);
});

test("rejects malformed, oversized, repeated, backwards and imprecise pages", async () => {
  const cases = [
    {},
    envelope([], true, 2),
    envelope([{ id: 1 }], true, 4),
    envelope([{ id: 2 }, { id: 1 }]),
    envelope([{ id: 1 }, { id: 1 }]),
    envelope([{ id: "1" }]),
    envelope([{ id: Number.MAX_SAFE_INTEGER + 1 }]),
    envelope([{ id: 1 }, { id: 2 }, { id: 3 }], true, 3),
    envelope([{ id: 1, text: "a".repeat(262144) }], false, 1),
    envelope([{ id: 1 }], false, 90),
    envelope([{ id: 1 }], "false" as any, 1),
  ];
  for (const body of cases)
    await assert.rejects(fixture(body).run(), errorCode("invalid_response"));
  await assert.rejects(
    fixture(envelope([{ id: 2 }], false, 2)).run({ ...request, after: 2 }),
    errorCode("invalid_response"),
  );
});

test("empty terminal page supported without claiming provider-wide completeness", async () => {
  const page = await fixture(envelope([], false, null)).run();
  assert.deepEqual(page.records, []);
  assert.equal(page.collectionExhausted, true);
  assert.equal(page.nextCursor, null);
  assert.equal("complete" in page, false);
});

test("HTTP errors redact provider content, classify operator action, and never retry", async () => {
  for (const [status, code] of [
    [401, "authentication_required"],
    [403, "access_denied"],
    [400, "provider_rejected"],
    [302, "provider_rejected"],
    [503, "provider_unavailable"],
  ] as const) {
    const f = fixture({ error: `private ${key}` }, status);
    await assert.rejects(f.run(), errorCode(code));
    assert.equal(f.calls.length, 1);
  }
});

test("429 respects provider reset, Retry-After, and conservative fallback", async () => {
  for (const [headers, expected] of [
    [{ "X-RateLimit-Reset": String(now / 1000 + 120) }, now + 120000],
    [{ "Retry-After": "180" }, now + 180000],
    [{ "Retry-After": new Date(now + 240000).toUTCString() }, now + 240000],
    [{ "X-RateLimit-Reset": "garbage", "Retry-After": "-5" }, now + 60000],
    [{ "X-RateLimit-Reset": "1" }, now + 60000],
  ] as [Record<string, string>, number][]) {
    const f = fixture({ error: key }, 429, headers);
    await assert.rejects(f.run(), (error: unknown) => {
      errorCode("rate_limited")(error);
      assert.equal((error as CommusoftReadError).retryAt, expected);
      return true;
    });
    assert.equal(f.calls.length, 1);
  }
});

test("successful response with exhausted quota delays the following request", async () => {
  const page = await fixture(envelope(), 200, {
    "X-RateLimit-Remaining": "0",
    "X-RateLimit-Reset": String(now / 1000 + 90),
  }).run();
  assert.equal(page.quota.retryAt, now + 90000);
});

test("authority denied before request or revoked while reading never returns source data", async () => {
  const f = fixture();
  f.ports.stillAuthorized = async () => false;
  await assert.rejects(f.run(), errorCode("authority_unavailable"));
  assert.equal(f.calls.length, 0);
  let checks = 0;
  f.ports.stillAuthorized = async () => ++checks === 1;
  await assert.rejects(f.run(), errorCode("authority_unavailable"));
  assert.equal(f.calls.length, 1);
  f.ports.stillAuthorized = async () => {
    throw Error(key);
  };
  await assert.rejects(f.run(), errorCode("authority_unavailable"));
});

test("caller mutation during authority check cannot change validated resource or cursor", async () => {
  const f = fixture(),
    mutable = { ...request };
  f.ports.stillAuthorized = async () => {
    mutable.after = 50;
    mutable.resource = "jobs";
    return true;
  };
  const page = await f.run(mutable);
  assert.equal(page.nextCursor, 2);
  assert.ok(f.calls[0].url.includes("/properties?"));
});

test("response body bounded by actual stream bytes, regardless of Content-Length", async () => {
  let cancelled = false;
  const f = fixture();
  f.ports.fetcher = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json", "content-length": "2" } },
    )) as typeof fetch;
  await assert.rejects(f.run(), errorCode("response_too_large"));
  assert.equal(cancelled, true);
});

test("HTML, invalid UTF-8, malformed JSON and network errors never leak raw content", async () => {
  for (const response of [
    new Response(key),
    new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }),
    new Response(`{${key}`, { headers: { "content-type": "application/json" } }),
  ]) {
    const f = fixture();
    f.ports.fetcher = (async () => response) as typeof fetch;
    await assert.rejects(f.run(), errorCode("invalid_response"));
  }
  const f = fixture();
  f.ports.fetcher = async () => {
    throw Error(key);
  };
  await assert.rejects(f.run(), errorCode("transport_unavailable"));
});

test("deadline cancels a stalled body and external cancellation prevents requests", async () => {
  let cancelled = false;
  const f = fixture();
  f.ports.fetcher = (async () =>
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    )) as typeof fetch;
  await assert.rejects(
    readCommusoftPage(request, key, { ...f.ports, timeoutMs: 10 }),
    errorCode("transport_unavailable"),
  );
  assert.equal(cancelled, true);
  const g = fixture(),
    abort = new AbortController();
  abort.abort();
  await assert.rejects(
    readCommusoftPage(request, key, { ...g.ports, signal: abort.signal }),
    errorCode("transport_unavailable"),
  );
  assert.equal(g.calls.length, 0);
});

test("unavailable authority read cannot hold the connector past its deadline", async () => {
  const f = fixture();
  f.ports.stillAuthorized = () => new Promise<boolean>(() => {});
  await assert.rejects(
    readCommusoftPage(request, key, { ...f.ports, timeoutMs: 10 }),
    errorCode("transport_unavailable"),
  );
  assert.equal(f.calls.length, 0);
});

test("delayed authority reads cannot use an expired quota reservation", async () => {
  const f = fixture();
  let time = now;
  f.ports.stillAuthorized = async () => {
    time += 6000;
    return true;
  };
  await assert.rejects(
    readCommusoftPage(request, key, { ...f.ports, clock: () => time, sendBefore: now + 5000 }),
    errorCode("authority_unavailable"),
  );
  assert.equal(f.calls.length, 0);
});

test("send deadline does not discard a response solely because the provider took longer", async () => {
  const f = fixture();
  let time = now;
  const fetcher = f.ports.fetcher;
  f.ports.fetcher = async (...args) => {
    time += 6000;
    return fetcher(...args);
  };
  const page = await readCommusoftPage(request, key, {
    ...f.ports,
    clock: () => time,
    sendBefore: now + 5000,
  });
  assert.equal(page.records.length, 2);
});
