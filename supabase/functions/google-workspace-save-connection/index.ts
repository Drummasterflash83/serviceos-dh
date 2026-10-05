// ServiceOS — Edge Function: google-workspace-save-connection (SaaS connector)
//
// Stores a tenant's Google Workspace connection config (domain + admin subject)
// in google_workspace_connections and returns the setup instructions the admin
// needs (the ServiceOS service-account client ID + required scopes) to authorise
// domain-wide delegation in their Google Admin console.
//
// owner/admin only; tenant bound from the caller's profile. The service-account
// client_id/email come from PLATFORM secrets, NEVER the client. The private key
// is never read or returned here. No token minting, no sync.
//
// Input: { domain, impersonation_subject }
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { getPlatformWorkspaceConfig, WORKSPACE_SCOPES } from "../_shared/google_workspace.ts";

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return fail("invalid_json", "Request body must be valid JSON", 400);
  }
  const body = (parsed ?? {}) as Record<string, unknown>;

  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : "";
  const subject =
    typeof body.impersonation_subject === "string"
      ? body.impersonation_subject.trim().toLowerCase()
      : "";
  if (!DOMAIN_RE.test(domain)) {
    return fail("invalid_domain", "domain must be a valid domain, e.g. example.co.uk", 400);
  }
  if (!EMAIL_RE.test(subject)) {
    return fail("invalid_subject", "impersonation_subject must be an admin email address", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // authz — owner/admin only; tenant bound server-side.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // Platform service-account identity (client id/email from secrets, not client).
  const platform = getPlatformWorkspaceConfig();
  const clientId = platform.ok ? platform.config.clientId : null;
  const clientEmail = platform.ok ? platform.config.clientEmail : null;

  const { data: connection, error: upErr } = await supabase
    .from("google_workspace_connections")
    .upsert(
      {
        tenant_id: tenantId,
        domain,
        impersonation_subject: subject,
        service_account_client_id: clientId,
        service_account_email: clientEmail,
        authorised_scopes: WORKSPACE_SCOPES,
        status: "pending_authorization",
        error_message: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,domain" },
    )
    .select("id")
    .maybeSingle();
  if (upErr || !connection) {
    return fail("db_error", "Could not save the Workspace connection", 500);
  }

  try {
    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor: "edge:google-workspace-save-connection",
      action: "google_workspace.save_connection",
      resource_type: "google_workspace_connection",
      resource_id: connection.id,
      status: "success",
      detail: { domain, impersonation_subject: subject },
    });
  } catch (_e) {
    // swallow
  }

  // Safe setup instructions — no secrets. The client_id is a public identifier.
  return json({
    success: true,
    connection_id: connection.id,
    client_id: clientId,
    scopes: WORKSPACE_SCOPES,
    domain,
    impersonation_subject: subject,
    status: "pending_authorization",
  });
});
