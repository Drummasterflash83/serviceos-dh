import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectCoverage } from "./learn-commusoft-coverage-read.mjs";

function response(id, { more = true, headers = {}, row = {} } = {}) {
  return new Response(
    JSON.stringify({
      data: id
        ? [
            {
              id,
              type: "customer",
              propertyID: 43,
              firstName: "PRIVATE PERSON",
              description: "PRIVATE JOB",
              ...row,
            },
          ]
        : [],
      pagination: { hasMore: more, nextCursor: more ? id : null },
    }),
    {
      headers: { "content-type": "application/json", ...headers },
    },
  );
}
test("bounds traffic, carries exact returned cursors and filters, and excludes source values", async () => {
  const requests = [],
    journals = [];
  const result = await inspectCoverage("PRIVATE_KEY", {
    persist: async (r) => journals.push(r),
    fetcher: async (url, options) => {
      const u = new URL(url);
      requests.push(u);
      assert.equal(journals.at(-1).checks.at(-1).state, "sending");
      assert.equal(options.headers.Authorization, "Bearer PRIVATE_KEY");
      assert.equal(options.method, "GET");
      assert.equal(options.redirect, "error");
      assert.equal(u.origin, "https://app.commusoft.co.uk");
      assert.equal(u.searchParams.get("limit"), u.pathname.endsWith("/properties") ? "100" : "1");
      assert.equal(u.searchParams.get("after"), requests.length % 2 ? null : "10439");
      return response(requests.length % 2 ? 10439 : 10577, {
        row: {
          type: requests.length === 2 ? "workaddress" : "customer",
          propertyID: Number(u.searchParams.get("propertyID") ?? 43),
        },
      });
    },
  });
  assert.equal(result.state, "bounded_reads_verified");
  assert.equal(requests.length, 8);
  assert.deepEqual(
    requests.map((u) => u.searchParams.get("type")),
    [null, null, null, null, "customer", "customer", "workaddress", "workaddress"],
  );
  assert.ok(result.checks.every((c) => c.state === "passed" && c.records === 1));
  const retained = JSON.stringify(journals);
  for (const privateValue of ["PRIVATE", "10439", "10577"])
    assert.ok(!retained.includes(privateValue));
});
test("empty terminal collections do not fabricate traversal or candidates", async () => {
  let calls = 0;
  const r = await inspectCoverage("test-key", {
    persist: async () => {},
    fetcher: async () => {
      calls++;
      return response(null, { more: false });
    },
  });
  assert.equal(calls, 2);
  assert.equal(r.state, "sample_incomplete");
  assert.ok(
    r.checks
      .filter((c) => c.state === "passed")
      .every((c) => c.records === 0 && !c.hasMore && !c.usesReturnedCursor),
  );
});
test("denial, malformed repeated cursor and exhausted quota stop without retry", async () => {
  for (const mode of ["denial", "repeated", "quota"]) {
    let calls = 0;
    const r = await inspectCoverage("test-key", {
      persist: async () => {},
      fetcher: async () => {
        calls++;
        if (mode === "denial") return new Response("PRIVATE ERROR", { status: 403 });
        return response(10439, {
          headers: mode === "quota" ? { "x-ratelimit-remaining": "0" } : {},
        });
      },
    });
    assert.equal(calls, mode === "repeated" ? 2 : 1);
    assert.equal(r.state, mode === "quota" ? "quota_wait" : "not_verified");
    assert.ok(!JSON.stringify(r).includes("PRIVATE"));
  }
});
test("unrecorded intent and failed post-read journal never permit further traffic", async () => {
  for (const failAt of [1, 2, 3]) {
    let persists = 0,
      calls = 0;
    await assert.rejects(
      inspectCoverage("test-key", {
        persist: async () => {
          if (++persists >= failAt) throw Error("unavailable");
        },
        fetcher: async () => {
          calls++;
          return response(10439);
        },
      }),
    );
    assert.equal(calls, failAt === 3 ? 1 : 0);
  }
});
