// ServiceOS — Edge Function: google-workspace-update-mailboxes (Mailbox Admin)
//
// Enable/disable selected discovered Workspace mailboxes and keep their matching
// email_accounts in sync — WITHOUT ever deleting messages or historical data.
//
// owner/admin only; tenant-bound. Enable inserts missing DWD email_accounts
// (status pending_tokenless_dwd) and reactivates previously-disabled DWD accounts.
// Disable sets DWD email_accounts to 'disabled' but PRESERVES OAuth 'active'
// accounts (they sync via the OAuth flow, not DWD). No token/key handling here.
//
// Input: { mailbox_ids: [uuid], sync_enabled: boolean }
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";

const PROVIDER = "gmail";
const DWD_STATUS = "pending_tokenless_dwd";
const DWD_STATUSES = ["pending_tokenless_dwd", "active_dwd"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const mailboxIds = Array.isArray(body.mailbox_ids)
    ? body.mailbox_ids.filter((x): x is string => typeof x === "string" && UUID_RE.test(x))
    : [];
  if (mailboxIds.length === 0) {
    return fail("invalid_mailbox_ids", "mailbox_ids must be a non-empty array of UUIDs", 400);
  }
  const syncEnabled = body.sync_enabled !== false; // default true

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // authz — owner/admin only; tenant bound server-side.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // Update the selected mailboxes (tenant-bound — never trust the client).
  const { data: updated, error: updErr } = await supabase
    .from("google_workspace_mailboxes")
    .update({
      sync_enabled: syncEnabled,
      status: syncEnabled ? "active" : "disabled",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .in("id", mailboxIds)
    .select("email_address, display_name");
  if (updErr) return fail("db_error", `Could not update mailboxes: ${updErr.message}`, 500);
  const updatedCount = updated?.length ?? 0;

  const addresses = (updated ?? [])
    .map((m) => (m.email_address as string | null)?.toLowerCase())
    .filter((x): x is string => Boolean(x));

  let emailAccountsCreated = 0;
  let emailAccountsDisabled = 0;

  if (updatedCount > 0 && addresses.length > 0) {
    // Existing accounts for these addresses (any status).
    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id, email_address, status")
      .eq("tenant_id", tenantId)
      .eq("provider", PROVIDER)
      .in("email_address", addresses);
    const byAddr = new Map(
      (existing ?? []).map((r) => [
        (r.email_address as string)?.toLowerCase(),
        { id: r.id as string, status: r.status as string },
      ]),
    );

    if (syncEnabled) {
      // Insert accounts for mailboxes that don't have one yet.
      const toInsert = (updated ?? [])
        .filter((m) => {
          const e = (m.email_address as string | null)?.toLowerCase();
          return Boolean(e) && !byAddr.has(e as string);
        })
        .map((m) => ({
          tenant_id: tenantId,
          provider: PROVIDER,
          email_address: (m.email_address as string).toLowerCase(),
          display_name: (m.display_name as string | null) ?? null,
          status: DWD_STATUS,
        }));
      if (toInsert.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from("email_accounts")
          .insert(toInsert)
          .select("id");
        if (insErr) {
          return fail("db_error", `Could not create email accounts: ${insErr.message}`, 500);
        }
        emailAccountsCreated = inserted?.length ?? 0;
      }

      // Reactivate previously-disabled DWD accounts so enable is reversible.
      const reactivateIds = Array.from(byAddr.values())
        .filter((a) => a.status === "disabled")
        .map((a) => a.id);
      if (reactivateIds.length > 0) {
        await supabase
          .from("email_accounts")
          .update({ status: DWD_STATUS, updated_at: new Date().toISOString() })
          .in("id", reactivateIds);
      }
      // OAuth 'active' and already-DWD accounts are left untouched.
    } else {
      // Disable: only DWD accounts. PRESERVE OAuth 'active' accounts (they sync
      // via the OAuth flow). Never delete messages / history.
      const { data: disabled, error: disErr } = await supabase
        .from("email_accounts")
        .update({ status: "disabled", updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("provider", PROVIDER)
        .in("email_address", addresses)
        .in("status", DWD_STATUSES)
        .select("id");
      if (disErr) {
        return fail("db_error", `Could not disable email accounts: ${disErr.message}`, 500);
      }
      emailAccountsDisabled = disabled?.length ?? 0;
    }
  }

  try {
    await supabase.from("audit_logs").insert({
      tenant_id: tenantId,
      actor: "edge:google-workspace-update-mailboxes",
      action: "google_workspace.update_mailboxes",
      resource_type: "google_workspace_mailbox",
      status: "success",
      detail: {
        sync_enabled: syncEnabled,
        updated_count: updatedCount,
        email_accounts_created: emailAccountsCreated,
        email_accounts_disabled: emailAccountsDisabled,
      },
    });
  } catch (_e) {
    // swallow
  }

  return json({
    success: true,
    updated_count: updatedCount,
    email_accounts_created: emailAccountsCreated,
    email_accounts_disabled: emailAccountsDisabled,
  });
});
