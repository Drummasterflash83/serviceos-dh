import { test } from "node:test";
import assert from "node:assert/strict";
import { handleSlackEventSync } from "./slack_event_worker.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const jobId = "00000000-0000-0000-0000-000000000099";
const accountId = "00000000-0000-0000-0000-000000000077";
const sourceTs = "1792105200.123456";
const secret = "xoxp-synthetic-token-never-persist";
const binding = { version: "learn-slack-event-context/1", tenantId, jobId,
  eventId: "EvABC123456", teamId: "T12345", channelId: "C12345", sourceTs,
  threadTs: null, hintKind: "message_hint", correction: null,
  connectionId: accountId, connectionRevision: "2026-10-16T05:00:00Z",
  secretRef: "00000000-0000-0000-0000-000000000088",
  tokenKind: "user", userId: "U12345" };
const job = { supabaseAdmin: null, tenantId, jobId,
  jobType: "slack.event_sync", payload: { event_id: binding.eventId },
  claim: { claimedBy: "learn-slack:00000000-0000-0000-0000-000000000066",
    attemptCount: 1 } };

function fixture(options: { private?: boolean; rateLimited?: boolean;
  deleted?: boolean; lostCommit?: boolean } = {}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const requests: string[] = [];
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === "learn_slack_event_context") return { data: options.deleted
      ? { ...binding, hintKind: "correction_hint", correction: "deleted" } : binding,
      error: null };
    if (name === "learn_slack_event_credential") return { data: secret, error: null };
    if (name === "learn_slack_event_commit") return options.lostCommit
      ? { data: null, error: { code: "network" } }
      : { data: { version: "learn-slack-event-source/1",
        eventId: binding.eventId, sourceVersion: "a".repeat(64) }, error: null };
    throw Error(`unexpected rpc ${name}`);
  } };
  const fetcher = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    requests.push(url.pathname);
    assert.equal(init.headers && (init.headers as Record<string, string>).Authorization,
      `Bearer ${secret}`);
    if (options.rateLimited && url.pathname.endsWith("/conversations.history"))
      return new Response(null, { status: 429, headers: { "retry-after": "120" } });
    const payload = url.pathname.endsWith("/auth.test")
      ? { ok: true, team_id: "T12345", user_id: "U12345" }
      : url.pathname.endsWith("/conversations.info")
        ? { ok: true, channel: { id: "C12345", is_channel: true,
          is_private: options.private ?? false } }
        : { ok: true, messages: options.deleted ? [] :
          [{ type: "message", ts: sourceTs, text: "Synthetic source body" }],
          has_more: false };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  return { db, calls, requests, fetcher };
}

test("paced event handler fetches provider evidence and commits only the exact record", async () => {
  const f = fixture();
  const result = await handleSlackEventSync({ ...job, supabaseAdmin: f.db } as any,
    f.fetcher as typeof fetch);
  assert.equal(result.success, true);
  assert.deepEqual(f.requests, ["/api/auth.test", "/api/conversations.info",
    "/api/conversations.history"]);
  const commit = f.calls.find((call) => call.name === "learn_slack_event_commit");
  assert.equal((commit?.args.p_records as unknown[]).length, 1);
  assert.equal(commit?.args.p_source_absent, false);
  assert.equal(JSON.stringify(f.calls).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("Synthetic source body"), false);
});

test("delete confirms source absence before requesting withholding", async () => {
  const f = fixture({ deleted: true });
  const result = await handleSlackEventSync({ ...job, supabaseAdmin: f.db } as any,
    f.fetcher as typeof fetch);
  assert.equal(result.success, true);
  const commit = f.calls.find((call) => call.name === "learn_slack_event_commit");
  assert.equal(commit?.args.p_source_absent, true);
  assert.deepEqual(commit?.args.p_records, []);
});

test("private visibility, rate limits and unknown commit each avoid false success", async () => {
  for (const [options, code, retryable] of [
    [{ private: true }, "slack_event_public_visibility_unconfirmed", false],
    [{ rateLimited: true }, "slack_event_rate_limited", true],
    [{ lostCommit: true }, "slack_event_commit_unconfirmed", true],
  ] as const) {
    const f = fixture(options);
    const result = await handleSlackEventSync({ ...job, supabaseAdmin: f.db } as any,
      f.fetcher as typeof fetch);
    assert.equal(result.success, false);
    assert.equal(result.error?.code, code);
    assert.equal(result.error?.retryable, retryable);
    if (options.private || options.rateLimited)
      assert.equal(f.calls.some((call) => call.name === "learn_slack_event_commit"), false);
  }
});
