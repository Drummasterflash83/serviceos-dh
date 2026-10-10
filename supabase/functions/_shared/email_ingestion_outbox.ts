import {
  applyEmailTransition,
  EmailTransitionUnconfirmed,
  validateEmailTransition,
  type EmailProtocolClient,
  type EmailScope,
  type EmailTransition,
  type EmailTransitionResult,
} from "./email_ingestion_protocol.ts";

/** Persist first, then atomically apply the saved document and its settlement.
 * A failed prepare/apply response remains unknown: recover the pending request
 * for the same attempt, or replay this exact request. Never regenerate its ID.
 */
export async function applyDurableEmailTransition(
  db: EmailProtocolClient,
  request: EmailTransition,
): Promise<EmailTransitionResult> {
  validateEmailTransition(request);
  const frozen = structuredClone(request);
  const proxy: EmailProtocolClient = {
    async rpc(name) {
      if (name !== "email_ingestion_transition_v2") throw new EmailTransitionUnconfirmed();
      return db.rpc("learn_email_transition_apply", {
        p_tenant: frozen.tenantId,
        p_account: frozen.accountId,
        p_stream: frozen.stream,
        p_attempt: frozen.attemptId,
        p_request: frozen.transitionId,
      });
    },
  };
  return applyEmailTransition(proxy, frozen, async (document) => {
    try {
      const { data, error } = await db.rpc("learn_email_transition_prepare", {
        p_document: document,
      });
      if (error) throw new EmailTransitionUnconfirmed();
      validateEmailTransition(data as EmailTransition);
      return data as EmailTransition;
    } catch {
      throw new EmailTransitionUnconfirmed();
    }
  });
}

/** Service worker recovery only. The attempt must itself already be durably
 * associated with its job. A null result does not prove mailbox coverage.
 */
export async function pendingEmailTransition(
  db: EmailProtocolClient,
  scope: EmailScope,
): Promise<EmailTransition | null> {
  // Validate the scope without inventing a transition or touching the database.
  validateEmailTransition({
    ...scope,
    transitionId: scope.attemptId,
    operation: "claim",
    expectedGeneration: null,
    expectedRevision: null,
    expectedOwner: null,
    payload: { recovery: null },
  });
  try {
    const { data, error } = await db.rpc("learn_email_transition_pending", {
      p_tenant: scope.tenantId,
      p_account: scope.accountId,
      p_stream: scope.stream,
      p_attempt: scope.attemptId,
    });
    if (error) throw new EmailTransitionUnconfirmed();
    if (data === null) return null;
    validateEmailTransition(data as EmailTransition);
    const r = data as EmailTransition;
    if (
      r.tenantId !== scope.tenantId ||
      r.accountId !== scope.accountId ||
      r.stream !== scope.stream ||
      r.attemptId !== scope.attemptId
    )
      throw new EmailTransitionUnconfirmed();
    return structuredClone(r);
  } catch {
    throw new EmailTransitionUnconfirmed();
  }
}
