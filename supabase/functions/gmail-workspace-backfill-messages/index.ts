// ServiceOS — Edge Function: gmail-workspace-backfill-messages (DWD backfill)
//
// Imports HISTORICAL Gmail for one Workspace DWD mailbox, one page at a time, so
// large mailboxes fill in safely over many runs without timeouts. Resumable via
// email_accounts.backfill_page_token. Idempotent (upsert on provider ids) — never
// duplicates, never deletes. Metadata + body only; NO attachments, NO AI.
//
// owner/admin/ops only; tenant-bound. Only DWD mailboxes
// (pending_tokenless_dwd | active_dwd) — disabled/OAuth accounts are rejected, so
// the OAuth flow and the 5-minute recent sync are untouched. Service-account key
// read from secrets; NEVER returned or logged.
//
// Input: { email_account_id: uuid, restart?: boolean, max_results?: number }
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import { getGmailMessage, listGmailMessages } from "../_shared/gmail_oauth.ts";
import { getDelegatedGmailToken } from "../_shared/google_workspace.ts";
import { parseGmailMessages } from "../_shared/gmail_message.ts";

const PROVIDER = "gmail";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DWD_STATUSES = ["pending_tokenless_dwd", "active_dwd"];

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

function clampMaxResults(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(n)));
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

  const accountId = typeof body.email_account_id === "string" ? body.email_account_id.trim() : "";
  if (!UUID_RE.test(accountId)) {
    return fail("invalid_email_account_id", "email_account_id must be a UUID", 400);
  }
  const restart = body.restart === true;
  const maxResults = clampMaxResults(body.max_results);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // authz — bind tenant server-side; backfill is owner/admin/ops.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // Verify the account belongs to this tenant AND is a DWD mailbox.
  const { data: account, error: accErr } = await supabase
    .from("email_accounts")
    .select("id, email_address, status, backfill_status, backfill_page_token, backfill_total_fetched")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (accErr) return fail("db_error", "Could not load the email account", 500);
  if (!account) return fail("not_found", "No Gmail account for this tenant with that id", 404);
  const mailbox = ((account.email_address as string | null) ?? "").toLowerCase();
  if (!mailbox) return fail("invalid_account", "The account has no email address", 400);
  if (account.status === "disabled") {
    return fail("mailbox_disabled", "This mailbox is disabled; enable it before backfilling", 400);
  }
  if (!DWD_STATUSES.includes(account.status as string)) {
    return fail("not_dwd_account", "This account is not a Workspace DWD mailbox", 400);
  }

  // Continuing an already-completed backfill is a no-op unless restart is set.
  if (!restart && account.backfill_status === "completed") {
    return json({
      success: true,
      email_account_id: accountId,
      mailbox,
      records_processed: 0,
      threads_processed: 0,
      total_fetched: (account.backfill_total_fetched as number | null) ?? 0,
      has_more: false,
      backfill_status: "completed",
      sync_run_id: null,
    });
  }

  const priorTotal = restart ? 0 : ((account.backfill_total_fetched as number | null) ?? 0);
  const pageToken = restart
    ? undefined
    : ((account.backfill_page_token as string | null) ?? undefined);
  const nowIso = new Date().toISOString();

  const baseMetadata: Record<string, unknown> = {
    email_account_id: accountId,
    mailbox,
    max_results: maxResults,
    restart,
    prior_total: priorTotal,
  };

  // Open a sync run so even a mid-run failure is auditable.
  const { data: runRow, error: runErr } = await supabase
    .from("email_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "workspace_backfill",
      status: "running",
      started_at: nowIso,
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) return fail("db_error", "Could not open a sync run", 500);
  const syncRunId = runRow.id as string;

  // Mark the account backfill running (and stamp started_at on a restart).
  await supabase
    .from("email_accounts")
    .update({
      backfill_status: "running",
      backfill_error: null,
      updated_at: nowIso,
      ...(restart ? { backfill_started_at: nowIso, backfill_completed_at: null } : {}),
    })
    .eq("id", accountId);

  async function backfillFailed(code: string, message: string, httpStatus: number): Promise<Response> {
    try {
      await supabase!
        .from("email_accounts")
        .update({ backfill_status: "error", backfill_error: code, updated_at: new Date().toISOString() })
        .eq("id", accountId);
      await supabase!
        .from("email_sync_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          records_processed: 0,
          error_message: message,
          metadata: { ...baseMetadata, error_code: code },
        })
        .eq("id", syncRunId);
    } catch (_e) {
      // never mask the real error
    }
    return json({ success: false, sync_run_id: syncRunId, error: { code, message } }, httpStatus);
  }

  // Delegated token impersonating the mailbox (platform key).
  let accessToken: string;
  try {
    const token = await getDelegatedGmailToken(mailbox);
    accessToken = token.accessToken;
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "delegation_failed";
    return await backfillFailed("delegation_failed", `Domain-wide delegation failed (${reason})`, 502);
  }

  // One page of ALL mail (no label filter → historical, excludes spam/trash).
  let allIds: string[];
  let nextPageToken: string | null;
  try {
    const listed = await listGmailMessages(accessToken, { maxResults, pageToken });
    allIds = listed.messages.map((m) => m.id);
    nextPageToken = listed.nextPageToken;
  } catch (_cause) {
    return await backfillFailed("gmail_list_failed", "Could not list Gmail messages", 502);
  }

  // Idempotent: only fetch messages we don't already have.
  let idsToFetch = allIds;
  if (allIds.length > 0) {
    const { data: existing } = await supabase
      .from("email_messages")
      .select("provider_message_id")
      .eq("tenant_id", tenantId)
      .eq("provider", PROVIDER)
      .in("provider_message_id", allIds);
    const have = new Set((existing ?? []).map((r) => r.provider_message_id as string));
    idsToFetch = allIds.filter((id) => !have.has(id));
  }

  const rawMessages: Record<string, unknown>[] = [];
  for (const id of idsToFetch) {
    try {
      rawMessages.push(await getGmailMessage(accessToken, id, "full"));
    } catch (_e) {
      continue;
    }
  }
  const { messageRows, threadRows } = parseGmailMessages(rawMessages, {
    tenantId,
    provider: PROVIDER,
    mailbox,
  });

  if (threadRows.length > 0) {
    const { error: thErr } = await supabase
      .from("email_threads")
      .upsert(threadRows, { onConflict: "tenant_id,provider,provider_thread_id" });
    if (thErr) return await backfillFailed("db_error", `Failed to upsert threads: ${thErr.message}`, 500);
  }
  if (messageRows.length > 0) {
    const { error: msgErr } = await supabase
      .from("email_messages")
      .upsert(messageRows, { onConflict: "tenant_id,provider,provider_message_id" });
    if (msgErr) return await backfillFailed("db_error", `Failed to upsert messages: ${msgErr.message}`, 500);
  }

  const totalFetched = priorTotal + allIds.length;
  const hasMore = Boolean(nextPageToken);
  const backfillStatus = hasMore ? "running" : "completed";
  const completedAt = hasMore ? null : new Date().toISOString();

  // Persist resumable state + promote pending_tokenless_dwd → active_dwd.
  await supabase
    .from("email_accounts")
    .update({
      status: "active_dwd",
      backfill_status: backfillStatus,
      backfill_page_token: nextPageToken,
      backfill_total_fetched: totalFetched,
      backfill_completed_at: completedAt,
      backfill_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId)
    .in("status", DWD_STATUSES);

  await supabase
    .from("email_sync_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      records_processed: messageRows.length,
      metadata: {
        ...baseMetadata,
        ids_seen: allIds.length,
        fetched: idsToFetch.length,
        threads_processed: threadRows.length,
        total_fetched: totalFetched,
        has_more: hasMore,
        backfill_status: backfillStatus,
      },
    })
    .eq("id", syncRunId);

  return json({
    success: true,
    provider: PROVIDER,
    email_account_id: accountId,
    mailbox,
    records_processed: messageRows.length,
    threads_processed: threadRows.length,
    total_fetched: totalFetched,
    has_more: hasMore,
    backfill_status: backfillStatus,
    sync_run_id: syncRunId,
  });
});
