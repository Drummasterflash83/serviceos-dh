// ServiceOS — Edge Function: google-workspace-discover-mailboxes (Workspace v1)
//
// Discovers all users/mailboxes in the configured Google Workspace domain via
// Domain-Wide Delegation (a ServiceOS-owned service account impersonating the
// admin subject) and upserts them into google_workspace_connections /
// google_workspace_mailboxes. It does NOT sync any email messages.
//
// owner/admin only; tenant bound from the caller's profile (never the client).
// The service-account private key is read from secrets and NEVER returned or
// logged. Returns a safe summary only.
//
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  getDelegatedToken,
  getPlatformWorkspaceConfig,
  listDirectoryUsers,
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

  // authz — bind tenant server-side; Workspace discovery is owner/admin only.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const startedAt = new Date().toISOString();

  // Best-effort logging (email_sync_runs + audit_logs). NEVER logs key/token.
  async function logOutcome(
    status: "success" | "failed",
    errorMessage: string | null,
    metadata: Record<string, unknown>,
  ): Promise<string | null> {
    let runId: string | null = null;
    try {
      const { data } = await supabase!
        .from("email_sync_runs")
        .insert({
          tenant_id: tenantId,
          provider: "google_workspace",
          sync_type: "workspace_discover",
          status,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          records_processed: (metadata.mailboxes_discovered as number | undefined) ?? 0,
          error_message: errorMessage,
          metadata,
        })
        .select("id")
        .maybeSingle();
      runId = (data?.id as string | null) ?? null;
      await supabase!.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:google-workspace-discover-mailboxes",
        action: "google_workspace.discover_mailboxes",
        resource_type: "google_workspace_connection",
        status,
        detail: metadata,
      });
    } catch (_logErr) {
      // swallow — logging must never mask the result.
    }
    return runId;
  }

  // Load the tenant's saved connection (domain + admin subject from the DB).
  const { data: connection, error: loadErr } = await supabase
    .from("google_workspace_connections")
    .select("id, domain, impersonation_subject")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (loadErr) return fail("db_error", "Could not load the Workspace connection", 500);
  if (!connection || !connection.domain || !connection.impersonation_subject) {
    await logOutcome("failed", "no_connection", {});
    return fail("no_connection", "Save the Workspace connection (domain + admin subject) first", 400);
  }
  const connectionId = connection.id as string;
  const domain = connection.domain as string;
  const subject = connection.impersonation_subject as string;

  const platform = getPlatformWorkspaceConfig();
  if (!platform.ok) {
    await logOutcome("failed", "platform_config_incomplete", { missing: platform.missing });
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

  // 1) Delegated token impersonating the tenant's admin subject.
  let token;
  try {
    token = await getDelegatedToken(config, WORKSPACE_SCOPES);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "delegation_failed";
    await logOutcome("failed", reason, { domain, phase: "token" });
    return fail("delegation_failed", `Domain-wide delegation failed (${reason}).`, 502);
  }

  // 2) List the domain's users (Admin Directory API).
  let users;
  try {
    users = await listDirectoryUsers(token.accessToken, domain);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "directory_failed";
    await logOutcome("failed", reason, { domain, phase: "directory" });
    return fail(
      "directory_failed",
      `Could not list Workspace users (${reason}). Check the directory scope + admin subject.`,
      502,
    );
  }

  // 3) Mark the connection verified (it already exists from save-connection).
  await supabase
    .from("google_workspace_connections")
    .update({
      status: "active",
      service_account_email: platform.config.clientEmail,
      delegated_scopes: WORKSPACE_SCOPES,
      last_verified_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  // 4) Upsert mailboxes. sync_enabled/status are intentionally OMITTED so
  //    re-discovery preserves admin choices (new rows use table defaults).
  if (users.length > 0) {
    const rows = users.map((u) => ({
      tenant_id: tenantId,
      connection_id: connectionId,
      email_address: u.email,
      display_name: u.displayName,
      mailbox_type: u.suspended ? "suspended" : "user",
    }));
    const { error: mbErr } = await supabase
      .from("google_workspace_mailboxes")
      .upsert(rows, { onConflict: "connection_id,email_address" });
    if (mbErr) {
      await logOutcome("failed", `mailbox_upsert_failed: ${mbErr.message}`, { domain });
      return fail("db_error", `Could not upsert mailboxes: ${mbErr.message}`, 500);
    }
  }

  const syncRunId = await logOutcome("success", null, {
    domain,
    mailboxes_discovered: users.length,
    connection_id: connectionId,
  });

  return json({
    success: true,
    domain,
    mailboxes_discovered: users.length,
    connection_id: connectionId,
    sync_run_id: syncRunId,
  });
});
