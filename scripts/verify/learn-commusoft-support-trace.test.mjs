import test from "node:test";
import assert from "node:assert/strict";
import { captureSupportTrace, redactTrace } from "./learn-commusoft-support-trace.mjs";
const key = "SYNTHETIC_TRACE_SECRET";
test("one exact production-transport read; retained trace redacts credentials and cookies", async () => {
  const states = [];
  let n = 0;
  const r = await captureSupportTrace(key, {
    persist: async (r) => states.push(r.state),
    fetcher: async (url, init) => {
      n++;
      assert.equal(states.at(-1), "sending");
      assert.equal(url, "https://app.commusoft.co.uk/api/v2/properties?limit=1");
      assert.equal(init.headers.Authorization, `Bearer ${key}`);
      assert.equal(init.headers["x-api-key"], undefined);
      assert.equal(init.headers["User-Agent"], "OpenFolk-ServiceOS/1.0 (+https://openfolk.ai)");
      assert.equal(init.headers.Accept, "application/json");
      assert.equal(init.redirect, "error");
      assert.equal(init.credentials, "omit");
      assert.equal(init.body, undefined);
      return new Response(`<h1>Forbidden</h1>${key}`, {
        status: 403,
        headers: {
          "content-type": "text/html",
          "set-cookie": "PRIVATE_COOKIE",
          "x-request-id": "trace-example",
        },
      });
    },
  });
  assert.equal(n, 1);
  assert.equal(r.response.status, 403);
  assert.equal(r.result.code, "access_denied");
  assert.equal(r.response.headers["x-request-id"], "trace-example");
  assert.ok(!JSON.stringify(r).includes(key));
  assert.ok(!JSON.stringify(r).includes("PRIVATE_COOKIE"));
  assert.equal(
    redactTrace(
      `GET / HTTP/1.1\r\nx-api-key: ${key}\r\nCookie: OTHER\r\nAccept: application/json\r\n`,
      key,
    ).includes("OTHER"),
    false,
  );
});
test("success retains counts only, and journaling failure prevents network request", async () => {
  const r = await captureSupportTrace(key, {
    persist: async () => {},
    fetcher: async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 1, email: "PRIVATE_CUSTOMER" }],
          pagination: { hasMore: false, nextCursor: null },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  });
  assert.equal(r.result.state, "read_verified");
  assert.ok(!JSON.stringify(r).includes("PRIVATE_CUSTOMER"));
  let n = 0;
  await assert.rejects(
    captureSupportTrace(key, {
      persist: async () => {
        throw Error("disk");
      },
      fetcher: async () => {
        n++;
      },
    }),
  );
  assert.equal(n, 0);
});
test("error capture is bounded and cannot trigger retries or a second endpoint", async () => {
  let n = 0;
  const r = await captureSupportTrace(key, {
    persist: async () => {},
    fetcher: async () => {
      n++;
      return new Response("x".repeat(70000), { status: 429 });
    },
  });
  assert.equal(n, 1);
  assert.equal(r.response.body.bytes, 65536);
  assert.equal(r.response.body.truncated, true);
  assert.equal(r.result.code, "rate_limited");
});
