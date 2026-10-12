/** Server-side delegated Microsoft refresh. Tokens are opaque; only Microsoft's
 * token endpoint may receive the saved refresh token and client secret. */
import { object, uuid } from "./microsoft_graph_transport.ts";

export type MicrosoftOAuthConfig = { clientId: string; clientSecret: string };
export class MicrosoftCredentialError extends Error {
  readonly code:
    | "credential_unavailable"
    | "refresh_failed"
    | "reauthorization_required"
    | "credential_save_unconfirmed";
  constructor(code: MicrosoftCredentialError["code"]) {
    super(`Microsoft mail credentials: ${code}`);
    this.name = "MicrosoftCredentialError";
    this.code = code;
  }
}
export const validMicrosoftToken = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 32768 && !/[\s\u0000-\u001f]/.test(v);
export function microsoftReadScope(scope: unknown): scope is string {
  if (typeof scope !== "string" || scope.length > 4096) return false;
  const scopes = scope.toLowerCase().split(/\s+/);
  return scopes.includes("mail.read") || scopes.includes("https://graph.microsoft.com/mail.read");
}
export function getMicrosoftOAuthConfig(): MicrosoftOAuthConfig | null {
  const clientId = Deno.env.get("MICROSOFT_MAIL_CLIENT_ID");
  const clientSecret = Deno.env.get("MICROSOFT_MAIL_CLIENT_SECRET");
  return uuid(clientId) &&
    typeof clientSecret === "string" &&
    clientSecret.length > 0 &&
    clientSecret.length <= 16384 &&
    !/[\u0000-\u001f]/.test(clientSecret)
    ? { clientId, clientSecret }
    : null;
}
export type MicrosoftRefreshedToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
};

export async function refreshMicrosoftAccessToken(
  config: MicrosoftOAuthConfig,
  microsoftTenantId: string,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<MicrosoftRefreshedToken> {
  if (
    !uuid(config?.clientId) ||
    !uuid(microsoftTenantId) ||
    typeof config.clientSecret !== "string" ||
    !config.clientSecret ||
    config.clientSecret.length > 16384 ||
    /[\u0000-\u001f]/.test(config.clientSecret) ||
    !validMicrosoftToken(refreshToken)
  )
    throw new MicrosoftCredentialError("credential_unavailable");
  try {
    const response = await fetcher(
      `https://login.microsoftonline.com/${microsoftTenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          scope: "https://graph.microsoft.com/Mail.Read",
        }),
      },
    );
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > 131072)) {
      await response.body?.cancel().catch(() => {});
      throw Error();
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 131072) {
          await reader.cancel().catch(() => {});
          throw Error();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    if (response.status !== 200) {
      if (
        response.status === 400 &&
        object(body) &&
        ["invalid_grant", "interaction_required", "consent_required"].includes(body.error)
      )
        throw new MicrosoftCredentialError("reauthorization_required");
      throw Error();
    }
    if (
      !object(body) ||
      !validMicrosoftToken(body.access_token) ||
      typeof body.token_type !== "string" ||
      body.token_type.toLowerCase() !== "bearer" ||
      !Number.isSafeInteger(body.expires_in) ||
      body.expires_in <= 120 ||
      body.expires_in > 86400 ||
      (body.scope !== undefined && !microsoftReadScope(body.scope)) ||
      (body.refresh_token !== undefined && !validMicrosoftToken(body.refresh_token))
    )
      throw Error();
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresIn: body.expires_in,
      // OAuth permits omitted scope when it is identical to the requested scope.
      scope: body.scope ?? "https://graph.microsoft.com/Mail.Read",
    };
  } catch (error) {
    if (error instanceof MicrosoftCredentialError) throw error;
    // Never retain endpoint bodies, URLs with credentials, or fetch exceptions.
    throw new MicrosoftCredentialError("refresh_failed");
  }
}
