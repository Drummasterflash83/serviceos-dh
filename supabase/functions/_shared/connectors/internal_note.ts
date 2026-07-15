// Internal note connector — a second SAFE adapter proving a distinct capability
// flows through the SAME universal executor using configuration only.
//
// It records an internal platform note with NO external side effect. In v1 the note
// is captured immutably in the execution attempt + operational Outcome the executor
// appends (there is no external surface and no separate mutable notes table). A
// future version may project the note to an internal surface; the contract is
// unchanged. Deterministic and idempotent by the executor's idempotency key.

import type { ConnectorExecutionResult } from "../intelligence/automation_guards.ts";
import type {
  AutomationConnectorAdapter,
  ConnectorExecutionInput,
  ValidationResult,
} from "./index.ts";

function sanitizedNote(parameters: Record<string, unknown>): string | null {
  const note = parameters?.note;
  if (typeof note !== "string") return null;
  return note.slice(0, 2000); // bounded; no unbounded content in the audit record
}

export const internalNoteAdapter: AutomationConnectorAdapter = {
  connectorType: "internal",
  supportedIntentTypes: ["record_internal_note"],

  validate(input: ConnectorExecutionInput): ValidationResult {
    if (input.intentType !== "record_internal_note") {
      return {
        ok: false,
        errorCode: "unsupported_operation",
        errorMessage: "unsupported intent type",
      };
    }
    if (input.capabilityKey !== "internal.create_note") {
      return { ok: false, errorCode: "capability_mismatch", errorMessage: "capability mismatch" };
    }
    if (sanitizedNote(input.parameters) === null) {
      return { ok: false, errorCode: "payload_invalid", errorMessage: "note text required" };
    }
    return { ok: true };
  },

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    await Promise.resolve();
    return {
      outcome: "succeeded",
      externalReference: `note-${input.idempotencyKey}`,
      result: { note: sanitizedNote(input.parameters) },
      retryable: false,
      evidenceRefs: [`internal_note:${input.idempotencyKey}`],
    };
  },
};
