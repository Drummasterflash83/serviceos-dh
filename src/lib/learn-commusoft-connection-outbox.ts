import {
  resolveCommusoftSetup,
  validateCommusoftSetup,
  type CommusoftSetupRequest,
  type CommusoftSetupReceipt,
} from "./learn-commusoft-connection.ts";
import {
  resolveCommusoftVerification,
  validateVerificationRequest,
  type VerificationRequest,
  type VerificationReceipt,
  type VerificationClient,
} from "./learn-commusoft-verification.ts";
import {
  inputOutboxKey,
  connectionOutboxKey,
  captureOutboxKey,
  commusoftRecurringOutboxKey,
  type InputScope,
  type InputLock,
  type RequestStore,
} from "./learn-operator-request-scope.ts";
import type { OperatorInputClient } from "./learn-operator-inputs.ts";

export type ConnectionControlClient = OperatorInputClient &
  Partial<Pick<VerificationClient, "functions">>;
export type SavedConnectionRequest = {
  version: 1;
  backend: string;
  request: CommusoftSetupRequest | VerificationRequest;
};
export type ConnectionResult =
  | { kind: "configure_commusoft"; receipt: CommusoftSetupReceipt }
  | { kind: "verify_commusoft"; receipt: VerificationReceipt; retryAt: number | null };
export { connectionOutboxKey };

function checked(s: InputScope, value: unknown): SavedConnectionRequest {
  inputOutboxKey(s);
  const v = value as SavedConnectionRequest;
  if (
    !v ||
    typeof v !== "object" ||
    Object.keys(v).length !== 3 ||
    v.version !== 1 ||
    v.backend !== s.backend ||
    v.request?.tenantId !== s.tenantId ||
    v.request?.actorId !== s.actorId
  )
    throw Error("The saved connection request could not be verified. It has been retained.");
  if (v.request.definition?.kind === "configure_commusoft") validateCommusoftSetup(v.request);
  else validateVerificationRequest(v.request);
  return structuredClone(v);
}
export function readSavedConnection(
  store: RequestStore,
  s: InputScope,
): SavedConnectionRequest | null {
  const raw = store.getItem(connectionOutboxKey(s));
  if (raw === null) return null;
  if (raw.length > 15000)
    throw Error("The saved connection request needs review. It has been retained.");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error("The saved connection request could not be read. It has been retained.");
  }
  return checked(s, value);
}

/** Uses the same browser lock as module/import actions. Only request metadata is
 * retained; a replacement credential is a transient argument, never serialized.
 * Approved/running/expired checks stay saved until a recorded result or explicit
 * cancellation. Time passing never clears or re-executes an uncertain request.
 */
export async function resolveSavedConnection(
  db: ConnectionControlClient,
  store: RequestStore,
  lock: InputLock,
  s: InputScope,
  input: SavedConnectionRequest,
  mode: "apply" | "check" | "cancel",
  allowed: () => boolean,
  apiKey?: string,
): Promise<ConnectionResult> {
  const value = checked(s, input),
    key = connectionOutboxKey(s),
    encoded = JSON.stringify(value);
  if (
    !["apply", "check", "cancel"].includes(mode) ||
    (apiKey !== undefined &&
      (mode !== "apply" ||
        value.request.definition.kind !== "configure_commusoft" ||
        value.request.definition.credential_mode !== "replace"))
  )
    throw Error("Credentials are accepted only for an explicit connection replacement.");
  return lock(inputOutboxKey(s), async () => {
    if (!allowed()) throw Error("Operator context changed. Reopen this company before continuing.");
    if (mode === "apply" && store.getItem(commusoftRecurringOutboxKey(s)) !== null)
      throw Error("Resolve the saved ongoing Commusoft capture request first.");
    if (mode === "apply" && store.getItem(captureOutboxKey(s)) !== null)
      throw Error("Resolve the saved capture request before changing a connection.");
    if (store.getItem(inputOutboxKey(s)) !== null)
      throw Error("Resolve the saved module or import request first.");
    const saved = readSavedConnection(store, s);
    if (saved && JSON.stringify(saved) !== encoded)
      throw Error("Resolve the existing connection request before starting another.");
    if (!saved && mode !== "apply")
      throw Error("The saved connection request changed. Refresh before continuing.");
    store.setItem(key, encoded);
    if (store.getItem(key) !== encoded)
      throw Error("The connection request could not be saved locally. Nothing was sent.");
    if (!allowed()) throw Error("Operator context changed; connection request retained.");
    let result: ConnectionResult;
    if (value.request.definition.kind === "configure_commusoft") {
      const request = value.request as CommusoftSetupRequest;
      let receipt = await resolveCommusoftSetup(db, request, "check");
      if (receipt.state === "pending" && mode !== "check") {
        if (!allowed()) throw Error("Operator context changed; connection request retained.");
        if (mode === "apply" && request.definition.credential_mode === "replace" && !apiKey)
          throw Error(
            "No result is recorded yet. Enter the credential again to retry this saved request, or cancel it.",
          );
        receipt = await resolveCommusoftSetup(db, request, mode, apiKey);
      }
      result = { kind: "configure_commusoft", receipt };
    } else {
      const request = value.request as VerificationRequest;
      // Check/cancel do not need a running execution endpoint or functions client.
      const client: VerificationClient = {
        rpc: (name, args) => db.rpc(name, args),
        functions: db.functions ?? {
          invoke: async () => {
            throw Error("Connection verification is not available in this deployment.");
          },
        },
      };
      let response = await resolveCommusoftVerification(client, request, "check");
      const state = response.receipt.state;
      if (
        (mode === "apply" && (state === "pending" || state === "approved")) ||
        (mode === "cancel" && state !== "recorded" && state !== "cancelled")
      ) {
        if (!allowed()) throw Error("Operator context changed; connection request retained.");
        response = await resolveCommusoftVerification(client, request, mode);
      }
      result = { kind: "verify_commusoft", ...response };
    }
    if (result.receipt.state === "recorded" || result.receipt.state === "cancelled") {
      if (!allowed() || store.getItem(key) !== encoded)
        throw Error(
          "The result was recorded, but the saved context changed. Check its receipt again.",
        );
      store.removeItem(key);
      if (store.getItem(key) !== null)
        throw Error(
          "The result was recorded, but recovery storage could not be cleared. Check again.",
        );
    }
    return result;
  });
}

export function connectionResultMessage(result: ConnectionResult): string {
  const r = result.receipt;
  if (r.state === "pending")
    return "No result is recorded yet. Keep this request saved; retry or cancel it explicitly.";
  if (r.state === "cancelled") return "Request cancelled. A delayed copy cannot apply it.";
  if (result.kind === "configure_commusoft")
    return "Connection saved. Run the access check before approving an import.";
  if (result.receipt.state === "approved")
    return result.retryAt
      ? `The connection check is waiting for provider capacity. Try this saved check after ${new Date(result.retryAt).toLocaleString("en-GB")}.`
      : "The connection check is approved but has no recorded result. Retry this saved check or cancel it.";
  if (result.receipt.state === "running")
    return "The connection check has started. Check its result; retrying will not send another provider request.";
  if (result.receipt.state === "expired")
    return "The connection check expired without a confirmed result. Cancel this saved check before starting a new one.";
  if (result.receipt.state !== "recorded") return "Check the saved result before continuing.";
  const messages = {
    access_verified:
      "Commusoft properties access verified. No import was started; job/contact access and coverage still need validation.",
    authentication_required:
      "Commusoft did not accept the stored credential. Review or replace it, then run a new check.",
    access_denied:
      "The Commusoft read was denied. Access remains unverified; check the application API logs, read permissions and account or network restrictions before running a new check. This result alone does not prove the stored key is wrong.",
    authority_changed:
      "The connection or operator authority changed during the check. Refresh status before starting a new check.",
    authority_unavailable:
      "Connection authority could not be confirmed. Refresh and review the connection before checking again.",
    rate_limited:
      "Commusoft asked us to wait. The check did not verify access; provider pacing remains in effect.",
    transport_unavailable:
      "Commusoft access could not be confirmed because the request did not complete. Review status before checking again.",
    provider_unavailable:
      "Commusoft was unavailable. The check did not verify access; try a new check when the service is available.",
    provider_rejected:
      "Commusoft rejected this access check. Review the region and private-application configuration.",
    invalid_request: "The access-check configuration needs operator review before another check.",
    response_too_large:
      "The Commusoft response exceeded the access-check limit. Operator review is needed.",
    invalid_response:
      "The Commusoft response did not match the supported format. Operator review is needed before importing.",
  };
  return messages[result.receipt.code];
}
