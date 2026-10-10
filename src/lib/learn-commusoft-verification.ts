import {
  parseVerificationReceipt,
  validateVerificationRequest,
} from "../../supabase/functions/_shared/commusoft/verification_contract.ts";
import type {
  VerificationRequest,
  VerificationReceipt,
} from "../../supabase/functions/_shared/commusoft/verification_contract.ts";
import type { OperatorInputClient } from "./learn-operator-inputs.ts";
export { validateVerificationRequest };
export type { VerificationRequest, VerificationReceipt };

export type VerificationClient = OperatorInputClient & {
  functions: {
    invoke: (
      name: string,
      options: { body: Record<string, unknown> },
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
};
/** Save the non-secret request before applying. Checking/cancelling remains a
 * direct authenticated receipt operation even if the execution endpoint is down.
 */
export async function resolveCommusoftVerification(
  db: VerificationClient,
  request: VerificationRequest,
  mode: "apply" | "check" | "cancel",
): Promise<{ receipt: VerificationReceipt; retryAt: number | null }> {
  validateVerificationRequest(request);
  if (!["apply", "check", "cancel"].includes(mode))
    throw Error("Choose a connection check action.");
  try {
    let raw: unknown;
    let retryAt: number | null = null;
    if (mode === "apply") {
      const reply = await db.functions.invoke("learn-commusoft-verify", {
        body: { request, mode },
      });
      if (reply.error || !reply.data || typeof reply.data !== "object" || Array.isArray(reply.data))
        throw Error();
      const data = reply.data as Record<string, unknown>;
      raw = data.receipt;
      if (data.retry_at !== undefined) {
        if (!Number.isSafeInteger(data.retry_at) || Number(data.retry_at) < 0) throw Error();
        retryAt = Number(data.retry_at);
      }
    } else {
      const reply = await db.rpc("learn_commusoft_verify_request", {
        p_tenant: request.tenantId,
        p_request: request.requestId,
        p_actor: request.actorId,
        p_definition: request.definition,
        p_mode: mode,
      });
      if (reply.error) throw Error();
      raw = reply.data;
    }
    const receipt = parseVerificationReceipt(raw, request);
    if (mode !== "check" && receipt.state === "pending") throw Error();
    return { receipt, retryAt };
  } catch {
    throw Error(
      "The connection check was not confirmed. Keep this request and check its recorded result before trying again.",
    );
  }
}
