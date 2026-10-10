/** Tenant-bound credential reuse for the mailbox engine. No credentials enter
 * receipts, health metadata or error messages. Each admitted batch rechecks its
 * saved account/Workspace authority immediately before token acquisition.
 */
import { captureAdmission } from "./learn_capture_control.ts";
import type { EmailProtocolClient } from "./email_ingestion_protocol.ts";
import type { EmailJobAttempt } from "./email_job_attempt.ts";
import type { EmailCapturePorts, EmailMailboxSource } from "./email_capture_engine.ts";
import { GmailCaptureError } from "./gmail_capture_page.ts";
import { getGoogleOAuthConfig, refreshGmailAccessToken, RefreshError } from "./gmail_oauth.ts";
import {
  getPlatformWorkspaceConfig,
  getDelegatedGmailToken,
  DelegationError,
} from "./google_workspace.ts";
export type EmailCaptureDb = EmailProtocolClient & { from(table: string): any };
type Dependencies = {
  oauthConfig: typeof getGoogleOAuthConfig;
  refresh: typeof refreshGmailAccessToken;
  workspaceConfig: typeof getPlatformWorkspaceConfig;
  delegate: typeof getDelegatedGmailToken;
  clock: () => number;
};
const defaults: Dependencies = {
  oauthConfig: getGoogleOAuthConfig,
  refresh: refreshGmailAccessToken,
  workspaceConfig: getPlatformWorkspaceConfig,
  delegate: getDelegatedGmailToken,
  clock: Date.now,
};
const denied = (): never => {
  throw new GmailCaptureError("source_ineligible");
};
const canRead = (scope: unknown) =>
  typeof scope === "string" &&
  scope
    .split(/\s+/)
    .some((s) =>
      [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://mail.google.com/",
      ].includes(s),
    );
const stringToken = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 16384;
const mailboxAddress = (v: unknown): v is string =>
  typeof v === "string" && /^[^\s@]+@[^\s@]+$/.test(v);
export function createEmailCapturePorts(
  db: EmailCaptureDb,
  overrides: Partial<Dependencies> = {},
): EmailCapturePorts {
  const deps = { ...defaults, ...overrides },
    proofs = new WeakMap<EmailMailboxSource, string>();
  async function authorization(attempt: EmailJobAttempt) {
    try {
      const { data: a, error } = await db
        .from("email_accounts")
        .select(
          "id,tenant_id,provider,email_address,status,auth_state,backfill_page_token,backfill_total_fetched",
        )
        .eq("tenant_id", attempt.tenantId)
        .eq("id", attempt.accountId)
        .eq("provider", "gmail")
        .maybeSingle();
      if (error) throw new GmailCaptureError("fetch_failed");
      if (
        !a ||
        a.id !== attempt.accountId ||
        a.tenant_id !== attempt.tenantId ||
        a.provider !== "gmail" ||
        !mailboxAddress(a.email_address)
      )
        denied();
      const mailbox = a.email_address.toLowerCase();
      const base = [a.id, a.tenant_id, mailbox, a.status, a.auth_state];
      if (attempt.syncType === "messages") {
        if (a.status !== "active" || !["ok", "unknown"].includes(a.auth_state)) denied();
        return {
          source: {
            tenantId: a.tenant_id,
            accountId: a.id,
            mailbox,
            historical: null,
          } as EmailMailboxSource,
          proof: JSON.stringify(base),
        };
      }
      if (
        !["workspace_messages", "workspace_backfill"].includes(attempt.syncType) ||
        !["pending_tokenless_dwd", "active_dwd"].includes(a.status)
      )
        denied();
      const escaped = mailbox.replace(/[\\%_]/g, "\\$&");
      const { data: mailboxes, error: mbError } = await db
        .from("google_workspace_mailboxes")
        .select("id,tenant_id,connection_id,email_address,status,sync_enabled,mailbox_type")
        .eq("tenant_id", attempt.tenantId)
        .ilike("email_address", escaped)
        .limit(2);
      if (mbError) throw new GmailCaptureError("fetch_failed");
      if (!Array.isArray(mailboxes) || mailboxes.length !== 1) denied();
      const m = mailboxes[0];
      if (
        m.tenant_id !== attempt.tenantId ||
        typeof m.email_address !== "string" ||
        m.email_address.toLowerCase() !== mailbox ||
        m.sync_enabled !== true ||
        !["pending", "active"].includes(m.status) ||
        m.mailbox_type === "suspended"
      )
        denied();
      const { data: c, error: cError } = await db
        .from("google_workspace_connections")
        .select(
          "id,tenant_id,domain,status,service_account_email,service_account_client_id,last_verified_at",
        )
        .eq("tenant_id", attempt.tenantId)
        .eq("id", m.connection_id)
        .maybeSingle();
      if (cError) throw new GmailCaptureError("fetch_failed");
      const platform = deps.workspaceConfig();
      if (
        !platform.ok ||
        !c ||
        c.id !== m.connection_id ||
        c.tenant_id !== attempt.tenantId ||
        c.status !== "active" ||
        typeof c.domain !== "string" ||
        c.domain.toLowerCase() !== mailbox.split("@")[1] ||
        typeof c.service_account_email !== "string" ||
        c.service_account_email.toLowerCase() !== platform.config.clientEmail.toLowerCase() ||
        (platform.config.clientId !== null &&
          c.service_account_client_id !== platform.config.clientId) ||
        typeof c.last_verified_at !== "string" ||
        !Number.isFinite(Date.parse(c.last_verified_at)) ||
        Date.parse(c.last_verified_at) > deps.clock() + 5000
      )
        denied();
      const source: EmailMailboxSource = {
        tenantId: a.tenant_id,
        accountId: a.id,
        mailbox,
        historical: { pageToken: a.backfill_page_token, total: a.backfill_total_fetched },
      };
      return {
        source,
        proof: JSON.stringify([
          ...base,
          m.id,
          m.connection_id,
          m.status,
          m.sync_enabled,
          m.mailbox_type,
          c.domain.toLowerCase(),
          c.status,
          c.service_account_email.toLowerCase(),
          c.service_account_client_id,
        ]),
      };
    } catch (e) {
      if (e instanceof GmailCaptureError) throw e;
      throw new GmailCaptureError("fetch_failed");
    }
  }
  async function oauthRow(a: EmailJobAttempt) {
    const { data: t, error } = await db
      .from("email_oauth_tokens")
      .select(
        "id,tenant_id,email_account_id,provider,access_token,refresh_token,expires_at,scope,token_type,updated_at",
      )
      .eq("tenant_id", a.tenantId)
      .eq("email_account_id", a.accountId)
      .eq("provider", "gmail")
      .maybeSingle();
    if (error) throw new GmailCaptureError("fetch_failed");
    if (
      !t ||
      t.tenant_id !== a.tenantId ||
      t.email_account_id !== a.accountId ||
      t.provider !== "gmail" ||
      typeof t.id !== "string" ||
      typeof t.updated_at !== "string" ||
      !Number.isFinite(Date.parse(t.updated_at))
    )
      denied();
    return t;
  }
  function usable(t: any) {
    return (
      stringToken(t.access_token) &&
      typeof t.expires_at === "string" &&
      Date.parse(t.expires_at) - deps.clock() > 120000 &&
      canRead(t.scope) &&
      (t.token_type === null ||
        (typeof t.token_type === "string" && t.token_type.toLowerCase() === "bearer"))
    );
  }
  async function checkAgain(attempt: EmailJobAttempt, source: EmailMailboxSource) {
    const actual = await authorization(attempt);
    if (
      !proofs.has(source) ||
      actual.proof !== proofs.get(source) ||
      actual.source.mailbox !== source.mailbox
    )
      denied();
  }
  return {
    admission: (tenant) => captureAdmission(db, tenant, "email", deps.clock),
    async mailbox(attempt) {
      const a = await authorization(attempt);
      proofs.set(a.source, a.proof);
      return a.source;
    },
    async accessToken(attempt, source) {
      try {
        await checkAgain(attempt, source);
        if (attempt.syncType !== "messages") {
          const t = await deps.delegate(source.mailbox);
          if (!stringToken(t.accessToken) || (t.scope !== null && !canRead(t.scope))) denied();
          return t.accessToken;
        }
        const saved = await oauthRow(attempt);
        if (usable(saved)) return saved.access_token;
        const config = deps.oauthConfig();
        if (!config || !stringToken(saved.refresh_token)) denied();
        const fresh = await deps.refresh(config, saved.refresh_token);
        const scope = fresh.scope ?? saved.scope,
          tokenType = fresh.tokenType ?? saved.token_type;
        if (
          !stringToken(fresh.accessToken) ||
          !Number.isFinite(fresh.expiresIn) ||
          fresh.expiresIn! <= 120 ||
          fresh.expiresIn! > 86400 ||
          !canRead(scope) ||
          (tokenType !== null &&
            (typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer"))
        )
          denied();
        await checkAgain(attempt, source);
        const patch = {
          access_token: fresh.accessToken,
          expires_at: new Date(deps.clock() + fresh.expiresIn! * 1000).toISOString(),
          scope,
          token_type: tokenType,
          updated_at: new Date(deps.clock()).toISOString(),
        };
        const { data, error } = await db
          .from("email_oauth_tokens")
          .update(patch)
          .eq("id", saved.id)
          .eq("tenant_id", attempt.tenantId)
          .eq("email_account_id", attempt.accountId)
          .eq("provider", "gmail")
          .eq("updated_at", saved.updated_at)
          .eq("refresh_token", saved.refresh_token)
          .select("id");
        if (error) throw new GmailCaptureError("persistence_failed", true);
        if (Array.isArray(data) && data.length === 1 && data[0].id === saved.id)
          return fresh.accessToken;
        if (!Array.isArray(data) || data.length !== 0)
          throw new GmailCaptureError("persistence_failed", true);
        // A newer refresh/reconnection won the comparison. Use only its validated
        // cached token; never overwrite it or silently retry the old refresh token.
        await checkAgain(attempt, source);
        const newer = await oauthRow(attempt);
        if (!usable(newer)) denied();
        return newer.access_token;
      } catch (e) {
        if (e instanceof GmailCaptureError) throw e;
        if (e instanceof RefreshError || e instanceof DelegationError)
          throw new GmailCaptureError(e.permanent ? "source_ineligible" : "fetch_failed");
        throw new GmailCaptureError("fetch_failed");
      }
    },
  };
}
