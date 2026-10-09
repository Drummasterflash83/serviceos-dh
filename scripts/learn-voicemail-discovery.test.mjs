import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverVoicemail,
  DiscoveryError,
  resourceUrl,
} from "../supabase/functions/_shared/sipcentric-voicemail-discovery.ts";
const base = resourceUrl("25");
const endpoint = (id, type = "phone") => ({ uri: `${base}/${id}`, type });
const page = (items, extra = {}) => ({
  page: 1,
  pageSize: 200,
  totalItems: items.length,
  items,
  ...extra,
});
function fixture(responses, options = {}) {
  const calls = [];
  const run = () =>
    discoverVoicemail({
      customerId: "25",
      username: "test",
      password: "secret",
      ...options,
      fetcher: async (url, init) => {
        calls.push({ url, init });
        assert.equal(init.method, "GET");
        assert.equal(init.redirect, "manual");
        assert.equal(init.headers.Authorization, "Basic " + btoa("test:secret"));
        assert.ok(url.startsWith(base));
        assert.ok(init.signal instanceof AbortSignal);
        const response = responses.shift();
        if (response instanceof Error) throw response;
        assert.notEqual(response, undefined, "unexpected provider request");
        return response instanceof Response ? response : Response.json(response);
      },
    });
  return { run, calls };
}
const rejects = (f, code) =>
  assert.rejects(f, (e) => e instanceof DiscoveryError && e.code === code);
test("empty endpoint list never claims empty or synchronized voicemails", async () => {
  const result = await fixture([page([])]).run();
  assert.equal(result.endpointListingComplete, true);
  assert.equal(result.endpointCount, 0);
  assert.equal(result.messageCoverage, "unverified");
  assert.deepEqual(result.candidates, []);
});
test("follows only published scoped links, upgrades HTTP, retains only safe structural metadata", async () => {
  const e = endpoint("101");
  const vm = `${e.uri}/voicemail`;
  const { run, calls } = fixture(
    [
      page([e, endpoint("102", "queue")]),
      {
        ...e,
        voicemailEnabled: true,
        email: "private@example.test",
        links: { voicemail: vm.replace("https:", "http:") },
      },
      {
        type: "voicemail",
        pin: "12345",
        email: "private@example.test",
        items: [{ transcript: "private words" }],
        "private-dynamic-key": "secret",
        links: { messages: `${vm}/messages`, "private-link": "secret" },
      },
    ],
    { inspectPublishedResources: true },
  );
  const r = await run();
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, vm);
  assert.equal(r.endpointCount, 2);
  assert.deepEqual(r.candidates[0].resourceShape, {
    kind: "object",
    keys: ["email", "items", "links", "pin", "type"],
    linkKeys: ["messages"],
    otherKeyCount: 1,
    otherLinkKeyCount: 1,
  });
  assert.doesNotMatch(JSON.stringify(r), /private|secret|12345/);
  assert.equal(r.messageCoverage, "unverified");
});
test("resource inspection is opt-in and missing enabled state stays unknown", async () => {
  const e = endpoint("101", "mailbox");
  const r = await fixture([page([e]), { ...e, links: { voicemail: `${e.uri}/voicemail` } }]).run();
  assert.equal(r.requests, 2);
  assert.equal(r.candidates[0].resourceShape, null);
  assert.equal(r.candidates[0].voicemailEnabled, null);
});
test("rejects foreign accounts, ports, query tricks and mismatched resource links before fetching them", async () => {
  const e = endpoint("101");
  for (const link of [
    "https://evil.test/",
    `${e.uri}/voicemail?token=secret`,
    `${base.replace("/25/", "/26/")}/101/voicemail`,
    `${e.uri}/voicemail/`,
    `${e.uri.replace("sipcentric.com", "sipcentric.com:444")}/voicemail`,
  ]) {
    const f = fixture([page([e]), { ...e, links: { voicemail: link } }], {
      inspectPublishedResources: true,
    });
    await rejects(f.run, "invalid_scope");
    assert.equal(f.calls.length, 2);
  }
  for (const id of ["", "../25", "25?x=y", "25/26", "25%2f26"])
    assert.throws(() => resourceUrl(id), /invalid_scope/);
});
test("refuses redirects, rate limits and upstream auth errors without leaking response bodies", async () => {
  for (const [status, code] of [
    [302, "redirect_refused"],
    [401, "auth_failed"],
    [403, "auth_failed"],
    [429, "rate_limited"],
    [500, "upstream_error"],
  ]) {
    const response = new Response("private provider diagnostics", {
      status,
      headers: { Location: "https://evil.test/", "X-RateLimit-Reset": "27" },
    });
    const f = fixture([response]);
    await assert.rejects(
      f.run,
      (e) =>
        e.code === code &&
        !e.message.includes("private") &&
        (status !== 429 || e.retryAfterSeconds === 27),
    );
    assert.equal(f.calls.length, 1);
  }
  await rejects(fixture([new Error("secret account credentials")]).run, "network_error");
});
test("malformed, oversized and non-JSON responses cannot become a successful empty inventory", async () => {
  for (const payload of [
    {},
    [],
    page([endpoint("101")], { totalItems: 2 }),
    page([endpoint("101"), endpoint("101")]),
    page([], { nextPage: `${base}?page=2` }),
  ]) {
    await assert.rejects(fixture([payload]).run, (e) =>
      ["invalid_response", "inconsistent_inventory"].includes(e.code),
    );
  }
  await rejects(fixture([new Response("html")]).run, "invalid_response");
  await rejects(
    fixture([new Response("{", { headers: { "content-type": "application/json" } })]).run,
    "invalid_response",
  );
  await rejects(
    fixture([
      new Response("x", {
        headers: { "content-type": "application/json", "content-length": "99999999" },
      }),
    ]).run,
    "response_too_large",
  );
  await rejects(
    fixture([
      new Response(" ".repeat(2 * 1024 * 1024 + 1), {
        headers: { "content-type": "application/json" },
      }),
    ]).run,
    "response_too_large",
  );
});
test("pagination requires stable totals, full pages and exact nonforeign next-page links", async () => {
  const items = Array.from({ length: 200 }, (_, i) => endpoint(String(i), "queue"));
  const first = page(items, { totalItems: 201, nextPage: `${base}?pageSize=200&page=2` });
  const last = page([endpoint("201", "queue")], { totalItems: 201, page: 2 });
  const r = await fixture([first, last]).run();
  assert.equal(r.endpointCount, 201);
  assert.equal(r.requests, 2);
  for (const second of [
    { ...last, totalItems: 202 },
    { ...last, items: [items[0]] },
    { ...last, page: 1 },
    { ...last, items: [] },
  ])
    await assert.rejects(fixture([first, second]).run);
  await rejects(
    fixture([{ ...first, nextPage: "https://evil.test/" }]).run,
    "inconsistent_inventory",
  );
});
test("budget exhaustion never returns a partial result labelled complete", async () => {
  const f = fixture([page([endpoint("101")])], { requestBudget: 1 });
  await rejects(f.run, "request_budget");
  assert.equal(f.calls.length, 1);
});
test("detail identity, type and enabled-state mismatches fail closed", async () => {
  const e = endpoint("101");
  for (const detail of [
    { ...e, uri: `${base}/102` },
    { ...e, type: "mailbox" },
    { ...e, voicemailEnabled: "false" },
    { ...e, links: [] },
  ])
    await rejects(fixture([page([e]), detail]).run, "invalid_response");
  const result = await fixture([page([e]), { ...e, voicemailEnabled: false }]).run();
  assert.equal(result.candidates[0].voicemailEnabled, false);
  assert.equal(result.candidates[0].publishedVoicemailLink, false);
});
test("missing credentials, invalid budgets and excessive inventories make no extra requests", async () => {
  for (const options of [{ username: "" }, { password: "" }, { username: "name:other" }]) {
    let requests = 0;
    await rejects(
      () =>
        discoverVoicemail({
          customerId: "25",
          username: "test",
          password: "test",
          ...options,
          fetcher: async () => {
            requests++;
            throw Error("must not call");
          },
        }),
      "invalid_credentials",
    );
    assert.equal(requests, 0);
  }
  for (const requestBudget of [0, 101, NaN, 1.5])
    await rejects(fixture([], { requestBudget }).run, "request_budget");
  await rejects(fixture([page([], { totalItems: 2001 })]).run, "request_budget");
});
