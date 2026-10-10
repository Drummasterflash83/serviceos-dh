import type { OperatorInputClient } from "./learn-operator-inputs.ts";

/** Safe to retain for recovery. Credential values are a separate transient argument. */
export type CommusoftSetupDefinition = {
  kind: "configure_commusoft";
  reason: string;
  region: "uk" | "us";
  account_key: string;
  expected_revision: string | null;
  credential_mode: "reuse" | "replace";
  same_account_confirmed: true;
};
export type CommusoftSetupRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  definition: CommusoftSetupDefinition;
};
export type CommusoftSetupReceipt =
  | {
      tenant_id: string;
      request_id: string;
      state: "pending" | "cancelled";
    }
  | {
      tenant_id: string;
      request_id: string;
      state: "recorded";
      connection_id: string;
      revision: string;
      credential_bound: true;
      verification: "required";
    };
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
export function validateCommusoftSetup(r: unknown): asserts r is CommusoftSetupRequest {
  if (
    !object(r) ||
    Object.keys(r).length !== 4 ||
    !uuid(r.tenantId) ||
    !uuid(r.actorId) ||
    !uuid(r.requestId) ||
    !object(r.definition)
  )
    throw Error("The saved connection request could not be verified.");
  const d = r.definition;
  if (
    Object.keys(d).length !== 7 ||
    d.kind !== "configure_commusoft" ||
    typeof d.reason !== "string" ||
    !d.reason.trim() ||
    d.reason.length > 1000 ||
    !["uk", "us"].includes(d.region) ||
    typeof d.account_key !== "string" ||
    !d.account_key.trim() ||
    d.account_key.length > 2000 ||
    !(d.expected_revision === null || date(d.expected_revision)) ||
    !["reuse", "replace"].includes(d.credential_mode) ||
    d.same_account_confirmed !== true
  )
    throw Error("Check the account, region, credential choice and confirmation.");
}
/** No automatic retry. A lost reply must be checked without retaining the API key. */
export async function resolveCommusoftSetup(
  db: OperatorInputClient,
  request: CommusoftSetupRequest,
  mode: "apply" | "check" | "cancel",
  apiKey?: string,
): Promise<CommusoftSetupReceipt> {
  validateCommusoftSetup(request);
  if (
    !["apply", "check", "cancel"].includes(mode) ||
    (mode === "apply" && request.definition.credential_mode === "replace"
      ? typeof apiKey !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(apiKey)
      : apiKey !== undefined)
  )
    throw Error(
      "Enter a credential only when applying a replacement; do not include it in a saved request.",
    );
  try {
    const { data, error } = await db.rpc("learn_commusoft_configure", {
      p_tenant: request.tenantId,
      p_actor: request.actorId,
      p_request: request.requestId,
      p_definition: request.definition,
      p_mode: mode,
      p_api_key: apiKey ?? null,
    });
    if (
      error ||
      !object(data) ||
      data.tenant_id !== request.tenantId ||
      data.request_id !== request.requestId ||
      !["pending", "cancelled", "recorded"].includes(data.state) ||
      (data.state === "pending" && mode !== "check")
    )
      throw Error();
    if (data.state === "recorded") {
      if (
        !uuid(data.connection_id) ||
        !date(data.revision) ||
        data.credential_bound !== true ||
        data.verification !== "required"
      )
        throw Error();
      return {
        tenant_id: data.tenant_id,
        request_id: data.request_id,
        state: "recorded",
        connection_id: data.connection_id,
        revision: data.revision,
        credential_bound: true,
        verification: "required",
      };
    }
    return { tenant_id: data.tenant_id, request_id: data.request_id, state: data.state };
  } catch {
    // Database/transport errors may include request context. Never forward them.
    throw Error(
      "Connection setup was not confirmed. Keep the request reference and check its result before trying again. The credential has not been saved in recovery storage.",
    );
  }
}
