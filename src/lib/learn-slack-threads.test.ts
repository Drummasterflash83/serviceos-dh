import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadSlackStoredChannels,
  loadSlackObservedThreads,
  startSlackThreadImport,
  slackThreadProgress,
  type SlackThreadRequest,
} from "./learn-slack-threads.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const thread = {
  sourceId: id(3),
  sourceVersion: "a".repeat(64),
  parentTimestamp: "1767225700.000001",
  observedTimestamp: "1767225800.000001",
  excerpt: "Retained reply",
  latestImport: null,
};
const page = {
  version: "learn-slack-threads/1",
  tenantId: id(1),
  accountId: id(2),
  teamId: "TTEST",
  channelId: "CTEST",
  canImport: true,
  connectionRevision: "2026-01-01T00:00:00Z",
  threads: [thread],
  nextCursor: null,
  coverage: "observed_threads_only",
};
const request: SlackThreadRequest = {
  requestId: id(4),
  tenantId: id(1),
  accountId: id(2),
  sourceId: id(3),
  sourceVersion: thread.sourceVersion,
  parentTimestamp: thread.parentTimestamp,
  connectionRevision: page.connectionRevision,
  start: "2026-01-01T00:00:00Z",
  end: "2026-01-02T00:00:00Z",
  maxPages: 3,
  reason: "Retained synthetic thread",
};
const db = (data: any) => ({ rpc: async () => ({ data, error: null }) });
test("reply approval includes months after an observed parent with the same page bound", async () => {
  let sent: any;
  await startSlackThreadImport({rpc: async (_name, args) => {
    sent = args;
    return {data: {requestId: id(4), accountId: id(2), jobId: id(5), reused: false}, error: null};
  }}, {...request, end: "2026-10-01T00:00:00Z"});
  assert.equal(sent.p_start, "2026-01-01T00:00:00.000Z");
  assert.equal(sent.p_end, "2026-10-01T00:00:00.000Z");
  assert.equal(sent.p_max_pages, 3);
  assert.equal(sent.p_source_message_id, request.sourceId);
});
test("reader binds company/account and returns only validated observed-thread coverage", async () => {
  let called: any;
  const c = {
    rpc: async (name: string, args: any) => {
      called = { name, args };
      return { data: page, error: null };
    },
  };
  assert.deepEqual(await loadSlackObservedThreads(c, id(1), id(2)), page);
  assert.deepEqual(called, {
    name: "learn_slack_threads_read",
    args: { p_tenant_id: id(1), p_account_id: id(2), p_before_parent: null },
  });
  for (const change of [
    { tenantId: id(99) },
    { accountId: id(99) },
    { coverage: "all_threads" },
    { connectionRevision: null },
    { threads: [thread, thread] },
    { nextCursor: thread.parentTimestamp },
    { threads: [{ ...thread, sourceVersion: "wrong" }] },
    { threads: [{ ...thread, parentTimestamp: "1767225900.000001" }] },
  ])
    await assert.rejects(loadSlackObservedThreads(db({ ...page, ...change }), id(1), id(2)));
});
test("keyset pages reject repeats, reversed order and invalid cursor before data access", async () => {
  const rows = Array.from({ length: 20 }, (_, n) => ({
    ...thread,
    sourceId: id(10 + n),
    parentTimestamp: `${1767225800 - n}.000001`,
    observedTimestamp: `${1767225800 - n}.000001`,
  }));
  const p = { ...page, threads: rows, nextCursor: rows.at(-1)!.parentTimestamp };
  assert.equal((await loadSlackObservedThreads(db(p), id(1), id(2))).threads.length, 20);
  await assert.rejects(loadSlackObservedThreads(db(p), id(1), id(2), rows[0].parentTimestamp));
  await assert.rejects(
    loadSlackObservedThreads(db({ ...p, threads: [...rows].reverse() }), id(1), id(2)),
  );
  let calls = 0;
  await assert.rejects(
    loadSlackObservedThreads(
      {
        rpc: async () => {
          calls++;
          return { data: null, error: null };
        },
      },
      id(1),
      id(2),
      "invalid",
    ),
  );
  assert.equal(calls, 0);
});
test("stored channels are paginated and disabled channels remain visible", async () => {
  const channel = {
    id: id(2),
    name: "Retained channel",
    status: "disabled",
    teamId: "TTEST",
    channelId: "CTEST",
  };
  const p = {
    version: "learn-slack-accounts/1",
    tenantId: id(1),
    accounts: [channel],
    nextCursor: null,
  };
  assert.deepEqual((await loadSlackStoredChannels(db(p), id(1))).accounts, [channel]);
  for (const change of [
    { tenantId: id(99) },
    { accounts: [channel, channel] },
    { nextCursor: id(2) },
  ])
    await assert.rejects(loadSlackStoredChannels(db({ ...p, ...change }), id(1)));
});
test("approval retries bind original source version, connection revision and request identity", async () => {
  const calls: any[] = [];
  const c = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return {
        data: { requestId: id(4), accountId: id(2), jobId: id(5), reused: calls.length > 1 },
        error: null,
      };
    },
  };
  await startSlackThreadImport(c, request);
  assert.equal((await startSlackThreadImport(c, request)).reused, true);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].args.p_source_version, thread.sourceVersion);
  assert.equal(calls[0].args.p_connection_revision, page.connectionRevision);
  await assert.rejects(
    startSlackThreadImport(
      db({ requestId: id(4), accountId: id(99), jobId: id(5), reused: false }),
      request,
    ),
    /could not be verified/,
  );
});
test("invalid approval windows, guessed source versions and limits never reach RPC", async () => {
  let calls = 0;
  const c = {
    rpc: async () => {
      calls++;
      return { data: null, error: null };
    },
  };
  for (const change of [
    { sourceVersion: "bad" },
    { sourceId: "bad" },
    { parentTimestamp: "9999999999.000001" },
    { end: "2999-01-03T00:00:00Z" },
    { maxPages: 11 },
    { maxPages: 1.5 },
    { reason: " " },
    { connectionRevision: "bad" },
  ])
    await assert.rejects(startSlackThreadImport(c, { ...request, ...change }));
  assert.equal(calls, 0);
});
test("progress distinguishes queue lifecycle from bounded coverage and incomplete budgets", () => {
  assert.equal(slackThreadProgress(null), "No thread import recorded");
  const i: any = { status: "succeeded", complete: false, stopReason: "page_budget_exhausted" };
  assert.match(slackThreadProgress(i), /window incomplete/);
  assert.equal(slackThreadProgress({ ...i, complete: true }), "Approved window pages captured");
  assert.equal(slackThreadProgress({ ...i, status: "retrying" }), "Waiting to retry");
  assert.match(
    slackThreadProgress({ ...i, status: "dead_letter", complete: true }),
    /needs attention/,
  );
  assert.match(slackThreadProgress({ ...i, status: "cancelled" }), /evidence retained/);
});
