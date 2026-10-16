import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPublicChannelEvent, SlackEventBoundaryError } from "./slack_events_boundary.ts";

const secret = "synthetic-signing-secret-long-enough-123456789";
const binding = { signingSecret: secret, teamId: "T12345", appId: "A12345",
  allowedChannels: new Set(["C12345"]), minTs: "1792100000.000000" };
const nowMs = 1792105200000;
const sent = String(nowMs / 1000);
const event = { type: "event_callback", team_id: "T12345", api_app_id: "A12345",
  event_id: "EvABC123456", event: { type: "message", channel_type: "channel",
    channel: "C12345", ts: "1792105200.123456", text: "Private synthetic text" } };

async function signed(payload: unknown, when = sent) {
  const raw = new TextEncoder().encode(JSON.stringify(payload));
  const prefix = new TextEncoder().encode(`v0:${when}:`);
  const body = new Uint8Array(prefix.length + raw.length);
  body.set(prefix); body.set(raw, prefix.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const signature = "v0=" + [...mac].map((n) => n.toString(16).padStart(2, "0")).join("");
  return { raw, headers: new Headers({ "x-slack-request-timestamp": when,
    "x-slack-signature": signature }) };
}
async function rejected(payload: unknown, code: string) {
  const { raw, headers } = await signed(payload);
  await assert.rejects(verifyPublicChannelEvent(raw, headers, binding, nowMs),
    (error: unknown) => error instanceof SlackEventBoundaryError && error.code === code);
}

test("signed allowed public-channel root and reply yield bounded hints without source text", async () => {
  for (const threadTs of [undefined, "1792105100.000001"]) {
    const payload = { ...event, event: { ...event.event,
      ...(threadTs ? { thread_ts: threadTs } : {}) } };
    const { raw, headers } = await signed(payload);
    const hint = await verifyPublicChannelEvent(raw, headers, binding, nowMs);
    assert.deepEqual(hint, { kind: "message_hint", eventId: event.event_id,
      channelId: "C12345", ts: event.event.ts, threadTs: threadTs ?? null });
    assert.equal(JSON.stringify(hint).includes("Private synthetic text"), false);
  }
});

test("public bot messages and thread broadcasts become source-fetch hints", async () => {
  for (const subtype of ["bot_message", "thread_broadcast"]) {
    const payload = { ...event, event: { ...event.event,
      subtype, channel_type: undefined,
      thread_ts: subtype === "thread_broadcast" ? "1792105100.000001" : undefined } };
    const { raw, headers } = await signed(payload);
    const hint = await verifyPublicChannelEvent(raw, headers, binding, nowMs);
    assert.equal(hint.kind, "message_hint");
    if (hint.kind === "message_hint")
      assert.equal(hint.threadTs, subtype === "thread_broadcast"
        ? "1792105100.000001" : null);
    await rejected({ ...payload, event: { ...payload.event,
      channel_type: "im" } }, "out_of_scope_event");
  }
});

test("signed challenge works; documented edit and delete shapes target the original message", async () => {
  const verification = await signed({ type: "url_verification",
    challenge: "syntheticChallenge_123" });
  assert.deepEqual(await verifyPublicChannelEvent(verification.raw,
    verification.headers, binding, nowMs),
  { kind: "challenge", challenge: "syntheticChallenge_123" });
  await rejected({ type: "url_verification", team_id: "TOTHER",
    challenge: "syntheticChallenge_123" }, "wrong_connection");
  const originalTs = "1792090000.000001";
  const changed = await signed({ ...event, event: { type: "message", subtype: "message_changed",
    hidden: true, channel: "C12345", ts: event.event.ts,
    message: { type: "message", ts: originalTs, thread_ts: "1792080000.000001",
      text: "Private synthetic edit" } } });
  assert.deepEqual(await verifyPublicChannelEvent(changed.raw, changed.headers, binding, nowMs),
    { kind: "correction_hint", eventId: event.event_id, channelId: "C12345",
      eventTs: event.event.ts, sourceTs: originalTs, threadTs: "1792080000.000001",
      correction: "changed", requiresVisibilityCheck: true });
  const deleted = await signed({ ...event, event: { type: "message", subtype: "message_deleted",
    hidden: true, channel: "C12345", ts: event.event.ts, deleted_ts: originalTs } });
  assert.deepEqual(await verifyPublicChannelEvent(deleted.raw, deleted.headers, binding, nowMs),
    { kind: "correction_hint", eventId: event.event_id, channelId: "C12345",
      eventTs: event.event.ts, sourceTs: originalTs, threadTs: null,
      correction: "deleted", requiresVisibilityCheck: true });
});

test("raw-byte signature, time and connection binding fail closed", async () => {
  const { raw, headers } = await signed(event);
  const tampered = new TextEncoder().encode(JSON.stringify({ ...event,
    event: { ...event.event, text: "changed" } }));
  await assert.rejects(verifyPublicChannelEvent(tampered, headers, binding, nowMs),
    (e: unknown) => e instanceof SlackEventBoundaryError && e.code === "invalid_signature");
  const stale = await signed(event, String(Number(sent) - 301));
  await assert.rejects(verifyPublicChannelEvent(stale.raw, stale.headers,
    binding, nowMs), (e: unknown) => e instanceof SlackEventBoundaryError &&
      e.code === "invalid_signature");
  await rejected({ ...event, team_id: "TOTHER" }, "wrong_connection");
  await rejected({ ...event, api_app_id: "AOTHER" }, "wrong_connection");
  assert.equal(raw.length > 0, true);
});

test("DMs, private channels, unapproved channels and malformed events are excluded", async () => {
  await rejected({ ...event, event: { ...event.event, channel_type: "im" } }, "out_of_scope_event");
  await rejected({ ...event, event: { ...event.event, channel_type: "group" } }, "out_of_scope_event");
  await rejected({ ...event, is_ext_shared_channel: true }, "out_of_scope_event");
  await rejected({ ...event, event: { ...event.event, channel: "COTHER" } }, "out_of_scope_event");
  await rejected({ ...event, event: { ...event.event, ts: "not-a-timestamp" } }, "out_of_scope_event");
  await rejected({ ...event, event: { ...event.event, ts: "1792099999.999999" } },
    "out_of_scope_event");
  await rejected({ ...event, event_id: "invalid" }, "out_of_scope_event");
  await rejected({ ...event, event: { ...event.event, subtype: { type: "message_changed" } } },
    "out_of_scope_event");
  await rejected({ ...event, event: { ...event.event, subtype: "channel_join" } },
    "out_of_scope_event");
  await rejected({ ...event, event: { type: "message", subtype: "message_deleted",
    channel_type: "im", channel: "C12345", ts: event.event.ts,
    deleted_ts: "1792090000.000001" } }, "out_of_scope_event");
  await rejected({ ...event, event: { type: "message", subtype: "message_deleted",
    channel: "COTHER", ts: event.event.ts,
    deleted_ts: "1792090000.000001" } }, "out_of_scope_event");
  await rejected({ ...event, event: { type: "message", subtype: "message_changed",
    channel: "C12345", ts: event.event.ts, message: { text: "missing original ts" } } },
    "out_of_scope_event");
});
