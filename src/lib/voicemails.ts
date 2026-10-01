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
