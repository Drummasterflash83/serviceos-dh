// ServiceOS — shared Google Workspace Domain-Wide Delegation helpers (Deno).
//
// Used by google-workspace-test-connection (Email Phase-1B). Signs a service
// account JWT assertion (RS256, Web Crypto — no external deps) and exchanges it
// for a DELEGATED access token that impersonates a Workspace user (`sub`).
//
// The service-account private key is read ONLY from Edge Function secrets. It is
// never stored in the DB and never returned to the client. Tokens are never
// logged.

// Admin-authorised scopes for many-mailbox ingestion. Must match the scopes
// granted to the service account's client ID in the Google Admin console.
export const WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
];

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export interface WorkspaceConfig {
  clientEmail: string;
  privateKey: string;
  /** Admin/user email to impersonate. */
  subject: string;
  /** Workspace domain (used for Directory listing; not part of the JWT). */
  domain: string;
}

/** PLATFORM (not tenant) service-account config. Domain/subject are per-tenant. */
export interface PlatformWorkspaceConfig {
  clientEmail: string;
  privateKey: string;
  /** Numeric OAuth2 client ID the customer authorises in their Admin console. */
  clientId: string | null;
}

/**
 * Read the PLATFORM service-account secrets (client email + private key, plus the
 * optional numeric client id for setup instructions). The tenant's domain and
 * impersonation subject are NOT read here — they live per-tenant in
 * google_workspace_connections.
 */
export function getPlatformWorkspaceConfig():
  { ok: true; config: PlatformWorkspaceConfig } | { ok: false; missing: string[] } {
  const clientEmail = Deno.env.get("GOOGLE_WORKSPACE_CLIENT_EMAIL");
  const privateKey = Deno.env.get("GOOGLE_WORKSPACE_PRIVATE_KEY");
  const clientId = Deno.env.get("GOOGLE_WORKSPACE_CLIENT_ID") ?? null;

  const missing: string[] = [];
  if (!clientEmail) missing.push("GOOGLE_WORKSPACE_CLIENT_EMAIL");
  if (!privateKey) missing.push("GOOGLE_WORKSPACE_PRIVATE_KEY");
  if (missing.length > 0) return { ok: false, missing };

  return { ok: true, config: { clientEmail: clientEmail!, privateKey: privateKey!, clientId } };
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlJson(value: unknown): string {
  return b64url(encoder.encode(JSON.stringify(value)));
}

/** Convert a PKCS#8 PEM (with literal or real newlines) to a CryptoKey. */
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalised = pem.replace(/\\n/g, "\n");
  const b64 = normalised
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/** Build and RS256-sign the service-account assertion JWT. */
async function signAssertion(config: WorkspaceConfig, scopes: string[]): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: config.clientEmail,
    scope: scopes.join(" "),
    aud: GOOGLE_TOKEN_ENDPOINT,
    sub: config.subject, // domain-wide delegation: impersonate this user
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const key = await importPrivateKey(config.privateKey);
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput)),
  );
  return `${signingInput}.${b64url(sig)}`;
}

export interface DelegatedToken {
  accessToken: string;
  /** Scopes Google actually granted, when returned. */
  scope: string | null;
  expiresIn: number | null;
}

/** A classified DWD failure — safe code + whether it is permanent (§4). */
export class DelegationError extends Error {
  readonly code: string;
  readonly permanent: boolean;
  constructor(code: string, permanent: boolean) {
    super(code);
    this.name = "DelegationError";
    this.code = code;
    this.permanent = permanent;
  }
}

/**
 * Map a Google DWD failure to a SAFE, distinct code + permanence (§4). Permanent
 * conditions (config/authz) must NOT be retried forever and should surface a
 * specific operator action; a transient Google 5xx/429 must be retried and must
 * NOT flip the connector to a permanent delegation failure. Pure + unit-tested.
 */
export function classifyDelegationError(
  googleError: string,
  status: number,
): { code: string; permanent: boolean } {
  const e = (googleError || "").toLowerCase();
  if (e.startsWith("config_incomplete")) return { code: "sa_config_missing", permanent: true };
  if (e === "private_key_invalid") return { code: "sa_credentials_invalid", permanent: true };
  if (e === "unauthorized_client" || e === "access_denied") {
    return { code: "admin_delegation_missing", permanent: true };
  }
  if (e === "invalid_scope") return { code: "scopes_missing", permanent: true };
  if (e === "invalid_grant") return { code: "subject_invalid", permanent: true };
  if (status === 0 || status === 408 || status === 429 || status >= 500) {
    return { code: "provider_temporary", permanent: false };
  }
  return { code: "delegation_denied", permanent: true };
}

/**
 * Get a delegated access token that impersonates `config.subject`. Throws a
 * classified, credential-free DelegationError on failure.
 */
export async function getDelegatedToken(
  config: WorkspaceConfig,
  scopes: string[] = WORKSPACE_SCOPES,
): Promise<DelegatedToken> {
  let assertion: string;
  try {
    assertion = await signAssertion(config, scopes);
  } catch (_cause) {
    throw new DelegationError("sa_credentials_invalid", true);
  }

  let resp: Response;
  try {
    resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
    });
  } catch {
    throw new DelegationError("provider_temporary", false);
  }
  if (!resp.ok) {
    // Google returns {error, error_description}; surface the safe short code only.
    let raw = "delegation_denied";
    try {
      const err = (await resp.json()) as { error?: string };
      if (err.error) raw = String(err.error);
    } catch {
      // ignore parse failure
    }
    const c = classifyDelegationError(raw, resp.status);
    throw new DelegationError(c.code, c.permanent);
  }
  const data = (await resp.json()) as {
    access_token?: string;
    scope?: string;
    expires_in?: number;
  };
  if (!data.access_token) throw new DelegationError("no_access_token", false);
  return {
    accessToken: data.access_token,
    scope: data.scope ?? null,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
  };
}

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * Mint a delegated Gmail access token that impersonates a SPECIFIC mailbox
 * (not the admin subject) with gmail.readonly only — for domain-wide-delegation
 * message sync. Reads the service-account secrets server-side; throws a short,
 * credential-free Error on failure. The key/token are never returned to callers
 * beyond the access token itself.
 */
export async function getDelegatedGmailToken(mailboxEmail: string): Promise<DelegatedToken> {
  const cfg = getPlatformWorkspaceConfig();
  if (!cfg.ok) throw new DelegationError("sa_config_missing", true);
  // Platform key + private key; impersonate the mailbox itself. Domain is not
  // used for token minting, so no tenant connection lookup is needed here.
  const config: WorkspaceConfig = {
    clientEmail: cfg.config.clientEmail,
    privateKey: cfg.config.privateKey,
    subject: mailboxEmail,
    domain: "",
  };
  return getDelegatedToken(config, [GMAIL_READONLY_SCOPE]);
}

const GMAIL_SEND_ONLY_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/**
 * Mint the SMALLEST practical delegated token for governed Marketing sending:
 * impersonates ONE specific authorised mailbox with gmail.send ONLY (never the
 * read scope, never the directory scope, never the admin subject). Used by the
 * marketing sender verification path (a token mint proves the Workspace admin
 * actually granted gmail.send to the service account — `authorised_scopes`
 * records only what was REQUESTED) and by the Gmail Marketing adapter at
 * execution time. Throws DelegationError with the existing classification
 * (`scopes_missing` → the DWD grant lacks gmail.send). Token/key never leave
 * the server.
 */
export async function getDelegatedGmailSendToken(mailboxEmail: string): Promise<DelegatedToken> {
  const cfg = getPlatformWorkspaceConfig();
  if (!cfg.ok) throw new DelegationError("sa_config_missing", true);
  const config: WorkspaceConfig = {
    clientEmail: cfg.config.clientEmail,
    privateKey: cfg.config.privateKey,
    subject: mailboxEmail,
    domain: "",
  };
  return getDelegatedToken(config, [GMAIL_SEND_ONLY_SCOPE]);
}

export interface GmailProfileCheck {
  emailAddress: string | null;
  messagesTotal: number | null;
}

/**
 * Verify the delegated token can actually reach the impersonated mailbox by
 * reading its Gmail profile (proves gmail.readonly + impersonation both work).
 */
export async function verifyGmailProfile(accessToken: string): Promise<GmailProfileCheck> {
  const resp = await fetch(GMAIL_PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`gmail_profile_${resp.status}`);
  }
  const data = (await resp.json()) as { emailAddress?: string; messagesTotal?: number };
  return {
    emailAddress: data.emailAddress ?? null,
    messagesTotal: typeof data.messagesTotal === "number" ? data.messagesTotal : null,
  };
}

const DIRECTORY_USERS_ENDPOINT = "https://admin.googleapis.com/admin/directory/v1/users";

export interface DirectoryUser {
  email: string;
  displayName: string | null;
  suspended: boolean;
  isAdmin: boolean;
}

/**
 * List the domain's users via the Admin Directory API (users.list), paging
 * through results. Requires a delegated token with admin.directory.user.readonly
 * impersonating an admin. `maxPages` bounds a runaway (500 users/page).
 */
export async function listDirectoryUsers(
  accessToken: string,
  domain: string,
  opts: { maxPages?: number } = {},
): Promise<DirectoryUser[]> {
  const users: DirectoryUser[] = [];
  const maxPages = opts.maxPages ?? 20; // up to ~10k users
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({ domain, maxResults: "500", orderBy: "email" });
    if (pageToken) params.set("pageToken", pageToken);
    const resp = await fetch(`${DIRECTORY_USERS_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`directory_users_${resp.status}`);
    const data = (await resp.json()) as {
      users?: Array<{
        primaryEmail?: string;
        name?: { fullName?: string };
        suspended?: boolean;
        isAdmin?: boolean;
      }>;
      nextPageToken?: string;
    };
    for (const u of data.users ?? []) {
      const email = typeof u.primaryEmail === "string" ? u.primaryEmail.toLowerCase() : null;
      if (!email) continue;
      users.push({
        email,
        displayName: u.name?.fullName ?? null,
        suspended: Boolean(u.suspended),
        isAdmin: Boolean(u.isAdmin),
      });
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return users;
}
