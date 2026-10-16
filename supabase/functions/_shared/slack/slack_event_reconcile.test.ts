import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchApprovedSlackEventSource, type PendingSlackEvent } from "./slack_event_reconcile.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const rootTs = "1792105200.123456";
const replyTs = "1792105300.123456";
const base: PendingSlackEvent = { tenantId, eventId: "EvABC123456",
  teamId: "T12345", channelId: "C12345", sourceTs: rootTs,
  threadTs: null, kind: "message_hint", correction: null };
const root = { type: "message", ts: rootTs, text: "Synthetic public root" };
const reply = { type: "message", ts: replyTs, thread_ts: rootTs,
  text: "Synthetic public reply" };

function fixture(messages: unknown[], options: {
  private?: boolean; wrongTeam?: boolean; afterAuthorised?: boolean;
  hasMore?: boolean; bot?: boolean;
} = {}) {
  const methods: string[] = [];
  let checks = 0;
  return {
    methods,
    ports: {
      expectedIdentity: options.bot ? { kind: "bot" as const } :
        { kind: "user" as const, userId: "U12345" },
      authorised: async () => ++checks < 3 || options.afterAuthorised !== false,
      request: async (method: string) => {
        methods.push(method);
        if (method === "auth.test") return { ok: true,
          team_id: options.wrongTeam ? "TOTHER" : "T12345",
          ...(options.bot ? { bot_id: "B12345" } : { user_id: "U12345" }) };
        if (method === "conversations.info") return { ok: true,
          channel: { id: "C12345", is_channel: true,
            is_private: options.private ?? false } };
        return { ok: true, messages, has_more: options.hasMore ?? false };
      },
    },
  };
}

test("new public root is read from Slack before offering one source record", async () => {
  const f = fixture([root]);
  const outcome = await fetchApprovedSlackEventSource(base, f.ports);
  assert.equal(outcome.outcome, "present");
  assert.equal(outcome.records.length, 1);
  assert.deepEqual(f.methods,
    ["auth.test", "conversations.info", "conversations.history"]);
});

test("observed reply fetches only its exact thread and ignores the old parent", async () => {
  const f = fixture([root, reply]);
  const outcome = await fetchApprovedSlackEventSource({ ...base,
    sourceTs: replyTs, threadTs: rootTs }, f.ports);
  assert.equal(outcome.outcome, "present");
  assert.equal(outcome.records.length, 1);
  assert.equal(outcome.records[0].provider_timestamp, replyTs);
  assert.equal(f.methods[2], "conversations.replies");
});

test("an edit needs a current edited source; a delete needs verified absence", async () => {
  const changed = { ...root, text: "Synthetic changed public root",
    edited: { user: "U12345", ts: "1792105400.000001" } };
  assert.equal((await fetchApprovedSlackEventSource({ ...base,
    kind: "correction_hint", correction: "changed" },
    fixture([changed]).ports)).outcome, "present");
  await assert.rejects(fetchApprovedSlackEventSource({ ...base,
    kind: "correction_hint", correction: "changed" },
    fixture([root]).ports), /slack_event_edit_unconfirmed/);
  assert.equal((await fetchApprovedSlackEventSource({ ...base,
    kind: "correction_hint", correction: "deleted" },
    fixture([]).ports)).outcome, "absent_after_delete");
  await assert.rejects(fetchApprovedSlackEventSource({ ...base,
    kind: "correction_hint", correction: "deleted" },
    fixture([root]).ports), /slack_event_delete_unconfirmed/);
});

test("visibility, identity, completeness and last authority check fail closed", async () => {
  for (const [f, code] of [
    [fixture([root], { private: true }), "slack_event_public_visibility_unconfirmed"],
    [fixture([root], { wrongTeam: true }), "slack_event_identity_changed"],
    [fixture([root], { hasMore: true }), "history_cursor_unavailable"],
    [fixture([root], { afterAuthorised: false }), "slack_event_source_incomplete"],
  ] as const)
    await assert.rejects(fetchApprovedSlackEventSource(base, f.ports),
      new RegExp(code));
});

test("a new message absent from the provider remains retryable, never a deletion", async () => {
  await assert.rejects(fetchApprovedSlackEventSource(base, fixture([]).ports),
    /slack_event_source_not_visible_yet/);
});
