import { Buffer } from "node:buffer";
import {
  createEmailCapturePorts,
  type EmailCaptureDb,
  type EmailCredentialPorts,
} from "../email_capture_ports.ts";
import { readBoundedJson } from "./bounded-json.ts";
import { providerKeyResolver } from "./provider-keys.js";
import { GmailCaptureError } from "../gmail_capture_page.ts";

export type WorkspaceVoicemailRequest = {
  tenantId: string;
  routeId: string;
  accountId: string;
  messageId: string;
  internalDate: string;
};
type Deps = {
  importer: (input: any) => Promise<any>;
  ports?: (db: EmailCaptureDb) => EmailCredentialPorts;
  fetcher?: typeof fetch;
  resolver?: (name: string, type: string) => Promise<string[][]>;
};
const uuid = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function validWorkspaceVoicemailRequest(v: any): v is WorkspaceVoicemailRequest {
  return (
    v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).length === 5 &&
    uuid(v.tenantId) &&
    uuid(v.routeId) &&
    uuid(v.accountId) &&
    typeof v.messageId === "string" &&
    /^[a-f0-9]{1,64}$/.test(v.messageId) &&
    typeof v.internalDate === "string" &&
    /^(0|[1-9][0-9]{0,14})$/.test(v.internalDate) &&
    Number(v.internalDate) <= 8640000000000000
  );
}
export class VoicemailProviderError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}
/** One signed message per call. SQL route admission in the importer precedes
 * this loader, including all credential resolution and provider traffic. */
export async function importWorkspaceVoicemail(
  db: EmailCaptureDb,
  input: WorkspaceVoicemailRequest,
  deps: Deps,
) {
  if (!validWorkspaceVoicemailRequest(input)) throw Error("voicemail_request_invalid");
  const request = { ...input };
  const ports = (deps.ports ?? createEmailCapturePorts)(db);
  const fetcher = deps.fetcher ?? fetch;
  let loadedRaw: Uint8Array | undefined;
  let providerFailure: VoicemailProviderError | undefined;
  async function get(path: string, token: string, maximum: number) {
    let response: Response;
    try {
      response = await fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
    } catch {
      throw new VoicemailProviderError("voicemail_provider_temporary", true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      throw new VoicemailProviderError(
        status === 404 || status === 410
          ? "voicemail_provider_source_unavailable"
          : status === 401 || status === 403
            ? "voicemail_provider_access_denied"
            : "voicemail_provider_temporary",
        status === 408 || status === 429 || status >= 500,
      );
    }
    try {
      return await readBoundedJson(response, maximum);
    } catch {
      throw new VoicemailProviderError("voicemail_provider_response_invalid", false);
    }
  }
  try {
    return await deps.importer({
      client: db,
      tenantId: request.tenantId,
      routeId: request.routeId,
      source: {
        accountId: request.accountId,
        id: request.messageId,
        internalDate: request.internalDate,
      },
      resolver: deps.resolver ?? providerKeyResolver().resolve,
      loadRaw: async ({ accountId, id }: { accountId: string; id: string }) => {
        try {
          if (accountId !== request.accountId || id !== request.messageId) throw Error();
          const scope = {
            tenantId: request.tenantId,
            accountId,
            syncType: "workspace_messages" as const,
          };
          const source = await ports.mailbox(scope);
          if (
            source.tenantId !== request.tenantId ||
            source.accountId !== accountId ||
            (source.profileMailbox && source.profileMailbox !== source.mailbox)
          )
            throw new VoicemailProviderError("voicemail_mailbox_binding_unverified", false);
          const token = await ports.accessToken(scope, source);
          const profile = await get("profile", token, 16384);
          if (
            typeof profile?.emailAddress !== "string" ||
            profile.emailAddress.toLowerCase() !== source.mailbox
          )
            throw new VoicemailProviderError("voicemail_mailbox_binding_unverified", false);
          // Recheck both controls/route after token and profile, before the raw read.
          const admission = await db.rpc("voicemail_intake_route", {
            p_tenant: request.tenantId,
            p_route: request.routeId,
            p_received: new Date(Number(request.internalDate)).toISOString(),
          });
          const route =
            Array.isArray(admission.data) && admission.data.length === 1
              ? admission.data[0]
              : admission.data;
          if (
            admission.error ||
            !route ||
            route.id !== request.routeId ||
            route.tenant_id !== request.tenantId ||
            route.email_account_id !== accountId ||
            route.enabled !== true ||
            route.recipient_email?.toLowerCase() !== source.mailbox
          )
            throw new VoicemailProviderError("voicemail_route_unverified", false);
          const result = await get(`messages/${id}?format=raw`, token, 1500000);
          if (
            result?.id !== id ||
            result.internalDate !== request.internalDate ||
            typeof result.raw !== "string" ||
            !/^[A-Za-z0-9_-]+={0,2}$/.test(result.raw) ||
            result.raw.length > 1398104
          )
            throw new VoicemailProviderError("voicemail_provider_source_changed", false);
          loadedRaw = Buffer.from(result.raw, "base64url");
          if (
            !loadedRaw.length ||
            loadedRaw.length > 1048576 ||
            Buffer.from(loadedRaw).toString("base64url") !== result.raw.replace(/=+$/, "")
          )
            throw new VoicemailProviderError("voicemail_provider_response_invalid", false);
          return { id, internalDate: result.internalDate, raw: loadedRaw };
        } catch (e) {
          providerFailure =
            e instanceof VoicemailProviderError
              ? e
              : e instanceof GmailCaptureError
                ? new VoicemailProviderError(
                    "voicemail_" + e.code,
                    ["fetch_failed", "persistence_failed"].includes(e.code),
                  )
                : new VoicemailProviderError("voicemail_credentials_unverified", false);
          throw providerFailure;
        }
      },
    });
  } catch (e) {
    if (providerFailure) throw providerFailure;
    throw e;
  } finally {
    loadedRaw?.fill(0);
  }
}
