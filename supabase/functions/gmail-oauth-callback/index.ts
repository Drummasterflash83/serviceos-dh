// ServiceOS — Edge Function: gmail-oauth-callback (Email Phase-1)
//
// Receives Google's OAuth redirect (a top-level browser GET with NO Supabase
// JWT). Trust is established by verifying the HMAC-signed `state` minted by
// gmail-oauth-start, which binds the initiating tenant + user + return origin.
//
// On success: exchanges the code for tokens, reads the mailbox address, upserts
// email_accounts (status=active) and email_oauth_tokens (service-role only),
// logs to email_sync_runs + audit_logs, and 302s back to the app.
//
// CONNECTION ONLY — no Gmail message API is called. Tokens are NEVER logged and
// NEVER returned to the browser.
//
// Deploy with verify_jwt=false (see supabase/config.toml) — Google's redirect
// carries no JWT; security rests on the signed state + server-side exchange.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  exchangeCodeForTokens,
  fetchGmailProfile,
  getGoogleOAuthConfig,
  safeOrigin,
  verifyState,
  type TokenResponse,
} from "../_shared/gmail_oauth.ts";

/** Redirect the browser back to the app (or render a minimal page if no origin). */
function redirectBack(origin: string | null, params: Record<string, string>): Response {
  const qs = new URLSearchParams(params).toString();
  const safe = safeOrigin(origin);
  if (safe) {
    return new Response(null, { status: 302, headers: { Location: `${safe}/app?${qs}` } });
  }
  // No trusted origin to return to — render a tiny, dependency-free page.
  const ok = params.gmail === "connected";
  const body = `<!doctype html><meta charset="utf-8"><title>Gmail connection</title>
<body style="font:15px system-ui;margin:3rem auto;max-width:32rem;padding:0 1rem">
<h1 style="font-size:1.1rem">${ok ? "Gmail connected" : "Gmail connection failed"}</h1>
<p style="color:#555">${ok ? "You can close this window and return to ServiceOS." : "Please return to ServiceOS and try again."}</p>
</body>`;
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // Verify state first so we know where to redirect and which tenant is bound.
  const payload = state ? await verifyState(state) : null;
  const origin = payload ? payload.org : null;

  if (oauthError) {
    return redirectBack(origin, { gmail: "error", reason: "access_denied" });
  }
  if (!payload) {
    return redirectBack(origin, { gmail: "error", reason: "invalid_state" });
  }
  if (!code) {
    return redirectBack(origin, { gmail: "error", reason: "missing_code" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  const config = getGoogleOAuthConfig();
  if (!supabase || !config) {
    return redirectBack(origin, { gmail: "error", reason: "config_error" });
  }

  const tenantId = payload.tid;
  const startedAt = new Date().toISOString();

  // Best-effort logging. NEVER includes token material.
  async function logOutcome(
    status: "success" | "failed",
    recordsProcessed: number,
    errorMessage: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!supabase) return;
    try {
      await supabase.from("email_sync_runs").insert({
        tenant_id: tenantId,
        provider: "gmail",
        sync_type: "oauth",
        status,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        records_processed: recordsProcessed,
        error_message: errorMessage,
        metadata,
      });
      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:gmail-oauth-callback",
        action: "gmail.oauth_callback",
        resource_type: "email_account",
        status,
        detail: metadata,
      });
    } catch (_logErr) {
      // swallow — logging must never mask the result.
    }
  }

  // 1) Exchange the code for tokens (server-side).
  let tokens: TokenResponse;
  try {
    tokens = await exchangeCodeForTokens(config, code);
  } catch (_cause) {
    await logOutcome("failed", 0, "token_exchange_failed", { reason: "token_exchange" });
    return redirectBack(origin, { gmail: "error", reason: "token_exchange" });
  }
  if (!tokens.access_token) {
    await logOutcome("failed", 0, "no_access_token", { reason: "token_exchange" });
    return redirectBack(origin, { gmail: "error", reason: "token_exchange" });
  }

  // 2) Identify the connected mailbox.
  let email: string | null = null;
  let displayName: string | null = null;
  try {
    const profile = await fetchGmailProfile(tokens.access_token);
    email = profile.email;
    displayName = profile.name;
  } catch (_cause) {
    await logOutcome("failed", 0, "userinfo_failed", { reason: "userinfo" });
    return redirectBack(origin, { gmail: "error", reason: "userinfo" });
  }
  if (!email) {
    await logOutcome("failed", 0, "no_email", { reason: "userinfo" });
    return redirectBack(origin, { gmail: "error", reason: "userinfo" });
  }

  // 3) Upsert the account (Phase-0 unique key: tenant_id, provider, email_address).
  const { data: account, error: accErr } = await supabase
    .from("email_accounts")
    .upsert(
      {
        tenant_id: tenantId,
        provider: "gmail",
        email_address: email,
        display_name: displayName,
        status: "active",
        // A fresh consent clears any prior auth-failure state (self-heal §3).
        auth_state: "ok",
        auth_error: null,
        auth_state_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,provider,email_address" },
    )
    .select("id")
    .maybeSingle();
  if (accErr || !account) {
    await logOutcome("failed", 0, "account_upsert_failed", { reason: "db_account" });
    return redirectBack(origin, { gmail: "error", reason: "db" });
  }

  // 4) Upsert tokens (service-role only; RLS-closed table).
  const expiresAt =
    typeof tokens.expires_in === "number"
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;
  // Google only returns refresh_token on first consent / prompt=consent. NEVER
  // overwrite a stored refresh token with null: omit the column when absent so the
  // on-conflict UPDATE keeps the existing one (a consent response without a refresh
  // token must not turn a working mailbox into a permanently-failing one — §3).
  const tokenRow: Record<string, unknown> = {
    tenant_id: tenantId,
    email_account_id: account.id,
    provider: "gmail",
    access_token: tokens.access_token,
    expires_at: expiresAt,
    scope: tokens.scope ?? null,
    token_type: tokens.token_type ?? null,
    raw_payload: { scope: tokens.scope ?? null, token_type: tokens.token_type ?? null },
    updated_at: new Date().toISOString(),
  };
  if (tokens.refresh_token) tokenRow.refresh_token = tokens.refresh_token;
  const { error: tokErr } = await supabase
    .from("email_oauth_tokens")
    .upsert(tokenRow, { onConflict: "email_account_id" });
  if (tokErr) {
    await logOutcome("failed", 0, "token_store_failed", { reason: "db_token" });
    return redirectBack(origin, { gmail: "error", reason: "db" });
  }

  // metadata carries NO token material — only safe descriptors.
  await logOutcome("success", 1, null, {
    email_account_id: account.id,
    has_refresh_token: Boolean(tokens.refresh_token),
    scope: tokens.scope ?? null,
  });

  return redirectBack(origin, { gmail: "connected" });
});
