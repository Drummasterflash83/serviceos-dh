// ServiceOS — Reusable provider OAuth framework (PKCE + one-time, expiring, bound state).
//
// Provider-neutral delegated authorization: start() mints a PKCE verifier/challenge and a
// one-time state bound to (tenant, user, provider), persists them SERVER-SIDE (never the
// browser), and returns the authorize URL. consumeState() validates state existence, expiry
// and single-use, and returns the server-held verifier for the token exchange. Issued tokens
// are handed to the credential broker → Vault; they never touch browser-readable storage.
//
// A real provider plugs in its authorize/token endpoints (client id is non-secret and read
// from platform config; the client secret, if any, stays in Edge secrets and is used only in
// the server-side token exchange). The oauth_demo adapter exercises the whole path in dev.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(len = 32): string {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return b64url(a);
}

async function s256(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return b64url(new Uint8Array(digest));
}

export interface StartOAuthInput {
  db: SupabaseClient;
  tenantId: string;
  provider: string;
  userId: string | null;
  scopes: string[];
  redirectUri: string;
  /** Non-secret provider authorize endpoint base + client id, resolved by the caller. */
  authorizeBase: string;
  clientId: string;
  usePkce: boolean;
}

export interface StartOAuthResult {
  authorizeUrl: string;
  state: string;
}

/** Begin an OAuth flow: persist bound one-time state (+PKCE) and return the authorize URL. */
export async function startOAuth(input: StartOAuthInput): Promise<StartOAuthResult> {
  const state = randomToken();
  const verifier = input.usePkce ? randomToken(48) : null;
  const challenge = verifier ? await s256(verifier) : null;
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  await input.db.from("provider_oauth_states").insert({
    tenant_id: input.tenantId,
    provider: input.provider,
    state,
    code_challenge: challenge,
    code_verifier: verifier, // server-held only
    redirect_uri: input.redirectUri,
    scopes: input.scopes,
    created_by: input.userId,
    expires_at: expiresAt,
  });

  const u = new URL(input.authorizeBase);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", input.clientId);
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("scope", input.scopes.join(" "));
  u.searchParams.set("state", state);
  if (challenge) {
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return { authorizeUrl: u.toString(), state };
}

export type ConsumeResult =
  | { ok: false; code: string; message: string }
  | {
      ok: true;
      tenantId: string;
      provider: string;
      codeVerifier: string | null;
      redirectUri: string | null;
      scopes: string[];
      userId: string | null;
    };

/**
 * Validate + CONSUME an OAuth state (one-time). Rejects unknown, expired, or already-used
 * states. On success marks it used and returns the server-held verifier for token exchange.
 */
export async function consumeState(db: SupabaseClient, state: string): Promise<ConsumeResult> {
  if (!state || typeof state !== "string") {
    return { ok: false, code: "invalid_state", message: "Missing state" };
  }
  const { data: row } = await db
    .from("provider_oauth_states")
    .select("tenant_id,provider,code_verifier,redirect_uri,scopes,created_by,expires_at,used_at")
    .eq("state", state)
    .maybeSingle();
  if (!row) return { ok: false, code: "invalid_state", message: "Unknown or forged state" };
  if (row.used_at) return { ok: false, code: "state_reused", message: "State already used" };
  if (new Date(row.expires_at as string).getTime() < Date.now()) {
    return { ok: false, code: "state_expired", message: "Authorization state expired" };
  }
  // Consume atomically-ish: only succeed if it is still unused.
  const { data: consumed } = await db
    .from("provider_oauth_states")
    .update({ used_at: new Date().toISOString() })
    .eq("state", state)
    .is("used_at", null)
    .select("state")
    .maybeSingle();
  if (!consumed) return { ok: false, code: "state_reused", message: "State already used" };

  return {
    ok: true,
    tenantId: row.tenant_id as string,
    provider: row.provider as string,
    codeVerifier: (row.code_verifier as string | null) ?? null,
    redirectUri: (row.redirect_uri as string | null) ?? null,
    scopes: (row.scopes as string[] | null) ?? [],
    userId: (row.created_by as string | null) ?? null,
  };
}

/** Best-effort GC of expired/used state rows for a tenant (called opportunistically). */
export async function purgeOldStates(db: SupabaseClient, tenantId: string): Promise<void> {
  await db
    .from("provider_oauth_states")
    .delete()
    .eq("tenant_id", tenantId)
    .lt("expires_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
}
