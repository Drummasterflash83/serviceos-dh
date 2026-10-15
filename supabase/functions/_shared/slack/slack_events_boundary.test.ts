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
      channelId: "C12345", ts: event.event.ts, threadTs: threadTs ?? null,
      correction: false });
    assert.equal(JSON.stringify(hint).includes("Private synthetic text"), false);
  }
});

test("signed challenge works; edits and deletes remain correction hints", async () => {
  const verification = await signed({ type: "url_verification",
    challenge: "syntheticChallenge_123" });
  assert.deepEqual(await verifyPublicChannelEvent(verification.raw,
    verification.headers, binding, nowMs),
  { kind: "challenge", challenge: "syntheticChallenge_123" });
  await rejected({ type: "url_verification", team_id: "TOTHER",
    challenge: "syntheticChallenge_123" }, "wrong_connection");
  for (const subtype of ["message_changed", "message_deleted"]) {
    const { raw, headers } = await signed({ ...event,
      event: { ...event.event, subtype } });
    const hint = await verifyPublicChannelEvent(raw, headers, binding, nowMs);
    assert.equal(hint.kind, "message_hint");
    if (hint.kind === "message_hint") assert.equal(hint.correction, true);
  }
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
});
