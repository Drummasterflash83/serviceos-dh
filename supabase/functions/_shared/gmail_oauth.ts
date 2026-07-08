// ServiceOS — shared Gmail OAuth helpers (Deno, Email Phase-1).
//
// Used by gmail-oauth-start and gmail-oauth-callback. This phase is CONNECTION
// ONLY — it obtains and stores tokens; it does NOT call any Gmail message API.
//
// The OAuth `state` is a stateless, HMAC-signed token. It binds the initiating
// tenant + user + app origin so the (JWT-less) callback can trust who started
// the flow without a server-side session or a state table. It is signed with
// the platform-injected service-role key — a server-only value that is never
// exposed to the frontend and never logged. Tokens themselves are never logged.

// Minimum scopes for a future READ-ONLY sync. Nothing here reads mail yet.
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Read the required Google OAuth secrets, or null when any is missing. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export interface StatePayload {
  /** tenant id */
  tid: string;
  /** user id */
  uid: string;
  /** app origin to return the browser to (may be empty) */
  org: string;
  /** random nonce */
  n: string;
  /** expiry (epoch ms) */
  exp: number;
}

const encoder = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Uint8Array {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Server-only signing key. Falls back to the service-role key (never exposed). */
function stateSigningSecret(): string | null {
  return (
    Deno.env.get("GMAIL_OAUTH_STATE_SECRET") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    null
  );
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Sign a `state` binding tenant/user/origin. Returns null if no secret. */
export async function signState(
  input: { tenantId: string; userId: string; origin: string },
): Promise<string | null> {
  const secret = stateSigningSecret();
  if (!secret) return null;
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const payload: StatePayload = {
    tid: input.tenantId,
    uid: input.userId,
    org: input.origin,
    n: b64urlEncode(nonceBytes),
    exp: Date.now() + STATE_TTL_MS,
  };
  const body = b64urlEncode(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${b64urlEncode(sig)}`;
}

/** Verify a `state` token and return its payload, or null if invalid/expired. */
export async function verifyState(state: string): Promise<StatePayload | null> {
  const secret = stateSigningSecret();
  if (!secret || typeof state !== "string" || !state.includes(".")) return null;
  const [body, sig] = state.split(".", 2);
  if (!body || !sig) return null;
  const key = await hmacKey(secret);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  let provided: Uint8Array;
  try {
    provided = b64urlDecode(sig);
  } catch {
    return null;
  }
  if (!constantTimeEqual(expected, provided)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as StatePayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
  if (typeof payload.tid !== "string" || typeof payload.uid !== "string") return null;
  return payload;
}

/** Build the Google consent URL (offline access → refresh token). */
export function buildAuthUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

/** Exchange an authorization code for tokens (server-side; secret stays here). */
export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
): Promise<TokenResponse> {
  const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`token exchange failed (${resp.status}): ${detail.slice(0, 200)}`);
  }
  return (await resp.json()) as TokenResponse;
}

export interface GmailProfile {
  email: string | null;
  name: string | null;
}

/** Fetch the connected mailbox's email address (userinfo.email scope). */
export async function fetchGmailProfile(accessToken: string): Promise<GmailProfile> {
  const resp = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`userinfo fetch failed (${resp.status})`);
  }
  const data = (await resp.json()) as { email?: string; name?: string };
  return { email: data.email ?? null, name: data.name ?? null };
}

/** Only allow http(s) return origins (state is signed, but guard the scheme). */
export function safeOrigin(origin: string | null | undefined): string | null {
  if (!origin || typeof origin !== "string") return null;
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Gmail API helpers (Email Phase-2 sync). Read-only usage; tokens never logged.
// ---------------------------------------------------------------------------

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface RefreshedToken {
  accessToken: string;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
}

/** Exchange a refresh_token for a fresh access_token (server-side). */
export async function refreshGmailAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<RefreshedToken> {
  const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!resp.ok) {
    throw new Error(`token_refresh_failed_${resp.status}`);
  }
  const data = (await resp.json()) as TokenResponse;
  if (!data.access_token) throw new Error("no_access_token");
  return {
    accessToken: data.access_token,
    expiresIn: typeof data.expires_in === "number" ? data.expires_in : null,
    scope: data.scope ?? null,
    tokenType: data.token_type ?? null,
  };
}

/** Authorized fetch against the Gmail API (`path` may be absolute or `/…`). */
export function gmailFetch(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GMAIL_API_BASE}${path}`;
  return fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
}

export interface GmailProfileFull {
  emailAddress: string | null;
  messagesTotal: number | null;
  historyId: string | null;
}

/** Read the connected mailbox's Gmail profile (users.getProfile). */
export async function getGmailProfile(accessToken: string): Promise<GmailProfileFull> {
  const resp = await gmailFetch(accessToken, "/profile");
  if (!resp.ok) throw new Error(`gmail_profile_${resp.status}`);
  const d = (await resp.json()) as {
    emailAddress?: string;
    messagesTotal?: number;
    historyId?: string;
  };
  return {
    emailAddress: d.emailAddress ?? null,
    messagesTotal: typeof d.messagesTotal === "number" ? d.messagesTotal : null,
    historyId: d.historyId != null ? String(d.historyId) : null,
  };
}

export interface GmailMessageRef {
  id: string;
  threadId: string | null;
}

/** List recent message ids (users.messages.list), filtered by label. */
export async function listGmailMessages(
  accessToken: string,
  opts: { maxResults?: number; labelIds?: string[]; q?: string; pageToken?: string } = {},
): Promise<{
  messages: GmailMessageRef[];
  resultSizeEstimate: number | null;
  nextPageToken: string | null;
}> {
  const params = new URLSearchParams();
  if (opts.maxResults) params.set("maxResults", String(opts.maxResults));
  for (const l of opts.labelIds ?? []) params.append("labelIds", l);
  if (opts.q) params.set("q", opts.q);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  const resp = await gmailFetch(accessToken, `/messages?${params.toString()}`);
  if (!resp.ok) throw new Error(`gmail_list_${resp.status}`);
  const d = (await resp.json()) as {
    messages?: Array<{ id?: unknown; threadId?: unknown }>;
    resultSizeEstimate?: number;
    nextPageToken?: string;
  };
  const messages: GmailMessageRef[] = Array.isArray(d.messages)
    ? d.messages
        .filter((m) => m?.id != null)
        .map((m) => ({ id: String(m.id), threadId: m.threadId != null ? String(m.threadId) : null }))
    : [];
  return {
    messages,
    resultSizeEstimate: typeof d.resultSizeEstimate === "number" ? d.resultSizeEstimate : null,
    nextPageToken: d.nextPageToken ?? null,
  };
}

/** Fetch one full message resource (users.messages.get). */
export async function getGmailMessage(
  accessToken: string,
  id: string,
  format = "full",
): Promise<Record<string, unknown>> {
  const resp = await gmailFetch(accessToken, `/messages/${encodeURIComponent(id)}?format=${format}`);
  if (!resp.ok) throw new Error(`gmail_get_${resp.status}`);
  return (await resp.json()) as Record<string, unknown>;
}
