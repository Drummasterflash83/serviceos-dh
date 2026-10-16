import { readSlackHistoryPage, type SlackHistoryScope } from "./slack_history.ts";
import { readSlackThreadPage } from "./slack_thread_history.ts";

/** A signed event is only a wake-up hint. This bounded fetch, rather than the
 * event payload, supplies any source record offered to the existing writer. */
export type PendingSlackEvent = {
  tenantId: string;
  eventId: string;
  teamId: string;
  channelId: string;
  sourceTs: string;
  threadTs: string | null;
  kind: "message_hint" | "correction_hint";
  correction: "changed" | "deleted" | null;
};
export type SlackEventSourceOutcome = {
  eventId: string;
  sourceTs: string;
  channelId: string;
  parentTs: string | null;
  outcome: "present" | "absent_after_delete";
  records: Record<string, unknown>[];
};
export type SlackEventSourcePorts = {
  authorised: () => Promise<boolean>;
  request: (method: "auth.test" | "conversations.info" |
    "conversations.history" | "conversations.replies", args: Record<string, string>) => Promise<unknown>;
  expectedIdentity: { kind: "user" | "bot"; userId?: string };
};

const ts = /^\d{10,12}\.\d{1,6}$/;
const eventId = /^Ev[A-Za-z0-9]{4,100}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const micros = (value: string) => {
  const [seconds, fraction] = value.split(".");
  return BigInt(seconds) * 1000000n + BigInt(fraction.padEnd(6, "0"));
};
const stamp = (value: bigint) => `${value / 1000000n}.${(value % 1000000n).toString().padStart(6, "0")}`;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export async function fetchApprovedSlackEventSource(
  hint: PendingSlackEvent,
  ports: SlackEventSourcePorts,
): Promise<SlackEventSourceOutcome> {
  if (!uuid.test(hint.tenantId) || !eventId.test(hint.eventId) ||
      !/^T[A-Z0-9]{1,63}$/.test(hint.teamId) ||
      !/^C[A-Z0-9]{1,63}$/.test(hint.channelId) ||
      !ts.test(hint.sourceTs) ||
      (hint.threadTs !== null && (!ts.test(hint.threadTs) ||
        micros(hint.threadTs) > micros(hint.sourceTs))) ||
      (hint.kind === "message_hint" && hint.correction !== null) ||
      (hint.kind === "correction_hint" &&
        hint.correction !== "changed" && hint.correction !== "deleted") ||
      !["user", "bot"].includes(ports.expectedIdentity.kind) ||
      (ports.expectedIdentity.kind === "user" &&
        (typeof ports.expectedIdentity.userId !== "string" ||
          !/^U[A-Z0-9]{1,63}$/.test(ports.expectedIdentity.userId))))
    throw Error("slack_event_source_invalid");
  if (!await ports.authorised()) throw Error("slack_event_authority_unavailable");
  const auth = await ports.request("auth.test", {});
  if (!object(auth) || auth.ok !== true || auth.team_id !== hint.teamId ||
      (ports.expectedIdentity.kind === "user"
        ? auth.user_id !== ports.expectedIdentity.userId || !!auth.bot_id
        : typeof auth.bot_id !== "string" || !/^B[A-Z0-9]{1,63}$/.test(auth.bot_id)))
    throw Error("slack_event_identity_changed");
  const info = await ports.request("conversations.info", { channel: hint.channelId });
  const channel = object(info) ? info.channel : null;
  if (!object(info) || info.ok !== true || !object(channel) ||
      channel.id !== hint.channelId || channel.is_channel !== true ||
      channel.is_private !== false || channel.is_im === true ||
      channel.is_mpim === true || channel.is_archived === true)
    throw Error("slack_event_public_visibility_unconfirmed");
  if (!await ports.authorised()) throw Error("slack_event_authority_changed");

  const point = micros(hint.sourceTs);
  if (point < 1n) throw Error("slack_event_source_invalid");
  const scope: SlackHistoryScope = {
    tenantId: hint.tenantId, teamId: hint.teamId,
    channelIds: [hint.channelId], oldest: stamp(point - 1n),
    latest: stamp(point + 1n), consentReference: `learn-slack-event:${hint.eventId}`,
    pageLimit: 15,
  };
  const page = hint.threadTs === null
    ? await readSlackHistoryPage(scope, hint.tenantId, hint.channelId, null,
      (method, args) => ports.request(method as "conversations.history", args as Record<string, string>))
    : await readSlackThreadPage({ ...scope, parentTimestamp: hint.threadTs },
      hint.tenantId, hint.channelId, null,
      (method, args) => ports.request(method as "conversations.replies", args as Record<string, string>));
  if (page.nextCursor !== null || !await ports.authorised())
    throw Error("slack_event_source_incomplete");
  const records = page.records.filter((row) => row.provider_timestamp === hint.sourceTs);
  if (page.records.some((row) => row.provider_timestamp !== hint.sourceTs) || records.length > 1)
    throw Error("slack_event_source_window_unexpected");
  if (hint.correction === "deleted") {
    if (records.length !== 0) throw Error("slack_event_delete_unconfirmed");
    return { eventId: hint.eventId, sourceTs: hint.sourceTs,
      channelId: hint.channelId, parentTs: hint.threadTs,
      outcome: "absent_after_delete", records: [] };
  }
  if (records.length !== 1) throw Error("slack_event_source_not_visible_yet");
  if (hint.correction === "changed") {
    const edited = records[0].provider_payload?.edited;
    if (!object(edited) || typeof edited.ts !== "string" || !ts.test(edited.ts) ||
        micros(edited.ts) < point)
      throw Error("slack_event_edit_unconfirmed");
  }
  return { eventId: hint.eventId, sourceTs: hint.sourceTs,
    channelId: hint.channelId, parentTs: hint.threadTs,
    outcome: "present", records };
}
