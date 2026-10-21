import test from "node:test";
import assert from "node:assert/strict";
import { assessEmergencyFallbackProof, type EmergencyFallbackEvidence } from "./receptionist-emergency-fallback-proof.ts";

const identity = { tenantId: "synthetic-tenant", vapiCallId: "synthetic-vapi-call", birchillsCallId: "synthetic-birchills-call" };
const event = (source: "vapi" | "birchills" | "email" | "slack", providerEventId: string, occurredAt: string) =>
  ({ ...identity, source, providerEventId, occurredAt });

function complete(): EmergencyFallbackEvidence {
  return {
    identity: { ...identity, classification: "domestic" },
    callBinding: { ...event("birchills", "binding-1", "2026-10-19T12:00:00Z"), state: "matched" },
    attempts: [
      { ...event("vapi", "transfer-1", "2026-10-19T12:00:10Z"), target: "tony105", outcome: "failed" },
    ],
    deposit: { ...event("birchills", "deposit-1", "2026-10-19T12:00:30Z"), mailbox: "603", mailboxMessageId: "synthetic-603-message", state: "deposited" },
    emailReceipts: [
      { ...event("email", "email-rob", "2026-10-19T12:00:40Z"), mailboxMessageId: "synthetic-603-message", recipient: "rob@drummondheating.co.uk", state: "delivered" },
      { ...event("email", "email-tony", "2026-10-19T12:00:41Z"), mailboxMessageId: "synthetic-603-message", recipient: "tony@drummondheating.co.uk", state: "delivered" },
    ],
    slackReceipt: { ...event("slack", "slack-1", "2026-10-19T12:00:42Z"), mailboxMessageId: "synthetic-603-message", channelId: "synthetic-reviewed-ai-emma", messageTs: "synthetic-ts", state: "posted" },
    reviewedSlackChannelId: "synthetic-reviewed-ai-emma",
  };
}

test("fully correlated synthetic 603, both delivered emails and scoped Slack post can pass", () => {
  assert.deepEqual(assessEmergencyFallbackProof(complete()), { state: "verified", missing: [] });
  const commercial = complete();
  commercial.identity.classification = "commercial";
  commercial.attempts![0].target = "rob109";
  assert.deepEqual(assessEmergencyFallbackProof(commercial), { state: "verified", missing: [] });
  const uncertain = complete();
  uncertain.identity.classification = "uncertain";
  assert.deepEqual(assessEmergencyFallbackProof(uncertain), { state: "verified", missing: [] });
});

test("a configuration, queued notification, transfer request or unmatched evidence cannot pass", () => {
  const mutations: Array<[string, (e: EmergencyFallbackEvidence) => void, string]> = [
    ["missing binding", e => { delete e.callBinding; }, "vapi_birchills_call_binding"],
    ["wrong tenant", e => { e.deposit!.tenantId = "another-tenant"; }, "correlated_provider_events"],
    ["cross-cover attempt", e => { e.attempts!.push({ ...e.attempts![0], providerEventId: "transfer-2", target: "rob109" }); }, "one_selected_engineer_failure"],
    ["wrong selected engineer", e => { e.attempts![0].target = "rob109"; }, "one_selected_engineer_failure"],
    ["voicemail is not confirmed failure", e => { e.attempts![0].outcome = "unknown"; }, "one_selected_engineer_failure"],
    ["not deposited", e => { e.deposit!.state = "attempted"; }, "shared_603_deposit"],
    ["office mailbox", e => { e.deposit!.mailbox = "601"; }, "shared_603_deposit"],
    ["mailbox before transfer", e => { e.deposit!.occurredAt = "2026-10-19T12:00:09Z"; }, "shared_603_deposit"],
    ["one email", e => { e.emailReceipts!.pop(); }, "both_delivered_email_receipts"],
    ["accepted is not delivered", e => { e.emailReceipts![1].state = "accepted"; }, "both_delivered_email_receipts"],
    ["email for other deposit", e => { e.emailReceipts![1].mailboxMessageId = "other-message"; }, "both_delivered_email_receipts"],
    ["queued Slack is not posted", e => { e.slackReceipt!.state = "queued"; }, "scoped_slack_post_receipt"],
    ["wrong Slack channel", e => { e.slackReceipt!.channelId = "other-channel"; }, "scoped_slack_post_receipt"],
    ["Slack for other deposit", e => { e.slackReceipt!.mailboxMessageId = "other-message"; }, "scoped_slack_post_receipt"],
  ];
  for (const [name, mutate, expected] of mutations) {
    const evidence = complete();
    mutate(evidence);
    const assessment = assessEmergencyFallbackProof(evidence);
    assert.equal(assessment.state, "not_verified", name);
    assert.ok(assessment.missing.includes(expected), name);
  }
});
