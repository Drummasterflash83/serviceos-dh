import { test } from "node:test";
import assert from "node:assert/strict";
import { slackWorkerEndpoint } from "./slack_worker_http.ts";
const key = "synthetic-service-key-not-a-credential";
test("only the configured infrastructure credential can trigger an empty POST", async () => {
  let calls = 0;
  const endpoint = slackWorkerEndpoint(key, async () => {
    calls++;
    return { claimed: 0, outcomes: [] };
  });
  for (const headers of [
    {},
    { authorization: "Bearer user-jwt" },
    { authorization: `Bearer ${key.slice(0, -1)}x` },
    { authorization: "Bearer " },
  ]) {
    assert.equal(
      (await endpoint(new Request("https://fixture.invalid", { method: "POST", headers }))).status,
      403,
    );
  }
  assert.equal(
    (
      await endpoint(
        new Request("https://fixture.invalid", { headers: { authorization: `Bearer ${key}` } }),
      )
    ).status,
    405,
  );
  assert.equal(calls, 0);
  const good = await endpoint(
    new Request("https://fixture.invalid", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
    }),
  );
  assert.equal(good.status, 200);
  assert.equal(calls, 1);
  assert.equal(good.headers.get("cache-control"), "no-store");
});
test("caller-supplied selectors never reach the queue and runtime errors disclose no details", async () => {
  let calls = 0;
  const endpoint = slackWorkerEndpoint(key, async () => {
    calls++;
    throw Error("private provider content");
  });
  assert.equal(
    (
      await endpoint(
        new Request("https://fixture.invalid", {
          method: "POST",
          headers: { authorization: `Bearer ${key}` },
          body: '{"job_types":["email.gmail_sync"]}',
        }),
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  const response = await endpoint(
    new Request("https://fixture.invalid", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
    }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, code: "worker_run_failed" });
  assert.equal(
    (
      await slackWorkerEndpoint(undefined, async () => {
        throw Error("must not run");
      })(new Request("https://fixture.invalid", { method: "POST" }))
    ).status,
    503,
  );
});
