import assert from "node:assert/strict";
import { test } from "node:test";
import { settleWithDeadline } from "./settle-with-deadline.ts";

test("a stalled session or request becomes a retryable timeout", async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(
    settleWithDeadline(
      async (requestSignal) => {
        signal = requestSignal;
        return new Promise<string>(() => {});
      },
      10,
      "Client directory timed out",
    ),
    /Client directory timed out/,
  );
  assert.equal(signal?.aborted, true);
});

test("a successful request clears its deadline", async () => {
  const result = await settleWithDeadline(async () => "ready", 100, "Too slow");
  assert.equal(result, "ready");
});

test("cancelling a query aborts the in-flight request", async () => {
  const query = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const result = settleWithDeadline(
    async (signal) => {
      requestSignal = signal;
      return new Promise<string>(() => {});
    },
    100,
    "Too slow",
    query.signal,
  );
  query.abort();
  await assert.rejects(result, /Request cancelled/);
  assert.equal(requestSignal?.aborted, true);
});
