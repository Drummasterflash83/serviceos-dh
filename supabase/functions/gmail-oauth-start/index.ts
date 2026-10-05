// ServiceOS — Edge Function: gmail-oauth-start (Email Phase-1)
//
// An authenticated owner/admin/ops user starts the Gmail OAuth connection flow.
// The tenant + user are derived from the caller's profile (authz), NEVER from
// the client. Returns a Google consent URL the browser should redirect to.
//
// CONNECTION ONLY — no mail is read. See gmail-oauth-callback for the exchange.
//
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT
// (verify_jwt default). Reads GOOGLE_* from server-side secrets only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  buildAuthUrl,
  getGoogleOAuthConfig,
  safeOrigin,
  signState,
} from "../_shared/gmail_oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function fail(code: string, message: string, status: number): Response {
  return json({ success: false, error: { code, message } }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // authz — bind tenant/user server-side; only owner/admin/ops may connect.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId } = auth.ctx;

  const config = getGoogleOAuthConfig();
  if (!config) {
    return fail(
      "config_error",
      "Google OAuth is not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI)",
      500,
    );
  }

  // Return the browser here after the callback completes. Signed into state.
  const origin = safeOrigin(req.headers.get("Origin")) ?? "";

  const state = await signState({ tenantId, userId, origin });
  if (!state) return fail("config_error", "Unable to sign OAuth state", 500);

  const authUrl = buildAuthUrl(config, state);

  // Best-effort audit; never blocks, never logs tokens (there are none yet).
  try {
    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor: "edge:gmail-oauth-start",
      action: "gmail.oauth_start",
      resource_type: "email_account",
      status: "success",
      detail: { provider: "gmail" },
    });
  } catch (_logErr) {
    // swallow — logging must never mask the result.
  }

  return json({ success: true, auth_url: authUrl }, 200);
});
