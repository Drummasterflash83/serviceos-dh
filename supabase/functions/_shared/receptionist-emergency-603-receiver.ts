// Candidate-only bridge from a VERIFIED, published Birchills 603 intake to
// three frozen notification intents and a read-only delivery assessment.
// This module has no provider transport, database writer, or scheduler. Ports
// must read authenticated internal records/provider receipts; an HTTP caller
// may supply only the source ID, never call evidence, addresses or a channel.
import {
  assessEmergency603DepositProof,
  assessEmergencyFallbackProof,
  type Emergency603CoreEvidence,
  type EmergencyFallbackEvidence,
} from "./receptionist-emergency-fallback-proof.ts";
import { OPENFOLK_TEAM } from "./notification-slack.ts";

const tenantId = "00000000-0000-0000-0000-000000000001";
const recipients = ["rob@drummondheating.co.uk", "tony@drummondheating.co.uk"] as const;
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const channel = /^[CG][A-Z0-9]+$/;

export type Published603Source = {
  tenantId: string;
  sourceId: string;
  mailboxId: string;
  routeId: string;
  extension: string;
  providerReference: string;
  provider: "birchills";
  state: "published" | "pending";
  audioSha256: string;
  contentSha256: string;
  audioBytes: number;
};
export type ReviewedEmmaChannel = {
  teamId: string;
  channelId: string;
  name: string;
  member: boolean;
  archived: boolean;
  shared: boolean;
};
export type Email603Intent = {
  kind: "email";
  deliveryId: string;
  tenantId: string;
  sourceId: string;
  mailboxMessageId: string;
  recipient: typeof recipients[number];
  subject: string;
  text: string;
};
export type Slack603Intent = {
  kind: "slack";
  deliveryId: string;
  tenantId: string;
  sourceId: string;
  mailboxMessageId: string;
  channelId: string;
  text: string;
};
export type Prepared603 = {
  state: "prepared";
  sourceId: string;
  core: Emergency603CoreEvidence;
  emails: readonly [Email603Intent, Email603Intent];
  slack: Slack603Intent;
};
export type Held603 = { state: "held"; code: string };

export type Receiver603Ports = {
  readPublishedSource: (sourceId: string) => Promise<Published603Source | null>;
  readCorrelatedCall: (source: Published603Source) => Promise<Emergency603CoreEvidence | null>;
  readReviewedChannel: () => Promise<ReviewedEmmaChannel | null>;
};
export type Delivery603Ports = Receiver603Ports & {
  // These adapters must authenticate provider delivery, not read a queued
  // outbox row or accept an unverified webhook payload as a receipt.
  readEmailReceipt: (intent: Email603Intent) => Promise<NonNullable<EmergencyFallbackEvidence["emailReceipts"]>[number] | null>;
  readSlackReceipt: (intent: Slack603Intent) => Promise<EmergencyFallbackEvidence["slackReceipt"] | null>;
};

async function deliveryId(sourceId: string, mailboxMessageId: string, target: string) {
  const bytes = new TextEncoder().encode(`${tenantId}\n${sourceId}\n${mailboxMessageId}\n${target}`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    b => b.toString(16).padStart(2, "0")).join("");
  // Stable RFC 4122-shaped ID for Slack client_msg_id and provider idempotency.
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function receivePublishedEmergency603(sourceId: string, ports: Receiver603Ports): Promise<Prepared603 | Held603> {
  if (!uuid.test(sourceId)) return { state: "held", code: "source_id_invalid" };
  let source: Published603Source | null;
  try { source = await ports.readPublishedSource(sourceId); }
  catch { return { state: "held", code: "source_unavailable" }; }
  if (!source || source.tenantId !== tenantId || source.sourceId !== sourceId ||
    !uuid.test(source.mailboxId) || !uuid.test(source.routeId) ||
    source.provider !== "birchills" || source.extension !== "603" || source.state !== "published" ||
    !uuid.test(source.providerReference) || !digest.test(source.audioSha256) ||
    !digest.test(source.contentSha256) || !Number.isSafeInteger(source.audioBytes) || source.audioBytes <= 0)
    return { state: "held", code: "published_603_source_unverified" };

  let core: Emergency603CoreEvidence | null;
  try { core = await ports.readCorrelatedCall(source); }
  catch { return { state: "held", code: "call_evidence_unavailable" }; }
  if (!core || core.identity?.tenantId !== tenantId ||
    core.deposit?.mailboxMessageId !== source.providerReference ||
    assessEmergency603DepositProof(core).state !== "verified")
    return { state: "held", code: "call_603_path_unverified" };

  let route: ReviewedEmmaChannel | null;
  try { route = await ports.readReviewedChannel(); }
  catch { return { state: "held", code: "slack_route_unavailable" }; }
  if (!route || route.teamId !== OPENFOLK_TEAM || route.name !== "ai-emma" ||
    !channel.test(route.channelId) || !route.member || route.archived || route.shared)
    return { state: "held", code: "slack_route_unverified" };

  const reference = source.providerReference;
  // No caller name, number, address, transcript, audio or public link is
  // copied into notification content. Recipients open the private mailbox.
  const subject = "Drummonds emergency voicemail in shared mailbox 603";
  const text = `A message is in Drummonds shared emergency mailbox 603. Reference: ${reference}. Please review it through the authorised mailbox. This notice does not confirm engineer attendance.`;
  const emails = await Promise.all(recipients.map(async recipient => ({
    kind: "email" as const, deliveryId: await deliveryId(sourceId, reference, recipient),
    tenantId, sourceId, mailboxMessageId: reference, recipient, subject, text,
  }))) as [Email603Intent, Email603Intent];
  const slack = {
    kind: "slack" as const, deliveryId: await deliveryId(sourceId, reference, route.channelId),
    tenantId, sourceId, mailboxMessageId: reference, channelId: route.channelId,
    text: `Drummonds emergency mailbox 603 has a message for review. Reference: ${reference}. No engineer attendance or delivery is implied.`,
  };
  return { state: "prepared", sourceId, core, emails, slack };
}

/** Read provider-confirmed delivery receipts for the frozen three intents.
 * No transport is invoked and an accepted email or queued Slack message is
 * insufficient. A later durable outbox/sender must store each intent exactly
 * once before calling the existing approved email and Slack transports. */
export async function readEmergency603Delivery(sourceId: string, ports: Delivery603Ports) {
  const prepared = await receivePublishedEmergency603(sourceId, ports);
  if (prepared.state === "held") return { state: "not_verified" as const, missing: [prepared.code] };
  let emailReceipts: EmergencyFallbackEvidence["emailReceipts"];
  let slackReceipt: EmergencyFallbackEvidence["slackReceipt"];
  try {
    const [rob, tony, slack] = await Promise.all([
      ports.readEmailReceipt(prepared.emails[0]),
      ports.readEmailReceipt(prepared.emails[1]),
      ports.readSlackReceipt(prepared.slack),
    ]);
    emailReceipts = [rob, tony].filter((r): r is NonNullable<typeof r> => !!r);
    slackReceipt = slack ?? undefined;
  } catch { return { state: "not_verified" as const, missing: ["delivery_read_unavailable"] }; }
  return assessEmergencyFallbackProof({
    ...prepared.core, emailReceipts, slackReceipt,
    reviewedSlackChannelId: prepared.slack.channelId,
  });
}
