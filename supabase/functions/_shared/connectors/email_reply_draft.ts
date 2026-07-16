// Email reply-draft connector — a SAFE, SANDBOXED capability that prepares an APPROVED
// customer reply artifact with NO external transmission (external_side_effect = false).
//
// It is deliberately dumb: it validates its operation, resolves the recipient from the
// source interaction server-side, and returns the immutable ReplyDraft the universal
// executor records on the (append-only) execution attempt. It NEVER transmits anything,
// never decides approval/authority/mode, never mutates lifecycle tables or publishes
// events. Actual transmission is a FUTURE, separate transmitting connector — the
// intelligence layer is unchanged when it lands.

import type { ConnectorExecutionResult } from "../intelligence/automation_guards.ts";
import type {
  AutomationConnectorAdapter,
  ConnectorExecutionContext,
  ConnectorExecutionInput,
  ValidationResult,
} from "./index.ts";
import { buildReplyDraft } from "../reply_draft.ts";

// The drafted reply body may arrive as `body` or (from the shared note field) `note`.
function bodyOf(p: Record<string, unknown>): string | null {
  const b = p?.body ?? p?.note;
  return typeof b === "string" && b.trim() ? b : null;
}
function sourceInteractionOf(p: Record<string, unknown>): string | null {
  const s = p?.source_interaction;
  return typeof s === "string" && s ? s : null;
}

export const emailReplyDraftAdapter: AutomationConnectorAdapter = {
  connectorType: "internal", // a controlled internal draft — no external system
  adapterVersion: "1",
  supportedIntentTypes: ["draft_email_reply"],

  validate(input: ConnectorExecutionInput): ValidationResult {
    if (input.intentType !== "draft_email_reply") {
      return {
        ok: false,
        errorCode: "unsupported_operation",
        errorMessage: "unsupported intent type",
      };
    }
    if (input.capabilityKey !== "email.reply_draft") {
      return { ok: false, errorCode: "capability_mismatch", errorMessage: "capability mismatch" };
    }
    if (!bodyOf(input.parameters)) {
      return { ok: false, errorCode: "payload_invalid", errorMessage: "reply body required" };
    }
    if (!sourceInteractionOf(input.parameters)) {
      return {
        ok: false,
        errorCode: "payload_invalid",
        errorMessage: "source_interaction required",
      };
    }
    return { ok: true };
  },

  async execute(
    input: ConnectorExecutionInput,
    context: ConnectorExecutionContext,
  ): Promise<ConnectorExecutionResult> {
    const sourceInteraction = sourceInteractionOf(input.parameters);
    const body = bodyOf(input.parameters);
    if (!sourceInteraction || !body) {
      return {
        outcome: "failed_permanent",
        errorCode: "payload_invalid",
        errorMessage: "invalid reply payload",
        retryable: false,
      };
    }
    // Resolve the recipient + original subject from the source interaction (tenant-scoped,
    // read-only). The capability handles addressing; the intelligence layer never does.
    const { data: it } = await context.supabaseAdmin
      .from("interactions")
      .select("from_address, subject")
      .eq("id", sourceInteraction)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();
    const provenance = Array.isArray(input.parameters?.response_provenance)
      ? (input.parameters.response_provenance as Array<{
          kind: string;
          ref: string;
          note?: string;
        }>)
      : [];
    const built = buildReplyDraft({
      channel: "email",
      recipient: (it?.from_address as string | null) ?? null,
      originalSubject: (it?.subject as string | null) ?? null,
      body,
      sourceInteraction,
      provenance,
    });
    if (!built.ok) {
      return {
        outcome: "failed_permanent",
        errorCode: built.error === "no_recipient" ? "no_recipient" : "payload_invalid",
        errorMessage: built.error,
        retryable: false,
      };
    }
    // Immutable APPROVED reply artifact — recorded on the execution attempt. No transmission.
    return {
      outcome: "succeeded",
      externalReference: `reply-draft-${input.idempotencyKey}`,
      result: built.draft as unknown as Record<string, unknown>,
      retryable: false,
      evidenceRefs: [`email_reply_draft:${input.idempotencyKey}`],
    };
  },
};
