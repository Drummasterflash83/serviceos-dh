import type { MicrosoftCapturePorts, MicrosoftJournalDb } from "./microsoft_capture_engine.ts";
import { object, uuid, id } from "./microsoft_graph_transport.ts";
import {
  getMicrosoftOAuthConfig,
  refreshMicrosoftAccessToken,
  MicrosoftCredentialError,
  microsoftReadScope,
  validMicrosoftToken,
} from "./microsoft_oauth.ts";

type Dependencies = {
  config: typeof getMicrosoftOAuthConfig;
  refresh: typeof refreshMicrosoftAccessToken;
  now: () => number;
};
/** All credential reads/refresh writes are fenced by the actual job, account,
 * binding and capture switch in SQL. This port accepts no browser token or URL. */
export function createMicrosoftCapturePorts(
  db: MicrosoftJournalDb,
  overrides: Partial<Dependencies> = {},
): MicrosoftCapturePorts {
  const deps: Dependencies = {
    config: getMicrosoftOAuthConfig,
    refresh: refreshMicrosoftAccessToken,
    now: Date.now,
    ...overrides,
  };
  return {
    async accessToken(inputContext, inputClaim) {
      const c = structuredClone(inputContext),
        claim = structuredClone(inputClaim);
      const denied = (): never => {
        throw new MicrosoftCredentialError("credential_unavailable");
      };
      if (
        ![c.tenantId, c.accountId, c.mailboxId, c.bindingId, claim.jobId].every(uuid) ||
        c.tenantId !== claim.tenantId ||
        typeof claim.claimedBy !== "string" ||
        !claim.claimedBy ||
        claim.claimedBy.length > 256 ||
        !Number.isSafeInteger(claim.attemptCount) ||
        claim.attemptCount < 1 ||
        !["folders", "messages"].includes(c.kind) ||
        (c.kind === "folders" ? c.folderId !== "" : !id(c.folderId))
      )
        denied();
      const configured = deps.config();
      if (!configured || !uuid(configured.clientId)) return denied();
      const config = { ...configured };
      const args = {
        p_tenant: c.tenantId,
        p_account: c.accountId,
        p_mailbox: c.mailboxId,
        p_binding: c.bindingId,
        p_kind: c.kind,
        p_folder: c.folderId,
        p_job: claim.jobId,
        p_worker: claim.claimedBy,
        p_claim: claim.attemptCount,
        p_client: config.clientId,
      };
      async function read() {
        let result;
        try {
          result = await db.rpc("learn_microsoft_credential_read", args);
        } catch {
          return denied();
        }
        const r = result.data;
        if (
          result.error ||
          !object(r) ||
          r.contract !== "microsoft-credential/1" ||
          r.tenantId !== c.tenantId ||
          r.accountId !== c.accountId ||
          r.mailboxId !== c.mailboxId ||
          r.bindingId !== c.bindingId ||
          r.clientId !== config.clientId ||
          !uuid(r.microsoftTenantId) ||
          !uuid(r.tokenId) ||
          typeof r.updatedAt !== "string" ||
          !Number.isFinite(Date.parse(r.updatedAt)) ||
          !microsoftReadScope(r.scope) ||
          typeof r.tokenType !== "string" ||
          r.tokenType.toLowerCase() !== "bearer"
        )
          return denied();
        return r;
      }
      function usable(row: Record<string, any>) {
        const now = deps.now();
        return (
          Number.isFinite(now) &&
          validMicrosoftToken(row.accessToken) &&
          typeof row.expiresAt === "string" &&
          Date.parse(row.expiresAt) - now > 120000
        );
      }
      const saved = await read();
      if (usable(saved)) return saved.accessToken;
      if (!validMicrosoftToken(saved.refreshToken)) return denied();
      const started = deps.now();
      if (!Number.isFinite(started)) return denied();
      const fresh = await deps.refresh(config, saved.microsoftTenantId, saved.refreshToken);
      if (
        !validMicrosoftToken(fresh.accessToken) ||
        (fresh.refreshToken !== null && !validMicrosoftToken(fresh.refreshToken)) ||
        !Number.isSafeInteger(fresh.expiresIn) ||
        fresh.expiresIn <= 120 ||
        fresh.expiresIn > 86400 ||
        !microsoftReadScope(fresh.scope)
      )
        return denied();
      let result;
      try {
        result = await db.rpc("learn_microsoft_credential_refresh", {
          ...args,
          p_token: saved.tokenId,
          p_updated_at: saved.updatedAt,
          p_old_refresh: saved.refreshToken,
          p_access: fresh.accessToken,
          p_refresh: fresh.refreshToken ?? saved.refreshToken,
          p_expires: new Date(started + fresh.expiresIn * 1000).toISOString(),
          p_scope: fresh.scope,
        });
      } catch {
        throw new MicrosoftCredentialError("credential_save_unconfirmed");
      }
      if (
        result.error ||
        !object(result.data) ||
        result.data.contract !== "microsoft-credential-refresh/1" ||
        !["saved", "changed"].includes(result.data.state)
      )
        throw new MicrosoftCredentialError("credential_save_unconfirmed");
      // An overlapping refresh/reconnect may have won. Re-read current authority
      // and only use the committed token; never retry the stale refresh token.
      const current = await read();
      if (!usable(current)) return denied();
      return current.accessToken;
    },
  };
}
