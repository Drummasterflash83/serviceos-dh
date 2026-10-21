import test from "node:test";
import assert from "node:assert/strict";
import { OPENFOLK_TEAM } from "./notification-slack.ts";
import { receivePublishedEmergency603 } from "./receptionist-emergency-603-receiver.ts";
import { reserveEmergency603Notifications, type Durable603Ports } from "./receptionist-emergency-603-outbox.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const sourceId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const counters = { writes: 0 };
  const identity = { tenantId, vapiCallId: "vapi-1", birchillsCallId: "birchills-1" };
  const event = (source: "vapi" | "birchills", providerEventId: string, occurredAt: string) =>
    ({ ...identity, source, providerEventId, occurredAt });
  const ports: Durable603Ports = {
    readPublishedSource: async () => ({ tenantId, sourceId,
      mailboxId: "33333333-3333-4333-8333-333333333333",
      routeId: "44444444-4444-4444-8444-444444444444",
      extension: "603", provider: "birchills", providerReference: messageId,
      state: "published", audioSha256: "a".repeat(64), contentSha256: "b".repeat(64), audioBytes: 2048 }),
    readCorrelatedCall: async () => ({
      identity: { ...identity, classification: "commercial" },
      callBinding: { ...event("birchills", "binding", "2026-10-21T10:00:00Z"), state: "matched" },
      attempts: [{ ...event("vapi", "attempt", "2026-10-21T10:01:00Z"), target: "rob109", outcome: "failed" }],
      deposit: { ...event("birchills", "deposit", "2026-10-21T10:02:00Z"), mailbox: "603", mailboxMessageId: messageId, state: "deposited" },
    }),
    readReviewedChannel: async () => ({ teamId: OPENFOLK_TEAM, channelId: "C123AIEMMA", name: "ai-emma-urgent",
      eventKey: "urgent_feedback", member: true, archived: false, shared: false }),
    prepareAtomically: async () => { counters.writes++; return []; },
  };
  return { ports, counters };
}

test("unverified proof cannot reach the outbox writer", async () => {
  const f = fixture();
  f.ports.readCorrelatedCall = async () => null;
  assert.deepEqual(await reserveEmergency603Notifications(sourceId, f.ports),
    { state: "held", code: "call_603_path_unverified" });
  assert.equal(f.counters.writes, 0);
});

test("a verified source crosses only the atomic reservation boundary and checks all three fixed IDs", async () => {
  const f = fixture();
  const prepared = await receivePublishedEmergency603(sourceId, f.ports);
  assert.equal(prepared.state, "prepared");
  if (prepared.state !== "prepared") return;
  f.ports.prepareAtomically = async input => {
    f.counters.writes++;
    assert.equal(input.sourceId, sourceId);
    assert.equal(input.channelId, prepared.slack.channelId);
    assert.deepEqual(input.core, prepared.core);
    return [
      { deliveryId: prepared.emails[0].deliveryId, target: "rob_email", destination: prepared.emails[0].recipient, state: "prepared" },
      { deliveryId: prepared.emails[1].deliveryId, target: "tony_email", destination: prepared.emails[1].recipient, state: "prepared" },
      { deliveryId: prepared.slack.deliveryId, target: "urgent_slack", destination: prepared.slack.channelId, state: "prepared" },
    ];
  };
  const reserved = await reserveEmergency603Notifications(sourceId, f.ports);
  assert.equal(reserved.state, "durable");
  assert.equal(f.counters.writes, 1);
});

test("Off/error and a mismatched frozen destination are held without sending", async () => {
  const f = fixture();
  f.ports.prepareAtomically = async () => { throw new Error("preparation off"); };
  assert.deepEqual(await reserveEmergency603Notifications(sourceId, f.ports),
    { state: "held", code: "durable_preparation_unavailable" });
  f.ports.prepareAtomically = async () => [
    { deliveryId: "wrong", target: "rob_email", destination: "wrong@example.com", state: "prepared" },
  ];
  assert.deepEqual(await reserveEmergency603Notifications(sourceId, f.ports),
    { state: "held", code: "durable_preparation_mismatch" });
});
