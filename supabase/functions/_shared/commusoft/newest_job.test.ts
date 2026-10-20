import { test } from "node:test";
import assert from "node:assert/strict";
import { readNewestCommusoftJob } from "./newest_job.ts";

const now = Date.parse("2026-10-20T08:00:00Z");
const body = {
  meta: { serverTime: "2026-10-20T08:00:01Z" },
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

test("reads only two newest-created Jobs and returns no private job fields", async () => {
  const f = ports();
  const result = await readNewestCommusoftJob("uk", "synthetic-private-app-key", f.options);
  assert.deepEqual(result, {
    id: "13434", createdOnDateTime: "2026-10-20T07:59:00Z",
    providerServerTime: "2026-10-20T08:00:01Z",
  });
  assert.equal(f.calls.length, 1);
  assert.equal(new URL(f.calls[0].url).searchParams.get("sort"), "-createdOnDateTime");
  assert.equal(new URL(f.calls[0].url).searchParams.get("limit"), "2");
  assert.equal(f.checks(), 2);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("holds reversed provider order and never requests after lost authority", async () => {
  const reversed = ports({ ...body, data: [...body.data].reverse() });
  await assert.rejects(readNewestCommusoftJob("uk", "synthetic-private-app-key", reversed.options),
    { code: "invalid_response" });
  const denied = ports();
  denied.options.stillAuthorized = async () => false;
  await assert.rejects(readNewestCommusoftJob("uk", "synthetic-private-app-key", denied.options),
    { code: "authority_unavailable" });
  assert.equal(denied.calls.length, 0);
});

test("does not call an empty or future-dated page a newest job", async () => {
  for (const response of [
    { ...body, data: [] },
    { ...body, data: [{ id: 13435, createdOnDateTime: "2026-10-21T08:00:00Z" }] },
  ]) {
    const f = ports(response);
    await assert.rejects(readNewestCommusoftJob("uk", "synthetic-private-app-key", f.options),
      { code: "invalid_response" });
  }
});
