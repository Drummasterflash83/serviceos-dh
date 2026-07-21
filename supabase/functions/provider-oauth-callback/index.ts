// ServiceOS — Edge Function: provider-oauth-callback.
//
// The browser-redirect target for the reusable telephony OAuth framework. verify_jwt = false
// (the provider redirect carries no Supabase JWT); ALL trust comes from the one-time,
// expiring, tenant/user-bound `state` consumed here (see _shared/telephony/oauth.ts). The
// state row carries the tenant binding — a client-supplied tenant is never trusted.
//
// Flow: validate+consume state → exchange code for tokens server-side → store tokens in Vault
// via the credential broker → mark the connection configured → redirect back to the wizard.
// Tokens NEVER reach browser-readable storage and are never placed in the redirect URL.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { consumeState } from "../_shared/telephony/oauth.ts";
import { storeCredential, logConnectionEvent } from "../_shared/telephony/credential_broker.ts";
import { getConnectionSpec } from "../_shared/telephony/registry.ts";

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } });
}

function returnUrl(provider: string, ok: boolean, code?: string): string {
  const base = Deno.env.get(`PROVIDER_OAUTH_${provider.toUpperCase()}_RETURN_URL`)
    ?? Deno.env.get("PROVIDER_OAUTH_RETURN_URL")
    ?? "/#/settings";
  const sep = base.includes("?") ? "&" : "?";
  const status = ok ? "connected" : "error";
  return `${base}${sep}provider=${encodeURIComponent(provider)}&oauth=${status}${code ? `&reason=${encodeURIComponent(code)}` : ""}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const db = createSupabaseAdmin();
  if (!db) return new Response("config error", { status: 500 });

  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const providerError = url.searchParams.get("error");

  // 1. Consume + validate the one-time state (binds tenant/provider server-side).
  const consumed = await consumeState(db, state);
  if (!consumed.ok) {
    // No tenant context we can trust — cannot audit against a tenant; fail closed.
    return redirect(returnUrl("unknown", false, consumed.code));
  }
  const { tenantId, provider, codeVerifier, userId } = consumed;

  if (providerError) {
    await logConnectionEvent(db, tenantId, provider, "oauth_failed", userId, { reason: "provider_denied" });
    return redirect(returnUrl(provider, false, "denied"));
  }
  if (!code) {
    await logConnectionEvent(db, tenantId, provider, "oauth_failed", userId, { reason: "missing_code" });
    return redirect(returnUrl(provider, false, "missing_code"));
  }

  const spec = getConnectionSpec(provider);
  if (!spec?.oauth?.supported) {
    await logConnectionEvent(db, tenantId, provider, "oauth_failed", userId, { reason: "oauth_unsupported" });
    return redirect(returnUrl(provider, false, "unsupported"));
  }

  // 2. Exchange the code for tokens SERVER-SIDE.
  let tokens: { access_token: string; refresh_token?: string } | null = null;
  const up = provider.toUpperCase();
  const tokenUrl = Deno.env.get(`PROVIDER_OAUTH_${up}_TOKEN_URL`);
  const clientId = Deno.env.get(`PROVIDER_OAUTH_${up}_CLIENT_ID`) ?? "serviceos-demo";
  const clientSecret = Deno.env.get(`PROVIDER_OAUTH_${up}_CLIENT_SECRET`); // stays server-side
  const redirectUri = consumed.redirectUri ?? "";

  if (tokenUrl) {
    // Real provider token exchange (generic OAuth2 authorization_code + PKCE).
    try {
      const form = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
      });
      if (clientSecret) form.set("client_secret", clientSecret);
      if (codeVerifier) form.set("code_verifier", codeVerifier);
      const resp = await fetch(tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
      if (resp.ok) {
        const j = (await resp.json()) as { access_token?: string; refresh_token?: string };
        if (j.access_token) tokens = { access_token: j.access_token, refresh_token: j.refresh_token };
      }
    } catch {
      tokens = null; // sanitised — never surface upstream error bodies
    }
  } else if (provider === "oauth_demo") {
    // Dev-only synthetic issuance to exercise the framework end to end (clearly not a real
    // provider). Real providers must configure PROVIDER_OAUTH_<P>_TOKEN_URL above.
    tokens = { access_token: `demo-access-${state.slice(0, 8)}`, refresh_token: `demo-refresh-${state.slice(0, 8)}` };
  }

  if (!tokens) {
    await logConnectionEvent(db, tenantId, provider, "oauth_failed", userId, { reason: "token_exchange_failed" });
    return redirect(returnUrl(provider, false, "token_exchange"));
  }

  // 3. Store tokens in Vault via the broker (never returned to the browser).
  const secrets: Record<string, string> = { oauth_access_token: tokens.access_token };
  if (tokens.refresh_token) secrets.oauth_refresh_token = tokens.refresh_token;
  await storeCredential(db, tenantId, provider, {
    authMode: "oauth",
    secrets,
    nonSecret: {}, // non-secret config was persisted at oauth_start
    accountRefField: spec.accountRefField ?? null,
    actorId: userId,
  });

  // Advance onboarding to connection_verified.
  await db
    .from("telephony_onboarding")
    .update({ stage: "connection_verified", stage_status: "done", completion_pct: 33, last_success_action: "oauth", updated_by: userId })
    .eq("tenant_id", tenantId)
    .eq("provider", provider);
  await logConnectionEvent(db, tenantId, provider, "oauth_completed", userId, {});

  return redirect(returnUrl(provider, true));
});
