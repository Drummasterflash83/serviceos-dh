import { captureAdmission } from "../_shared/learn_capture_control.ts";
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
  DelegationError,
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
  const admission = await captureAdmission(supabase, tenantId, "email");
  if (!admission.allowed) return fail(admission.code, admission.message, admission.httpStatus);
  const startedAt = new Date().toISOString();

  // A confirmed run receipt is required for success; audit logging is best effort.
  // NEVER logs a key or token.
  async function logOutcome(
    status: "success" | "failed",
    errorMessage: string | null,
    metadata: Record<string, unknown>,
  ): Promise<string | null> {
    let runId: string | null = null;
    try {
      const { data, error } = await supabase!
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
      runId = !error && typeof data?.id === "string" ? data.id : null;
      await supabase!.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:google-workspace-discover-mailboxes",
        action: "google_workspace.discover_mailboxes",
        resource_type: "google_workspace_connection",
        status,
        detail: metadata,
      });
    } catch (_logErr) {
      // Preserve a confirmed run receipt even if the secondary audit write fails.
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
    return fail(
      "no_connection",
      "Save the Workspace connection (domain + admin subject) first",
      400,
    );
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
    // Classified code (§4) — stored as the connection error + safe run reason.
    const code = cause instanceof DelegationError ? cause.code : "delegation_failed";
    const httpStatus = cause instanceof DelegationError && !cause.permanent ? 502 : 401;
    await supabase
      .from("google_workspace_connections")
      .update({ status: "error", error_message: code, updated_at: new Date().toISOString() })
      .eq("id", connectionId);
    await logOutcome("failed", code, { domain, phase: "token" });
    return fail(code, `Domain-wide delegation failed (${code}).`, httpStatus);
  }

  // 2) List the domain's users (Admin Directory API).
  let users;
  try {
    users = await listDirectoryUsers(token.accessToken, domain);
  } catch (cause) {
    const raw = cause instanceof Error ? cause.message : "";
    const reason =
      /^directory_(?:alias_invalid|identity_conflict|users_[0-9]{3}|request_unconfirmed|page_invalid|user_invalid|duplicate_user|cursor_invalid|cursor_repeated|scan_incomplete|page_limit_invalid|domain_invalid)$/.test(
        raw,
      )
        ? raw
        : "directory_failed";
    await logOutcome("failed", reason, { domain, phase: "directory" });
    return fail(
      "directory_failed",
      `Could not list Workspace users (${reason}). Check the directory scope + admin subject.`,
      502,
    );
  }

  // 3) Upsert mailboxes + reconcile only after a complete directory traversal.
  //    Rows absent from that traversal become 'removed' (preserving sync_enabled and
  //    the admin's choices). sync_enabled/status stay OMITTED on upsert so
  //    re-discovery never re-enables a mailbox an admin disabled.
  const seenAt = new Date().toISOString();
  const presentEmails = new Set(users.flatMap((u) => [u.email, ...u.aliases]));

  // Which addresses already existed (to count genuinely-new mailboxes)?
  const { data: existingRows, error: existingError } = await supabase
    .from("google_workspace_mailboxes")
    .select("email_address, status, directory_primary_email, directory_identity_conflict")
    .eq("tenant_id", tenantId)
    .eq("connection_id", connectionId);
  if (existingError || !Array.isArray(existingRows)) {
    await logOutcome("failed", "mailbox_inventory_unconfirmed", { domain });
    return fail("db_error", "Existing mailbox inventory could not be confirmed", 500);
  }
  const existingEmails = new Set(
    (existingRows ?? []).map((r) => (r.email_address as string).toLowerCase()),
  );
  const existingByEmail = new Map(existingRows.map((r) => [r.email_address.toLowerCase(), r]));
  const added = users.filter((u) => !existingEmails.has(u.email.toLowerCase())).length;

  if (users.length > 0) {
    // Keep already-registered aliases when Google still binds them to a user.
    // Never create all aliases as additional capture accounts or rewrite source IDs.
    const rows = users.flatMap((u) =>
      [u.email, ...u.aliases.filter((a) => existingEmails.has(a))].map((email) => ({
        tenant_id: tenantId,
        connection_id: connectionId,
        email_address: email,
        directory_primary_email: existingByEmail.get(email)?.directory_primary_email ?? u.email,
        directory_identity_conflict:
          existingByEmail.get(email)?.directory_identity_conflict === true ||
          (existingByEmail.get(email)?.directory_primary_email != null &&
            existingByEmail.get(email)?.directory_primary_email !== u.email),
        display_name: u.displayName,
        mailbox_type: u.suspended ? "suspended" : email === u.email ? "user" : "alias",
        last_seen_at: seenAt,
      })),
    );
    const { error: mbErr } = await supabase
      .from("google_workspace_mailboxes")
      .upsert(rows, { onConflict: "connection_id,email_address" });
    if (mbErr) {
      await logOutcome("failed", "mailbox_upsert_failed", { domain });
      return fail("db_error", "Could not confirm saved mailbox inventory", 500);
    }
  }

  // Prune: rows not seen this run (absent from the directory) become 'removed'.
  let removed = 0;
  const stale = (existingRows ?? []).filter(
    (r) => !presentEmails.has((r.email_address as string).toLowerCase()) && r.status !== "removed",
  );
  if (stale.length > 0) {
    const { data: pruned, error: pruneError } = await supabase
      .from("google_workspace_mailboxes")
      .update({ status: "removed", updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("connection_id", connectionId)
      .in(
        "email_address",
        stale.map((r) => r.email_address as string),
      )
      .neq("status", "removed")
      .select("id");
    if (pruneError || !Array.isArray(pruned) || pruned.length !== stale.length) {
      await logOutcome("failed", "mailbox_reconciliation_unconfirmed", { domain });
      return fail("db_error", "Mailbox reconciliation could not be confirmed", 500);
    }
    removed = pruned.length;
  }

  // Mark verified only after all directory pages and mailbox writes are confirmed.
  const { data: verified, error: verificationError } = await supabase
    .from("google_workspace_connections")
    .update({
      status: "active",
      service_account_email: platform.config.clientEmail,
      delegated_scopes: WORKSPACE_SCOPES,
      last_verified_at: new Date().toISOString(),
      error_message: null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", connectionId)
    .select("id")
    .maybeSingle();
  if (verificationError || verified?.id !== connectionId) {
    await logOutcome("failed", "connection_verification_unconfirmed", { domain });
    return fail("db_error", "Connection verification could not be saved", 500);
  }

  const syncRunId = await logOutcome("success", null, {
    domain,
    mailboxes_discovered: users.length,
    added,
    removed,
    connection_id: connectionId,
  });

  if (!syncRunId) return fail("outcome_unconfirmed", "Directory result could not be recorded", 503);

  return json({
    success: true,
    domain,
    discovered: users.length,
    added,
    removed,
    skipped: users.length - added,
    mailboxes_discovered: users.length,
    connection_id: connectionId,
    sync_run_id: syncRunId,
  });
});
