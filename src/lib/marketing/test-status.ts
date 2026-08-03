// Customer-facing test-send status vocabulary.
//
// The engine speaks in delivery statuses (queued / executing / submitted /
// failed / unknown) and intent states. Customers need one honest journey:
//
//   Requested → Paused by workspace mode | Processing → Submitted to provider
//                                                     | Failed
//                                                     | Unknown — needs review
//
// This module maps the authoritative engine facts to that vocabulary WITHOUT
// changing them: "submitted" still means the provider accepted the request —
// never inbox delivery — and a queued test in a non-sending workspace mode is
// truthfully "paused", not lost. The raw engine status stays available for the
// audit/history views.

export type CustomerTestStatusKey =
  "requested" | "paused_by_mode" | "processing" | "submitted" | "failed" | "unknown" | "cancelled";

export interface CustomerTestStatus {
  key: CustomerTestStatusKey;
  label: string;
  tone: "ok" | "warn" | "err" | "muted";
  /** one plain-language sentence about what happens next */
  hint: string;
  /** true when nothing further will happen without someone acting */
  terminal: boolean;
}

export function customerTestStatus(d: {
  status: "queued" | "executing" | "submitted" | "failed" | "unknown";
  intent_status?: string | null;
  failure_class?: string | null;
  modePermitsSend: boolean;
}): CustomerTestStatus {
  if (d.status === "submitted") {
    return {
      key: "submitted",
      label: "Submitted to provider",
      tone: "ok",
      hint: "The email provider accepted it. Check the recipient's inbox (and spam folder) — provider acceptance is not inbox proof.",
      terminal: true,
    };
  }
  if (d.status === "failed") {
    const cancelled = d.intent_status === "cancelled" || d.failure_class === "cancelled";
    if (cancelled) {
      return {
        key: "cancelled",
        label: "Cancelled before sending",
        tone: "muted",
        hint: "This test was withdrawn before any email left ServiceOS. Nothing was sent.",
        terminal: true,
      };
    }
    return {
      key: "failed",
      label: "Failed",
      tone: "err",
      hint: "The send did not go through. Nothing reached the recipient — fix the cause and send a fresh test.",
      terminal: true,
    };
  }
  if (d.status === "unknown") {
    return {
      key: "unknown",
      label: "Unknown — needs review",
      tone: "warn",
      hint: "The provider's answer was lost, so ServiceOS cannot say whether this was sent. It is held for review and will never be silently re-sent.",
      terminal: true,
    };
  }
  if (d.status === "executing") {
    return {
      key: "processing",
      label: "Processing",
      tone: "warn",
      hint: "ServiceOS is handing this to the email provider now.",
      terminal: false,
    };
  }
  // queued
  if (d.intent_status === "cancelled") {
    return {
      key: "cancelled",
      label: "Cancelled before sending",
      tone: "muted",
      hint: "This test was withdrawn before any email left ServiceOS. Nothing was sent.",
      terminal: true,
    };
  }
  if (!d.modePermitsSend) {
    return {
      key: "paused_by_mode",
      label: "Paused by workspace mode",
      tone: "warn",
      hint: "ServiceOS has saved this test safely, but this workspace is not yet allowed to send real email. Nothing leaves the platform until an operator raises the workspace mode.",
      terminal: false,
    };
  }
  return {
    key: "requested",
    label: "Waiting to send",
    tone: "muted",
    hint: "Saved and queued — ServiceOS sends it within about a minute.",
    terminal: false,
  };
}
