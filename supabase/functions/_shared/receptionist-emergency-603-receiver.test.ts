import test from "node:test";
import assert from "node:assert/strict";
import {
  receivePublishedEmergency603, readEmergency603Delivery,
  type Published603Source, type ReviewedEmmaChannel,
  type Receiver603Ports, type Delivery603Ports,
} from "./receptionist-emergency-603-receiver.ts";
import type { Emergency603CoreEvidence } from "./receptionist-emergency-fallback-proof.ts";
import { OPENFOLK_TEAM } from "./notification-slack.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const sourceId = "11111111-1111-4111-8111-111111111111";
const reference = "22222222-2222-4222-8222-222222222222";
const source: Published603Source = {
  tenantId, sourceId, mailboxId: "33333333-3333-4333-8333-333333333333",
  routeId: "44444444-4444-4444-8444-444444444444", extension: "603",
  provider: "birchills", providerReference: reference, state: "published",
  audioSha256: "a".repeat(64), contentSha256: "b".repeat(64), audioBytes: 4096,
};
const route: ReviewedEmmaChannel = {
  teamId: OPENFOLK_TEAM, channelId: "C123AIEMMA", name: "ai-emma-urgent",
  eventKey: "urgent_feedback",
  member: true, archived: false, shared: false,
};
const identity = { tenantId, vapiCallId: "vapi-call-1", birchillsCallId: "birchills-call-1" };
const event = (source: "vapi" | "birchills" | "email" | "slack", providerEventId: string, occurredAt: string) =>
  ({ ...identity, source, providerEventId, occurredAt });
function core(classification: "domestic" | "commercial" | "uncertain" = "domestic"): Emergency603CoreEvidence {
  return {
    identity: { ...identity, classification },
    callBinding: { ...event("birchills", "binding", "2026-10-20T10:00:00Z"), state: "matched" },
    attempts: [
      { ...event("vapi", "first", "2026-10-20T10:00:10Z"), target: classification === "commercial" ? "rob109" : "tony105", outcome: "failed" },
    ],
    deposit: { ...event("birchills", "deposit", "2026-10-20T10:00:30Z"), mailbox: "603", mailboxMessageId: reference, state: "deposited" },
  };
}
function ports(overrides: Partial<{ source: Published603Source | null; core: Emergency603CoreEvidence | null; route: ReviewedEmmaChannel | null }> = {}) {
  const counters = { source: 0, call: 0, route: 0 };
  const result: Receiver603Ports = {
    readPublishedSource: async () => { counters.source++; return overrides.source === undefined ? source : overrides.source; },
    readCorrelatedCall: async () => { counters.call++; return overrides.core === undefined ? core() : overrides.core; },
    readReviewedChannel: async () => { counters.route++; return overrides.route === undefined ? route : overrides.route; },
  };
  return { result, counters };
}

test("one verified 603 deposit freezes two exact emails and a scoped Slack intent without copying caller data", async () => {
  for (const classification of ["domestic", "commercial", "uncertain"] as const) {
    const p = ports({ core: core(classification) });
    const first = await receivePublishedEmergency603(sourceId, p.result);
    const repeated = await receivePublishedEmergency603(sourceId, p.result);
    assert.equal(first.state, "prepared");
    assert.deepEqual(repeated, first, "duplicate receipt keeps identical delivery IDs and targets");
    if (first.state !== "prepared") return;
    assert.deepEqual(first.emails.map(email => email.recipient), ["rob@drummondheating.co.uk", "tony@drummondheating.co.uk"]);
    assert.equal(first.slack.channelId, route.channelId);
    assert.equal(new Set([...first.emails, first.slack].map(intent => intent.deliveryId)).size, 3);
    assert.ok([...first.emails, first.slack].every(intent => intent.mailboxMessageId === reference &&
      !JSON.stringify(intent).includes("caller") && !JSON.stringify(intent).includes("recording")));
    assert.deepEqual(p.counters, { source: 2, call: 2, route: 2 });
  }
});

test("unpublished, unrelated or insufficient source/call/route evidence holds before notification", async () => {
  const cases: Array<[string, Parameters<typeof ports>[0], string, number]> = [
    ["missing source", { source: null }, "published_603_source_unverified", 0],
    ["wrong tenant", { source: { ...source, tenantId: "other" } }, "published_603_source_unverified", 0],
    ["not Birchills", { source: { ...source, provider: "other" as "birchills" } }, "published_603_source_unverified", 0],
    ["not 603", { source: { ...source, extension: "601" } }, "published_603_source_unverified", 0],
    ["pending", { source: { ...source, state: "pending" } }, "published_603_source_unverified", 0],
    ["no audio", { source: { ...source, audioBytes: 0 } }, "published_603_source_unverified", 0],
    ["malformed call snapshot", { core: {} as Emergency603CoreEvidence }, "call_603_path_unverified", 0],
    ["wrong deposit", { core: { ...core(), deposit: { ...core().deposit!, mailboxMessageId: "other" } } }, "call_603_path_unverified", 0],
    ["accepted selected engineer", { core: { ...core(), attempts: [{ ...core().attempts![0], outcome: "human_accepted" }] } }, "call_603_path_unverified", 0],
    ["wrong selected engineer", { core: { ...core(), attempts: [{ ...core().attempts![0], target: "rob109" }] } }, "call_603_path_unverified", 0],
    ["cross-cover attempt", { core: { ...core(), attempts: [core().attempts![0], { ...core().attempts![0], providerEventId: "second", target: "rob109" }] } }, "call_603_path_unverified", 0],
    ["not deposited", { core: { ...core(), deposit: { ...core().deposit!, state: "attempted" } } }, "call_603_path_unverified", 0],
    ["other workspace", { route: { ...route, teamId: "other" } }, "slack_route_unverified", 1],
    ["other channel", { route: { ...route, name: "general" } }, "slack_route_unverified", 1],
    ["nonexistent old channel", { route: { ...route, name: "ai-emma" } }, "slack_route_unverified", 1],
    ["wrong route event", { route: { ...route, eventKey: "practice_feedback" } }, "slack_route_unverified", 1],
    ["not member", { route: { ...route, member: false } }, "slack_route_unverified", 1],
    ["shared", { route: { ...route, shared: true } }, "slack_route_unverified", 1],
  ];
  for (const [name, overrides, expected, routeReads] of cases) {
    const p = ports(overrides);
    assert.deepEqual(await receivePublishedEmergency603(sourceId, p.result), { state: "held", code: expected }, name);
    assert.equal(p.counters.route, routeReads, name);
  }
  const p = ports();
  assert.deepEqual(await receivePublishedEmergency603("not-a-uuid", p.result), { state: "held", code: "source_id_invalid" });
  assert.deepEqual(p.counters, { source: 0, call: 0, route: 0 });
});

test("only two delivered email receipts and one posted, correlated Slack receipt verify fallback", async () => {
  const base = ports().result;
  function delivery(emailState: "delivered" | "accepted", slackState: "posted" | "queued"): Delivery603Ports {
    return {
      ...base,
      readEmailReceipt: async intent => ({ ...event("email", `email-${intent.recipient}`, "2026-10-20T10:00:40Z"),
        mailboxMessageId: intent.mailboxMessageId, recipient: intent.recipient, state: emailState }),
      readSlackReceipt: async intent => ({ ...event("slack", "slack-post", "2026-10-20T10:00:41Z"),
        mailboxMessageId: intent.mailboxMessageId, channelId: intent.channelId, messageTs: "1.2", state: slackState }),
    };
  }
  assert.deepEqual(await readEmergency603Delivery(sourceId, delivery("delivered", "posted")), { state: "verified", missing: [] });
  assert.ok((await readEmergency603Delivery(sourceId, delivery("accepted", "posted"))).missing.includes("both_delivered_email_receipts"));
  assert.ok((await readEmergency603Delivery(sourceId, delivery("delivered", "queued"))).missing.includes("scoped_slack_post_receipt"));
  const absent = { ...delivery("delivered", "posted"), readEmailReceipt: async () => null };
  assert.ok((await readEmergency603Delivery(sourceId, absent)).missing.includes("both_delivered_email_receipts"));
});
