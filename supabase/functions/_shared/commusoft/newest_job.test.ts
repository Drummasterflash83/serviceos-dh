import { test } from "node:test";
import assert from "node:assert/strict";
import { readNewestCommusoftJobPage } from "./newest_job.ts";

const now = Date.parse("2026-10-20T08:00:00Z");
const body = {
  meta: { serverTime: "2026-10-20 08:00:01" },
  pagination: { hasMore: true, nextCursor: 13433, prevCursor: 13434 },
  data: [
    { id: 13434, createdOnDateTime: "2026-10-20T07:59:00Z", description: "private" },
    { id: 13433, createdOnDateTime: "2026-10-19T14:00:00Z" },
  ],
};
function ports(response = body) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let checks = 0;
  return {
    calls,
    checks: () => checks,
    options: {
      clock: () => now,
      sendBefore: now + 5000,
      stillAuthorized: async () => { checks++; return true; },
      fetcher: (async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return Response.json(response);
      }) as typeof fetch,
    },
  };
}

test("reads newest-created Jobs and returns only IDs and creation times", async () => {
  const f = ports();
  const result = await readNewestCommusoftJobPage("uk", "synthetic-private-app-key", null, f.options);
  assert.deepEqual(result, {
    rows: [
      { id: "13434", createdAt: "2026-10-20T07:59:00Z" },
      { id: "13433", createdAt: "2026-10-19T14:00:00Z" },
    ],
    nextCursor: 13433, hasMore: true,
    providerServerTime: "2026-10-20T08:00:01Z",
  });
  assert.equal(f.calls.length, 1);
  assert.equal(new URL(f.calls[0].url).searchParams.get("sort"), "-createdOnDateTime");
  assert.equal(new URL(f.calls[0].url).searchParams.get("limit"), "100");
  assert.equal(f.checks(), 2);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("holds reversed provider order and never requests after lost authority", async () => {
  const reversed = ports({ ...body, data: [...body.data].reverse() });
  await assert.rejects(readNewestCommusoftJobPage("uk", "synthetic-private-app-key", null, reversed.options),
    { code: "invalid_response" });
  const denied = ports();
  denied.options.stillAuthorized = async () => false;
  await assert.rejects(readNewestCommusoftJobPage("uk", "synthetic-private-app-key", null, denied.options),
    { code: "authority_unavailable" });
  assert.equal(denied.calls.length, 0);
});

test("does not call an empty or future-dated page a newest job", async () => {
  for (const response of [
    { ...body, data: [] },
    { ...body, data: [{ id: 13435, createdOnDateTime: "2026-10-21T08:00:00Z" }] },
  ]) {
    const f = ports(response);
    await assert.rejects(readNewestCommusoftJobPage("uk", "synthetic-private-app-key", null, f.options),
      { code: "invalid_response" });
  }
});

test("pins a following page to the provider cursor and rejects repeats", async () => {
  const f = ports({ ...body, data: [{ id: 13432, createdOnDateTime: "2026-10-19T10:00:00Z" }],
    pagination: { hasMore: false, nextCursor: 13432 } });
  const result = await readNewestCommusoftJobPage("uk", "synthetic-private-app-key", 13433, f.options);
  assert.equal(new URL(f.calls[0].url).searchParams.get("after"), "13433");
  assert.equal(result.hasMore, false);
  const repeated = ports({ ...body, data: [{ id: 13433, createdOnDateTime: "2026-10-19T10:00:00Z" }] });
  await assert.rejects(readNewestCommusoftJobPage("uk", "synthetic-private-app-key", 13433, repeated.options),
    { code: "invalid_response" });
});
