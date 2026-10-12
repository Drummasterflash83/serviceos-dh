import type { OperatorInputClient } from "./learn-operator-inputs.ts";

/** Safe to retain for recovery. Credential values are a separate transient argument. */
export type SlackSetupDefinition = {
  kind: "configure_slack";
  reason: string;
  team_id: string;
  authorized_user_id: string;
  expected_revision: string | null;
  credential_mode: "reuse" | "replace";
  same_account_confirmed: true;
};
export type SlackSetupRequest = {
  tenantId: string;
  actorId: string;
  requestId: string;
  definition: SlackSetupDefinition;
};
export type SlackSetupReceipt =
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
const setupFailures: Record<string, { code: string; message: string }> = {
  learn_connection_recurring_active: {
    code: "55000",
    message:
      "Pause this workspace's ongoing Slack capture before changing its credential. Existing messages and checkpoints are retained.",
  },
  learn_connection_credential_missing: {
    code: "55000",
    message:
      "No stored Slack credential was found for this client. Cancel this saved request, then choose a new credential and save the connection.",
  },
  learn_connection_import_active: {
    code: "55000",
    message:
      "An import is active. Keep this request saved and resolve the import before changing its connection.",
  },
  learn_connection_revision_changed: {
    code: "PT409",
    message:
      "The connection changed after this request was prepared. Cancel this saved request, refresh status and review the current connection.",
  },
  learn_connection_binding_changed: {
    code: "PT409",
    message:
      "The stored credential binding needs operator review. Cancel this saved request and review the connection before replacing a credential.",
  },
  learn_connection_source_identity_changed: {
    code: "PT409",
    message:
      "This request would change the retained source workspace or consenting user. Cancel it and use a reviewed source migration instead of credential maintenance.",
  },
};
export function validateSlackSetup(r: unknown): asserts r is SlackSetupRequest {
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
    d.kind !== "configure_slack" ||
    typeof d.reason !== "string" ||
    !d.reason.trim() ||
    d.reason.length > 1000 ||
    typeof d.team_id !== "string" ||
    !/^T[A-Z0-9]{1,99}$/.test(d.team_id) ||
    typeof d.authorized_user_id !== "string" ||
    !/^[UW][A-Z0-9]{1,99}$/.test(d.authorized_user_id) ||
    !(d.expected_revision === null || date(d.expected_revision)) ||
    !["reuse", "replace"].includes(d.credential_mode) ||
    d.same_account_confirmed !== true
  )
    throw Error("Check the workspace, consenting user, credential choice and confirmation.");
}
/** No automatic retry. A lost reply must be checked without retaining the user token. */
export async function resolveSlackSetup(
  db: OperatorInputClient,
  request: SlackSetupRequest,
  mode: "apply" | "check" | "cancel",
  userToken?: string,
): Promise<SlackSetupReceipt> {
  validateSlackSetup(request);
  if (
    !["apply", "check", "cancel"].includes(mode) ||
    (mode === "apply" && request.definition.credential_mode === "replace"
      ? typeof userToken !== "string" ||
        userToken.length > 4096 ||
        !/^xoxp-[A-Za-z0-9-]+$/.test(userToken)
      : userToken !== undefined)
  )
    throw Error(
      "Enter a credential only when applying a replacement; do not include it in a saved request.",
    );
  let failureMessage =
    "Connection setup was not confirmed. Keep the request reference and check its result before trying again. The credential has not been saved in recovery storage.";
  try {
    const { data, error } = await db.rpc("learn_slack_configure", {
      p_tenant: request.tenantId,
      p_actor: request.actorId,
      p_request: request.requestId,
      p_definition: request.definition,
      p_mode: mode,
      p_user_token: userToken ?? null,
    });
    if (
      object(error) &&
      typeof error.message === "string" &&
      Object.hasOwn(setupFailures, error.message)
    ) {
      const known = setupFailures[error.message];
      if (error.code === known.code) failureMessage = known.message;
    }
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
    throw Error(failureMessage);
  }
}
