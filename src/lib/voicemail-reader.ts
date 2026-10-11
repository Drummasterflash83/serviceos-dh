import type { Mailbox, VoicemailMessage } from "./voicemails.ts";

const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const text = (v: unknown) => typeof v === "string";
const nullableText = (v: unknown) => v === null || text(v);
const stamp = (v: unknown) => text(v) && Number.isFinite(Date.parse(v as string));
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const fail = () => {
  throw Error("Saved voicemail data could not be verified. Refresh to try again.");
};

/** The summary RPC is SECURITY INVOKER: mailbox visibility and counts use caller RLS. */
export function parseVoicemailMailboxes(raw: unknown): Mailbox[] {
  if (!Array.isArray(raw)) return fail();
  const ids = new Set<string>();
  return raw.map((r) => {
    if (
      !r ||
      !uuid(r.id) ||
      ids.has(r.id) ||
      !text(r.display_name) ||
      !text(r.extension) ||
      !nullableText(r.notification_email) ||
      ![null, true, false].includes(r.email_enabled) ||
      !["awaiting_connection", "current", "error"].includes(r.sync_state) ||
      !(r.last_synced_at === null || stamp(r.last_synced_at)) ||
      (r.sync_state === "current" && r.last_synced_at === null) ||
      !count(r.message_count)
    )
      return fail();
    ids.add(r.id);
    return {
      id: r.id,
      display_name: r.display_name,
      extension: r.extension,
      notification_email: r.notification_email,
      email_enabled: r.email_enabled,
      sync_state: r.sync_state,
      last_synced_at: r.last_synced_at,
      message_count: r.message_count,
    };
  });
}

export const VOICEMAIL_PAGE_SIZE = 20;
export const VOICEMAIL_MESSAGE_FIELDS =
  "id,tenant_id,mailbox_id,caller_number,caller_name,received_at,duration_seconds,transcript,email_status,email_evidence_at,email_recipient,recording_available";

/** Unknown counts and truncated/mis-scoped responses must never become an empty inbox. */
export function parseVoicemailMessages(
  raw: unknown,
  total: unknown,
  tenant: string,
  mailbox: string,
  page: number,
): { rows: VoicemailMessage[]; count: number } {
  if (
    !uuid(tenant) ||
    !uuid(mailbox) ||
    !count(page) ||
    !Number.isSafeInteger(page * VOICEMAIL_PAGE_SIZE) ||
    !Array.isArray(raw) ||
    !count(total) ||
    raw.length !== Math.min(VOICEMAIL_PAGE_SIZE, Math.max(0, total - page * VOICEMAIL_PAGE_SIZE))
  )
    return fail();
  const ids = new Set<string>();
  const rows = raw.map((r) => {
    if (
      !r ||
      !uuid(r.id) ||
      ids.has(r.id) ||
      r.tenant_id !== tenant ||
      r.mailbox_id !== mailbox ||
      !nullableText(r.caller_number) ||
      !nullableText(r.caller_name) ||
      !stamp(r.received_at) ||
      !(r.duration_seconds === null || count(r.duration_seconds)) ||
      !nullableText(r.transcript) ||
      !["unknown", "pending", "sent", "delivered", "failed"].includes(r.email_status) ||
      !(r.email_evidence_at === null || stamp(r.email_evidence_at)) ||
      (r.email_status !== "unknown" && r.email_evidence_at === null) ||
      !nullableText(r.email_recipient) ||
      typeof r.recording_available !== "boolean"
    )
      return fail();
    ids.add(r.id);
    const { tenant_id: _, ...message } = r;
    return message as VoicemailMessage;
  });
  return { rows, count: total };
}
