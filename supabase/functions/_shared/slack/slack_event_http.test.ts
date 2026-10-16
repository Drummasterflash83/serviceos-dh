import { test } from "node:test";
import assert from "node:assert/strict";
import { slackEventEndpoint, type SlackEventHint } from "./slack_event_http.ts";

const secret = "synthetic-signing-secret-long-enough-123456789";
const now = 1792105200000;
const binding = {
  signingSecret: secret,
  teamId: "T12345",
  appId: "A12345",
  allowedChannels: new Set(["C12345"]),
  minTs: "1792100000.000000",
};
const message = {
  type: "event_callback", team_id: "T12345", api_app_id: "A12345",
  event_id: "EvABC123456", event: { type: "message", channel_type: "channel",
    channel: "C12345", ts: "1792105200.123456", text: "Private synthetic text" },
};

async function request(payload: unknown, signatureOverride?: string) {
  const body = JSON.stringify(payload);
  const timestamp = String(now / 1000);
  const signed = new TextEncoder().encode(`v0:${timestamp}:${body}`);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, signed));
  const signature = "v0=" + [...mac].map((n) => n.toString(16).padStart(2, "0")).join("");
  return new Request("https://example.invalid/slack-events", {
    method: "POST", body,
    headers: { "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signatureOverride ?? signature },
  });
}

test("acknowledges only a durable bounded public-channel hint", async () => {
  const recorded: SlackEventHint[] = [];
  const endpoint = slackEventEndpoint({ loadBinding: async () => binding,
    recordHint: async (hint) => { recorded.push(hint); return "recorded"; },
    nowMs: () => now });
  const response = await endpoint(await request(message));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(recorded, [{ kind: "message_hint", eventId: "EvABC123456",
    channelId: "C12345", ts: "1792105200.123456", threadTs: null }]);
  assert.equal(JSON.stringify(recorded).includes("Private synthetic text"), false);
  assert.equal((await endpoint(await request(message))).status, 200);
});

test("signed challenge returns its challenge without recording an event", async () => {
  let calls = 0;
  const endpoint = slackEventEndpoint({ loadBinding: async () => binding,
    recordHint: async () => { calls++; return "recorded"; }, nowMs: () => now });
  const response = await endpoint(await request({ type: "url_verification",
    team_id: "T12345", api_app_id: "A12345", challenge: "syntheticChallenge_123" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "syntheticChallenge_123" });
  assert.equal(calls, 0);
});

test("correction stays a visibility-checked hint with the original source time", async () => {
  const recorded: SlackEventHint[] = [];
  const endpoint = slackEventEndpoint({ loadBinding: async () => binding,
    recordHint: async (hint) => { recorded.push(hint); return "recorded"; },
    nowMs: () => now });
  const changed = { ...message, event: { type: "message", subtype: "message_changed",
    channel: "C12345", ts: "1792105200.123456",
    message: { ts: "1792090000.000001", thread_ts: "1792080000.000001",
      text: "Private synthetic edit" } } };
  assert.equal((await endpoint(await request(changed))).status, 200);
  assert.deepEqual(recorded, [{ kind: "correction_hint", eventId: "EvABC123456",
    channelId: "C12345", eventTs: "1792105200.123456",
    sourceTs: "1792090000.000001", threadTs: "1792080000.000001",
    correction: "changed", requiresVisibilityCheck: true }]);
  assert.equal(JSON.stringify(recorded).includes("Private synthetic edit"), false);
});

test("invalid signature and unapproved or private scope never reach storage", async () => {
  let calls = 0;
  const endpoint = slackEventEndpoint({ loadBinding: async () => binding,
    recordHint: async () => { calls++; return "recorded"; }, nowMs: () => now });
  assert.equal((await endpoint(await request(message, "v0=" + "0".repeat(64)))).status, 401);
  const outside = await endpoint(await request({ ...message,
    event: { ...message.event, channel: "COTHER" } }));
  assert.equal(outside.status, 200);
  assert.deepEqual(await outside.json(), { ok: true, ignored: true });
  const directMessage = await endpoint(await request({ ...message,
    event: { ...message.event, channel_type: "im" } }));
  assert.equal(directMessage.status, 200);
  assert.equal(calls, 0);
});

test("uncertain persistence never acknowledges and duplicate is idempotent", async () => {
  const unavailable = slackEventEndpoint({ loadBinding: async () => binding,
    recordHint: async () => { throw Error("synthetic database outage"); }, nowMs: () => now });
  assert.equal((await unavailable(await request(message))).status, 503);
  const duplicate = slackEventEndpoint({ loadBinding: async () => binding,
    recordHint: async () => "duplicate", nowMs: () => now });
  assert.equal((await duplicate(await request(message))).status, 200);
  const absent = slackEventEndpoint({ loadBinding: async () => null,
    recordHint: async () => "recorded", nowMs: () => now });
  assert.equal((await absent(await request(message))).status, 503);
});

test("method, media type and body limit fail before verification or storage", async () => {
  let loaded = 0;
  const endpoint = slackEventEndpoint({ loadBinding: async () => { loaded++; return binding; },
    recordHint: async () => "recorded", nowMs: () => now });
  assert.equal((await endpoint(new Request("https://example.invalid", { method: "GET" }))).status, 405);
  assert.equal((await endpoint(new Request("https://example.invalid", {
    method: "POST", body: "{}", headers: { "content-type": "text/plain" },
  }))).status, 415);
  assert.equal((await endpoint(new Request("https://example.invalid", {
    method: "POST", body: "x".repeat(131073),
    headers: { "content-type": "application/json" },
  }))).status, 413);
  assert.equal(loaded, 0);
});
