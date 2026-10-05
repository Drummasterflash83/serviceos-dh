// ServiceOS — Edge Function: google-workspace-test-connection (Email Phase-1B)
//
// Verifies Google Workspace Domain-Wide Delegation: signs a service-account JWT,
// exchanges it for a token that IMPERSONATES the configured admin subject, and
// reads that mailbox's Gmail profile to prove delegation works end-to-end.
//
// owner/admin only; tenant is bound from the caller's profile (never the
// client). The service-account private key is read from secrets and NEVER
// returned or logged. Returns a safe summary only. NO mailbox sync happens here.
//
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  getDelegatedToken,
  getPlatformWorkspaceConfig,
  verifyGmailProfile,
  WORKSPACE_SCOPES,
  type WorkspaceConfig,
} from "../_shared/google_workspace.ts";

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

  // authz — bind tenant server-side; Workspace delegation is owner/admin only.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const startedAt = new Date().toISOString();

  // Best-effort logging (email_sync_runs + audit_logs). NEVER logs key/token.
  async function logOutcome(
    status: "success" | "failed",
    errorMessage: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!supabase) return;
    try {
      await supabase.from("email_sync_runs").insert({
        tenant_id: tenantId,
        provider: "google_workspace",
        sync_type: "workspace_test",
        status,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        records_processed: 0,
        error_message: errorMessage,
        metadata,
      });
      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:google-workspace-test-connection",
        action: "google_workspace.test_connection",
        resource_type: "google_workspace_connection",
        status,
        detail: metadata,
      });
    } catch (_logErr) {
      // swallow — logging must never mask the result.
    }
  }

  // Load the tenant's saved connection (domain + admin subject live in the DB
  // now, NOT in global secrets). Most-recent wins if several domains are saved.
  const { data: connection, error: connErr } = await supabase
    .from("google_workspace_connections")
    .select("id, domain, impersonation_subject")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (connErr) return fail("db_error", "Could not load the Workspace connection", 500);
  if (!connection || !connection.domain || !connection.impersonation_subject) {
    await logOutcome("failed", "no_connection", {});
    return fail("no_connection", "Save the Workspace connection (domain + admin subject) first", 400);
  }
  const connectionId = connection.id as string;
  const domain = connection.domain as string;
  const subject = connection.impersonation_subject as string;

  async function markConnection(status: string, errorMessage: string | null): Promise<void> {
    try {
      await supabase!
        .from("google_workspace_connections")
        .update({
          status,
          error_message: errorMessage,
          last_verified_at: status === "active" ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connectionId);
    } catch (_e) {
      // never mask the real result
    }
  }

  // Platform service-account key (client email + private key from secrets only).
  const platform = getPlatformWorkspaceConfig();
  if (!platform.ok) {
    await logOutcome("failed", "platform_config_incomplete", { missing: platform.missing });
    await markConnection("error", "platform_config_incomplete");
    return fail(
      "config_error",
      `Platform service account is not configured (missing: ${platform.missing.join(", ")})`,
      500,
    );
  }
  const config: WorkspaceConfig = {
    clientEmail: platform.config.clientEmail,
    privateKey: platform.config.privateKey,
    subject,
    domain,
  };

  // 1) Obtain a delegated token impersonating the tenant's admin subject.
  let token;
  try {
    token = await getDelegatedToken(config, WORKSPACE_SCOPES);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "delegation_failed";
    await logOutcome("failed", reason, { domain, phase: "token" });
    await markConnection("error", reason);
    return fail(
      "delegation_failed",
      `Domain-wide delegation failed (${reason}). Check the service account, scopes and admin authorisation.`,
      502,
    );
  }

  // 2) Prove the token reaches the impersonated mailbox.
  let profile;
  try {
    profile = await verifyGmailProfile(token.accessToken);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "profile_failed";
    await logOutcome("failed", reason, { domain, phase: "gmail_profile" });
    await markConnection("error", reason);
    return fail(
      "verification_failed",
      `Delegation token issued but the Gmail profile could not be read (${reason}).`,
      502,
    );
  }

  const grantedScopes = token.scope ? token.scope.split(" ").filter(Boolean) : WORKSPACE_SCOPES;
  const impersonated = profile.emailAddress ?? subject;

  await markConnection("active", null);
  await logOutcome("success", null, {
    domain,
    impersonated,
    scopes: grantedScopes,
    messages_total: profile.messagesTotal,
  });

  // Safe summary only — no key, no token, no mailbox contents.
  return json({
    success: true,
    domain,
    impersonated,
    scopes: grantedScopes,
  });
});
