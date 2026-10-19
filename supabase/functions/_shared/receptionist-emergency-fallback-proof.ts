// Read-only proof contract for a future supervised emergency fallback drill.
// It does not place calls, send notifications or infer delivery from settings.
type Identity = { tenantId: string; vapiCallId: string; birchillsCallId: string };
type Event = Identity & { source: "vapi" | "birchills" | "email" | "slack"; providerEventId: string; occurredAt: string };

export type EmergencyFallbackEvidence = {
  identity: Identity & { classification: "domestic" | "commercial" };
  callBinding?: Event & { state: "matched" | "pending" };
  attempts?: Array<Event & { target: "rob109" | "tony105"; outcome: "failed" | "human_accepted" | "unknown" }>;
  deposit?: Event & { mailbox: string; mailboxMessageId: string; state: "deposited" | "attempted" | "unknown" };
  emailReceipts?: Array<Event & { mailboxMessageId: string; recipient: string; state: "delivered" | "accepted" | "unknown" }>;
  slackReceipt?: Event & { mailboxMessageId: string; channelId: string; messageTs: string; state: "posted" | "queued" | "unknown" };
  reviewedSlackChannelId: string;
};

export type EmergencyFallbackAssessment = {
  state: "verified" | "not_verified";
  missing: string[];
};

const recipients = ["rob@drummondheating.co.uk", "tony@drummondheating.co.uk"];
const isId = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 160;
const millis = (value: unknown) => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) ? Date.parse(value) : NaN;

export function assessEmergencyFallbackProof(evidence: EmergencyFallbackEvidence): EmergencyFallbackAssessment {
  const missing: string[] = [];
  const identity = evidence.identity;
  if (!identity || ![identity.tenantId, identity.vapiCallId, identity.birchillsCallId].every(isId) ||
    !["domestic", "commercial"].includes(identity.classification))
    return { state: "not_verified", missing: ["call_identity"] };
  const events = [evidence.callBinding, ...(evidence.attempts ?? []), evidence.deposit,
    ...(evidence.emailReceipts ?? []), evidence.slackReceipt].filter(Boolean) as Event[];
  const sameCall = (event: Event) => event.tenantId === identity.tenantId &&
    event.vapiCallId === identity.vapiCallId && event.birchillsCallId === identity.birchillsCallId;
  if (!events.every(event => sameCall(event) && isId(event.providerEventId) && Number.isFinite(millis(event.occurredAt))) ||
    new Set(events.map(event => `${event.source}:${event.providerEventId}`)).size !== events.length)
    missing.push("correlated_provider_events");

  const bindingTime = millis(evidence.callBinding?.occurredAt);
  if (evidence.callBinding?.source !== "birchills" || evidence.callBinding.state !== "matched" || !Number.isFinite(bindingTime))
    missing.push("vapi_birchills_call_binding");

  const order = identity.classification === "domestic" ? ["tony105", "rob109"] : ["rob109", "tony105"];
  const attempts = evidence.attempts ?? [];
  const attemptTimes = attempts.map(attempt => millis(attempt.occurredAt));
  if (attempts.length !== 2 || attempts.some((attempt, index) =>
    attempt.source !== "vapi" || attempt.target !== order[index] || attempt.outcome !== "failed" ||
    !Number.isFinite(attemptTimes[index]) || attemptTimes[index] <= bindingTime ||
    (index > 0 && attemptTimes[index] <= attemptTimes[index - 1])))
    missing.push("two_ordered_engineer_failures");

  const deposit = evidence.deposit;
  const depositTime = millis(deposit?.occurredAt);
  if (deposit?.source !== "birchills" || deposit.mailbox !== "603" || deposit.state !== "deposited" || !isId(deposit.mailboxMessageId) ||
    !Number.isFinite(depositTime) || depositTime <= attemptTimes[1])
    missing.push("shared_603_deposit");

  const emails = evidence.emailReceipts ?? [];
  if (emails.length !== 2 || !recipients.every(recipient => emails.some(email =>
    email.source === "email" && typeof email.recipient === "string" && email.recipient.toLowerCase() === recipient && email.state === "delivered" &&
    email.mailboxMessageId === deposit?.mailboxMessageId && millis(email.occurredAt) > depositTime)))
    missing.push("both_delivered_email_receipts");

  const slack = evidence.slackReceipt;
  if (!isId(evidence.reviewedSlackChannelId) || slack?.source !== "slack" || slack.state !== "posted" ||
    slack.channelId !== evidence.reviewedSlackChannelId || !isId(slack.messageTs) ||
    slack.mailboxMessageId !== deposit?.mailboxMessageId || millis(slack.occurredAt) <= depositTime)
    missing.push("scoped_slack_post_receipt");

  return { state: missing.length ? "not_verified" : "verified", missing };
}
