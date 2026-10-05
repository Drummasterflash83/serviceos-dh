export type EmailState = "unknown" | "pending" | "sent" | "delivered" | "failed";
export type Mailbox = {
  id: string;
  display_name: string;
  extension: string;
  notification_email: string | null;
  email_enabled: boolean | null;
  last_synced_at: string | null;
  sync_state: "awaiting_connection" | "current" | "error";
  message_count: number;
};
export type VoicemailMessage = {
  id: string;
  mailbox_id: string;
  caller_number: string | null;
  caller_name: string | null;
  received_at: string;
  duration_seconds: number | null;
  transcript: string | null;
  email_status: EmailState;
  email_evidence_at: string | null;
  email_recipient: string | null;
  recording_available: boolean;
};
/** Saved-message counts are not a provider-inbox count until its source is verified. */
export function voicemailCountLabel(mailbox: Mailbox) {
  const count = Number.isFinite(mailbox.message_count) && mailbox.message_count >= 0
    ? mailbox.message_count
    : null;
  const synced = mailbox.sync_state === "current" && !!mailbox.last_synced_at &&
    Number.isFinite(Date.parse(mailbox.last_synced_at));
  if (count !== null && (count > 0 || synced)) return { value: String(count), label: "saved" };
  return {
    value: "—",
    label: mailbox.sync_state === "error" ? "Check sync" : "Awaiting sync",
  };
}

export function voicemailConnectionNotice(mailboxes: Mailbox[]) {
  if (!mailboxes.length) return null;
  const verified = mailboxes.filter((mailbox) => mailbox.sync_state === "current" &&
    !!mailbox.last_synced_at && Number.isFinite(Date.parse(mailbox.last_synced_at))).length;
  const failed = mailboxes.some((mailbox) => mailbox.sync_state === "error");
  if (verified === mailboxes.length) return null;
  return {
    title: failed
      ? "Voicemail sync needs attention"
      : verified === 0 ? "Birchills messages are not connected yet" : "Some mailboxes are still being connected",
    detail: "Keep using your existing phone mailbox while OpenFolk completes the connection. Saved messages remain available here; a dash does not mean your phone mailbox is empty.",
  };
}
export function emailLabel(status: EmailState) {
  return (
    {
      unknown: "Email status unconfirmed",
      pending: "Email queued",
      sent: "Email sent",
      delivered: "Email delivered",
      failed: "Email needs attention",
    }[status] ?? "Email status unconfirmed"
  );
}
export function voicemailDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "Duration unavailable";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
export function voicemailDate(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
