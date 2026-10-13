import { test } from "node:test";
import assert from "node:assert/strict";
import { runQuickBooksImport } from "./import_worker.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-13T16:00:00Z");
const request = {
  tenantId: id(1),
  connectionId: id(2),
  realmId: "9130357990011111",
  environment: "sandbox",
  entity: "Invoice",
  startPosition: 1,
  pageSize: 2,
  minorVersion: 75,
};
const lease = () => ({
  state: "ready",
  runId: id(3),
  permitId: id(4),
  expiresAt: new Date(now + 90000).toISOString(),
  request,
  credential: {
    ...request,
    accessToken: "synthetic-access",
    expiresAt: new Date(now + 3600000).toISOString(),
  },
});
const raw =
  '{"QueryResponse":{"Invoice":[{"Id":"1","SyncToken":"0","TotalAmt":9007199254740993.01}],"startPosition":1,"maxResults":1},"time":"2026-10-13T16:00:00Z"}';
const receipt = { runId: id(3), pageId: id(5), state: "traversed" };
test("worker saves the original provider text under its single reservation", async () => {
  let requests = 0,
    commits = 0;
  const result = await runQuickBooksImport({
    clock: () => now,
    rpc: async (name, args) => {
      if (name === "learn_quickbooks_import_acquire") return { data: lease(), error: null };
      if (name === "learn_quickbooks_import_current") return { data: true, error: null };
      assert.equal(name, "learn_quickbooks_import_commit");
      assert.equal(args.p_raw, raw);
      assert.equal(args.p_permit, id(4));
      commits++;
      return { data: receipt, error: null };
    },
    fetcher: async (_url, opts) => {
      assert.equal(opts?.method, "GET");
      requests++;
      return new Response(raw, { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.state, "saved");
  assert.equal(requests, 1);
  assert.equal(commits, 1);
  assert.equal(JSON.stringify(result).includes("900719925"), false);
});
test("lost commit response is recovered as saved and never refetched or overwritten as failure", async () => {
  let requests = 0,
    settled = 0;
  const result = await runQuickBooksImport({
    clock: () => now,
    rpc: async (name, args) => {
      if (name === "learn_quickbooks_import_acquire") return { data: lease(), error: null };
      if (name === "learn_quickbooks_import_current") return { data: true, error: null };
      if (name === "learn_quickbooks_import_commit") return { data: null, error: "response lost" };
      assert.equal(name, "learn_quickbooks_import_fail");
      assert.equal(args.p_code, "persistence_unconfirmed");
      settled++;
      return { data: receipt, error: null };
    },
    fetcher: async () => {
      requests++;
      return new Response(raw, { headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.state, "saved");
  assert.equal(requests, 1);
  assert.equal(settled, 1);
});
test("429 preserves retry delay and does not retry inside one worker", async () => {
  let requests = 0;
  const result = await runQuickBooksImport({
    clock: () => now,
    rpc: async (name, args) => {
      if (name === "learn_quickbooks_import_acquire") return { data: lease(), error: null };
      if (name === "learn_quickbooks_import_current") return { data: true, error: null };
      assert.equal(name, "learn_quickbooks_import_fail");
      assert.equal(args.p_code, "rate_limited");
      assert.equal(args.p_retry_seconds, 120);
      return { data: { runId: id(3), state: "queued" }, error: null };
    },
    fetcher: async () => {
      requests++;
      return new Response("private provider data", {
        status: 429,
        headers: { "retry-after": "120" },
      });
    },
  });
  assert.equal(result.state, "attention");
  assert.equal(requests, 1);
});
test("unapproved or paced work never reaches the provider", async () => {
  for (const state of ["idle", "held", "waiting"]) {
    let requests = 0;
    assert.equal(
      (
        await runQuickBooksImport({
          rpc: async () => ({ data: { state }, error: null }),
          fetcher: async () => {
            requests++;
            throw Error();
          },
        })
      ).claimed,
      0,
    );
    assert.equal(requests, 0);
  }
});
