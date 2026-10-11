import { readBoundedJson } from "./bounded-json.ts";
import {
  validWorkspaceVoicemailRequest,
  VoicemailProviderError,
  type WorkspaceVoicemailRequest,
} from "./workspace-import.ts";
type Dependencies = {
  serviceKey: string;
  internalKey?: string;
  run: (input: WorkspaceVoicemailRequest) => Promise<any>;
};
const reply = (data: unknown, status: number) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const equal = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
/** Internal one-message entry point. No user-JWT role inference, new grants or
 * credential provisioning; an exact existing server secret is required. */
export function createVoicemailImportHttpHandler(deps: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return reply({ success: false, code: "method_not_allowed" }, 405);
    const authorization = req.headers.get("authorization") ?? "";
    const bearer = /^Bearer /i.test(authorization) ? authorization.slice(7).trim() : "";
    const internal = req.headers.get("x-serviceos-internal-key") ?? "";
    if (
      !deps.serviceKey ||
      !(equal(bearer, deps.serviceKey) || equal(internal, deps.internalKey || deps.serviceKey))
    )
      return reply({ success: false, code: "voicemail_internal_auth_required" }, 403);
    let request: WorkspaceVoicemailRequest;
    try {
      const body = await readBoundedJson(new Response(req.body, { headers: req.headers }), 2048);
      if (
        !body ||
        Object.keys(body).sort().join(",") !== "accountId,internalDate,messageId,routeId"
      )
        throw Error();
      request = { ...body, tenantId: req.headers.get("x-internal-tenant-id") };
      if (!validWorkspaceVoicemailRequest(request)) throw Error();
    } catch {
      return reply({ success: false, code: "voicemail_request_invalid" }, 400);
    }
    try {
      const result = await deps.run(request);
      if (
        result?.state !== "published" ||
        result.storedBytesReadBack !== true ||
        typeof result.messageId !== "string" ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.messageId)
      )
        throw Error("voicemail_publish_unconfirmed");
      return reply(
        {
          success: true,
          messageId: result.messageId,
          recordsProcessed: 1,
          coverageComplete: false,
        },
        200,
      );
    } catch (e) {
      const safeCodes = new Set([
        "voicemail_sa_config_missing",
        "voicemail_sa_credentials_invalid",
        "voicemail_admin_delegation_missing",
        "voicemail_scopes_missing",
        "voicemail_delegation_grant_invalid",
        "voicemail_delegation_denied",
        "voicemail_source_ineligible",
        "voicemail_fetch_failed",
        "voicemail_persistence_failed",
        "voicemail_provider_temporary",
        "voicemail_provider_source_unavailable",
        "voicemail_provider_access_denied",
        "voicemail_provider_response_invalid",
        "voicemail_provider_source_changed",
        "voicemail_mailbox_binding_unverified",
        "voicemail_credentials_unverified",
        "voicemail_route_unverified",
        "voicemail_route_unconfirmed",
        "voicemail_audio_decode_unconfirmed",
        "voicemail_source_mutated",
        "voicemail_storage_readback_unconfirmed",
        "voicemail_storage_readback_mismatch",
        "voicemail_prepare_unconfirmed",
        "voicemail_publish_unconfirmed",
        "notification_signature_unverified",
        "notification_recipient_unverified",
        "notification_audio_ambiguous",
        "notification_audio_format_unverified",
      ]);
      const code =
        e instanceof Error && safeCodes.has(e.message) ? e.message : "voicemail_import_unconfirmed";
      const retryable =
        e instanceof VoicemailProviderError
          ? e.retryable
          : [
              "voicemail_route_unconfirmed",
              "voicemail_storage_readback_unconfirmed",
              "voicemail_publish_unconfirmed",
              "voicemail_import_unconfirmed",
            ].includes(code);
      return reply(
        { success: false, code, retryable, message: "Voicemail import requires operator review." },
        retryable ? 503 : 409,
      );
    }
  };
}
