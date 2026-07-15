// Controlled test connector — the first, deliberately SAFE adapter.
//
// It records a deterministic successful execution with a synthetic external
// reference and NO external side effect whatsoever. Its only purpose is to prove the
// full executor lifecycle (claim → guard → execute → attempt → outcome → events) and
// idempotency end-to-end without touching any real system. Deterministic: the same
// idempotency key always yields the same synthetic reference, so a retry cannot
// produce a different "execution".

import type { ConnectorExecutionResult } from "../intelligence/automation_guards.ts";
import type {
  AutomationConnectorAdapter,
  ConnectorExecutionInput,
  ValidationResult,
} from "./index.ts";

export const controlledTestAdapter: AutomationConnectorAdapter = {
  connectorType: "controlled_test",
  supportedIntentTypes: ["record_controlled_execution"],

  validate(input: ConnectorExecutionInput): ValidationResult {
    if (input.intentType !== "record_controlled_execution") {
      return {
        ok: false,
        errorCode: "unsupported_operation",
        errorMessage: "unsupported intent type",
      };
    }
    if (input.capabilityKey !== "internal.record_execution") {
      return { ok: false, errorCode: "capability_mismatch", errorMessage: "capability mismatch" };
    }
    return { ok: true };
  },

  async execute(input: ConnectorExecutionInput): Promise<ConnectorExecutionResult> {
    // Deterministic, side-effect-free "execution": the synthetic reference is a pure
    // function of the idempotency key, so re-running is provably the same operation.
    await Promise.resolve();
    return {
      outcome: "succeeded",
      externalReference: `ctrl-${input.idempotencyKey}`,
      result: { recorded: true, note: (input.parameters?.note as string | undefined) ?? null },
      retryable: false,
      evidenceRefs: [`controlled_test:${input.idempotencyKey}`],
    };
  },
};
