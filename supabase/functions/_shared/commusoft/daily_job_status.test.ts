import { test } from "node:test";
import assert from "node:assert/strict";
import { readDailyCommusoftJobStatus, runDailyCommusoftJobStatus } from "./daily_job_status.ts";
import { CommusoftReadError } from "./read_page.ts";

const id = "00000000-0000-0000-0000-000000000001";
const token = "00000000-0000-0000-0000-000000000002";
const claim = { state: "ready", id, claim_token: token, external_id: "13441",
  region: "uk" as const, api_key: "fake-local-only", send_before: Date.now() + 5000 };

test("one exact GET retains only a provider status, timestamp and hash", async () => {
  let reads = 0;
  const result = await readDailyCommusoftJobStatus("uk", "fake-local-only", "13441", {
    sendBefore: Date.now() + 5000,
    stillAuthorized: async () => { reads++; return true; },
    fetcher: async (url, init) => {
      assert.equal(url, "https://app.commusoft.co.uk/api/v2/jobs/13441");
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ id: 13441, status: "on_hold",
        lastUpdatedOnDateTime: "2026-10-20 12:00:00", customerName: "PRIVATE" }),
      { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(reads, 2);
  assert.equal(result.status, "on_hold");
  assert.equal(result.providerUpdated, "2026-10-20 12:00:00");
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});

test("spoofed job identity is rejected before settlement", async () => {
  await assert.rejects(readDailyCommusoftJobStatus("uk", "fake-local-only", "13441", {
    sendBefore: Date.now() + 5000, stillAuthorized: async () => true,
    fetcher: async () => new Response(JSON.stringify({ id: 13442, status: "on_hold" }),
      { headers: { "content-type": "application/json" } }),
  }), (error: unknown) => error instanceof CommusoftReadError && error.code === "invalid_response");
});

test("durable finish sees only stripped status evidence; uncertain finish stays unconfirmed", async () => {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const db = { rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name.endsWith("_claim")) return { data: claim, error: null };
    if (name.endsWith("_current")) return { data: true, error: null };
    return { data: { state: "observed", id }, error: null };
  } };
  const result = await runDailyCommusoftJobStatus(db, undefined,
    async () => ({ status: "pending", providerUpdated: null, sha256: "a".repeat(64) }));
  assert.deepEqual(result, { state: "processed" });
  const finish = calls.find(call => call.name.endsWith("_finish"));
  assert.deepEqual(finish?.args, { p_id: id, p_token: token, p_external: "13441",
    p_status: "pending", p_provider_updated: null, p_sha256: "a".repeat(64) });
  assert.equal(JSON.stringify(calls).includes("fake-local-only"), false);

  const uncertain = { rpc: async (name: string) => name.endsWith("_claim")
    ? { data: claim, error: null } : { data: null, error: { code: "timeout" } } };
  assert.deepEqual(await runDailyCommusoftJobStatus(uncertain, undefined,
    async () => ({ status: "pending", providerUpdated: null, sha256: "a".repeat(64) })),
  { state: "unconfirmed" });
});

test("provider failure uses bounded SQL backoff, with no automatic HTTP retry", async () => {
  const calls: string[] = [];
  const db = { rpc: async (name: string) => {
    calls.push(name);
    return name.endsWith("_claim") ? { data: claim, error: null } : { data: null, error: null };
  } };
  assert.deepEqual(await runDailyCommusoftJobStatus(db, undefined,
    async () => { throw new CommusoftReadError("rate_limited"); }), { state: "attention" });
  assert.deepEqual(calls, ["new_dawn_job_status_daily_claim", "new_dawn_job_status_daily_fail"]);
});
