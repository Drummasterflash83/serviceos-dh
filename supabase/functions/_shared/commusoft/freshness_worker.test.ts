import { test } from "node:test";
import assert from "node:assert/strict";
import { runCommusoftFreshness } from "./freshness_worker.ts";
import type { NewestJobPage } from "./newest_job.ts";
import { CommusoftReadError } from "./read_page.ts";

const run = "00000000-0000-0000-0000-000000000001";
const claim = "00000000-0000-0000-0000-000000000002";
const ready = { state: "ready", run_id: run, claim_token: claim, region: "uk",
  api_key: "fake-local-only", after: null, send_before: Date.now() + 5000 };
const page: NewestJobPage = { rows: [{ id: "13437", createdAt: "2026-10-20T10:00:00Z" }],
  nextCursor: null, hasMore: false, providerServerTime: "2026-10-20T10:01:00Z" };

test("settles only stripped provider identifiers after live authority checks", async () => {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const db = { rpc: async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name.endsWith("_claim")) return { data: ready, error: null };
    if (name.endsWith("_current")) return { data: true, error: null };
    return { data: { state: "complete" }, error: null };
  } };
  const state = await runCommusoftFreshness(db, undefined,
    async (_region, _key, _after, ports) => {
      assert.equal(await ports.stillAuthorized(), true);
      return page;
    });
  assert.deepEqual(state, { state: "processed" });
  const finish = calls.find(call => call.name.endsWith("_finish"));
  assert.deepEqual(finish?.args?.p_rows, [{ id: "13437", createdAt: "2026-10-20T10:00:00Z" }]);
  assert.equal(JSON.stringify(finish).includes("fake-local-only"), false);
});

test("uncertain finish cannot be reported as a failed or successful read", async () => {
  const calls: string[] = [];
  const db = { rpc: async (name: string) => {
    calls.push(name);
    if (name.endsWith("_claim")) return { data: ready, error: null };
    return { data: null, error: { code: "timeout" } };
  } };
  assert.deepEqual(await runCommusoftFreshness(db, undefined, async () => page),
    { state: "unconfirmed" });
  assert.equal(calls.some(name => name.endsWith("_fail")), false);
});

test("provider failure enters bounded SQL backoff", async () => {
  const calls: string[] = [];
  const db = { rpc: async (name: string) => {
    calls.push(name);
    return name.endsWith("_claim") ? { data: ready, error: null } : { data: null, error: null };
  } };
  assert.deepEqual(await runCommusoftFreshness(db, undefined,
    async () => { throw new CommusoftReadError("rate_limited"); }), { state: "attention" });
  assert.equal(calls.at(-1), "new_dawn_commusoft_freshness_fail");
});
