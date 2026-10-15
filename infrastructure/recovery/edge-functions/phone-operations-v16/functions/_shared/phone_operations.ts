// ServiceOS — provider-neutral phone operations classification (PURE).
// No network, database or secret access. Edge functions and tests share this logic.

export type PhoneHealthStatus = "healthy" | "degraded" | "failed" | "unknown";
export type PhoneAlertSeverity = "info" | "warning" | "critical";

export interface PhoneSignal {
  provider: string;
  component: "phone_ingress" | "ai_receptionist" | "phone_transfers" | "phone_notifications";
  status: PhoneHealthStatus;
  alertKey: string | null;
  severity: PhoneAlertSeverity | null;
  title: string | null;
  detail: string | null;
  providerEventRef: string | null;
  metadata: Record<string, unknown>;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function lower(v: unknown): string {
  return text(v)?.toLowerCase() ?? "";
}

function hasTransferFailure(message: Record<string, unknown>): boolean {
  const artifact = obj(message.artifact);
  const messages = Array.isArray(artifact.messages) ? artifact.messages : [];
  const haystack = JSON.stringify(messages).toLowerCase();
  return (
    haystack.includes("transfer") &&
    ["failed", "error", "unavailable", "did not complete"].some((word) => haystack.includes(word))
  );
}

export function classifyVapiServerMessage(payload: unknown): PhoneSignal {
  const root = obj(payload);
  const message = obj(root.message);
  const call = obj(message.call);
  const type = lower(message.type);
  const callId = text(call.id);
  const endedReason = lower(message.endedReason ?? call.endedReason);
  const base = {
    provider: "vapi",
    providerEventRef: callId,
    metadata: {
      message_type: type || "unknown",
      ended_reason: endedReason || null,
    },
  };

  if (type === "hang") {
    return {
      ...base,
      component: "ai_receptionist",
      status: "failed",
      alertKey: `vapi-hang:${callId ?? "unknown"}`,
      severity: "critical",
      title: "AI receptionist stopped responding",
      detail: "Vapi emitted a hang notification during a call.",
    };
  }

  if (type === "status-update") {
    const status = lower(message.status ?? call.status);
    if (["ringing", "in-progress", "forwarding"].includes(status)) {
      return {
        ...base,
        component: status === "forwarding" ? "phone_transfers" : "phone_ingress",
        status: "healthy",
        alertKey: null,
        severity: null,
        title: null,
        detail: null,
        metadata: { ...base.metadata, call_status: status },
      };
    }
  }

  if (type === "end-of-call-report") {
    if (hasTransferFailure(message)) {
      return {
        ...base,
        component: "phone_transfers",
        status: "failed",
        alertKey: `vapi-transfer-failed:${callId ?? "unknown"}`,
        severity: "critical",
        title: "Call transfer failed",
        detail: "The AI receptionist selected a transfer, but it did not complete.",
      };
    }
    const failureReason =
      endedReason.includes("error") ||
      endedReason.includes("failed") ||
      endedReason.includes("provider") ||
      endedReason.includes("pipeline");
    return {
      ...base,
      component: failureReason ? "ai_receptionist" : "phone_ingress",
      status: failureReason ? "failed" : "healthy",
      alertKey: failureReason ? `vapi-call-failed:${callId ?? "unknown"}` : null,
      severity: failureReason ? "critical" : null,
      title: failureReason ? "AI call ended with an error" : null,
      detail: failureReason ? `Vapi ended the call with reason: ${endedReason || "unknown"}.` : null,
    };
  }

  return {
    ...base,
    component: "ai_receptionist",
    status: "unknown",
    alertKey: null,
    severity: null,
    title: null,
    detail: null,
  };
}

export function classifyTwilioAlarm(payload: unknown): PhoneSignal {
  const root = obj(payload);
  const code = text(root.ErrorCode ?? root.error_code);
  const description = text(root.Description ?? root.alert_text) ?? "Twilio reported an error.";
  const eventRef = text(root.AppMonitorTriggerSid ?? root.sid ?? root.resourceSid);
  return {
    provider: "twilio",
    component: "phone_ingress",
    status: "failed",
    alertKey: `twilio:${code ?? "unknown"}:${eventRef ?? "account"}`,
    severity: "critical",
    title: code ? `Twilio error ${code}` : "Twilio phone error",
    detail: description,
    providerEventRef: eventRef,
    metadata: { error_code: code },
  };
}

export function safeAlertMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const blocked = /(transcript|recording|authorization|token|secret|password|phone|caller|callee)/i;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.test(key)));
}
