// ServiceOS — Edge Function: gmail-workspace-sync-messages (Workspace DWD sync)
//
// Syncs recent Gmail messages for a Workspace mailbox using DOMAIN-WIDE
// DELEGATION — a ServiceOS-owned service account impersonates the mailbox (no
// per-user OAuth token). Metadata + body only; NO attachments, NO AI analysis.
//
// owner/admin/ops only; tenant bound from the caller's profile. Only mailboxes
// registered as DWD email_accounts (status pending_tokenless_dwd | active_dwd)
// are eligible — OAuth accounts (status 'active') are never DWD-synced here, so
// the existing OAuth flow is untouched. The service-account key is read from
// secrets and NEVER returned or logged.
//
// Input: { email_account_id: uuid, force?: boolean, max_results?: number }
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import {
  getGmailMessage,
  getGmailProfile,
  HISTORY_TOO_OLD,
  listGmailHistory,
  listGmailMessages,
} from "../_shared/gmail_oauth.ts";
import { DelegationError, getDelegatedGmailToken } from "../_shared/google_workspace.ts";
import { parseGmailMessages } from "../_shared/gmail_message.ts";

const PROVIDER = "gmail";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABELS = ["INBOX", "SENT"];
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
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(100, Math.trunc(n)));
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
  const force = body.force === true;
  const maxResults = clampMaxResults(body.max_results);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // authz — bind tenant server-side; DWD sync is owner/admin/ops.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // Verify the account belongs to this tenant AND is a DWD mailbox.
  const { data: account, error: accErr } = await supabase
    .from("email_accounts")
    .select("id, email_address, status, history_id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (accErr) return fail("db_error", "Could not load the email account", 500);
  if (!account) return fail("not_found", "No Gmail account for this tenant with that id", 404);
  const mailbox = ((account.email_address as string | null) ?? "").toLowerCase();
  if (!mailbox) return fail("invalid_account", "The account has no email address", 400);
  if (account.status === "disabled") {
    return fail("mailbox_disabled", "This mailbox is disabled; enable it before syncing", 400);
  }
  if (!DWD_STATUSES.includes(account.status as string)) {
    return fail(
      "not_dwd_account",
      "This account is not a Workspace DWD mailbox (use gmail-sync-messages for OAuth accounts)",
      400,
    );
  }

  // Resolve the tenant's Workspace connection (for auditing). The delegated
  // token impersonates the mailbox using the PLATFORM key — no global
  // domain/subject is used here.
  const { data: connection } = await supabase
    .from("google_workspace_connections")
    .select("id")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const startedAt = new Date().toISOString();
  const baseMetadata: Record<string, unknown> = {
    email_account_id: accountId,
    mailbox,
    connection_id: (connection?.id as string | null) ?? null,
    max_results: maxResults,
    labels: LABELS,
    force,
  };

  // Open a sync run so even a mid-run failure is auditable.
  const { data: runRow, error: runErr } = await supabase
    .from("email_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "workspace_messages",
      status: "running",
      started_at: startedAt,
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) return fail("db_error", "Could not open a sync run", 500);
  const syncRunId = runRow.id as string;

  async function finishFailed(
    code: string,
    message: string,
    httpStatus: number,
  ): Promise<Response> {
    try {
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

  async function stampAccount(patch: Record<string, unknown>): Promise<void> {
    try {
      await supabase!
        .from("email_accounts")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", accountId);
    } catch (_e) {
      // never mask the real result
    }
  }
  await stampAccount({ last_incremental_attempt_at: new Date().toISOString() });

  // --- mint a delegated token impersonating the mailbox ---------------------
  let accessToken: string;
  try {
    const token = await getDelegatedGmailToken(mailbox);
    accessToken = token.accessToken;
  } catch (cause) {
    // Classify: a permanent authz/config failure dead-letters with a specific
    // code; a transient Google error stays retryable. Never a permanent latch.
    const code = cause instanceof DelegationError ? cause.code : "delegation_failed";
    const httpStatus = cause instanceof DelegationError && !cause.permanent ? 502 : 401;
    await stampAccount({ last_sync_error: code });
    return await finishFailed(code, `Domain-wide delegation failed (${code})`, httpStatus);
  }

  // --- capture the cursor target (profile historyId) ------------------------
  let profileHistoryId: string | null = null;
  try {
    profileHistoryId = (await getGmailProfile(accessToken)).historyId;
  } catch (_e) {
    // non-fatal; we simply won't advance the cursor this run.
  }

  // --- select ids: incremental (historyId) or recent-window fallback --------
  const priorCursor = (account.history_id as string | null) ?? null;
  let candidateIds: string[] = [];
  let usedIncremental = false;
  if (priorCursor && !force) {
    try {
      candidateIds = (await listGmailHistory(accessToken, priorCursor, { labelIds: LABELS }))
        .messageIds;
      usedIncremental = true;
    } catch (cause) {
      if (!(cause instanceof Error && cause.message === HISTORY_TOO_OLD)) {
        return await finishFailed("gmail_history_failed", "Could not read Gmail history", 502);
      }
    }
  }
  if (!usedIncremental) {
    const refs = new Set<string>();
    try {
      for (const label of LABELS) {
        const { messages } = await listGmailMessages(accessToken, {
          maxResults,
          labelIds: [label],
        });
        for (const m of messages) refs.add(m.id);
      }
    } catch (_cause) {
      return await finishFailed("gmail_list_failed", "Could not list Gmail messages", 502);
    }
    candidateIds = Array.from(refs);
  }

  // Idempotent dedupe: without force, skip ids we already stored.
  const allIds = candidateIds;
  let idsToFetch = candidateIds;
  if (!force && candidateIds.length > 0) {
    const { data: existing } = await supabase
      .from("email_messages")
      .select("provider_message_id")
      .eq("tenant_id", tenantId)
      .eq("provider", PROVIDER)
      .in("provider_message_id", candidateIds);
    const have = new Set((existing ?? []).map((r) => r.provider_message_id as string));
    idsToFetch = candidateIds.filter((id) => !have.has(id));
  }

  // --- fetch full messages then parse via the shared parser -----------------
  // 404/410 = message gone → skip and let the cursor advance. Any other fetch
  // error is transient: keep going but block the cursor advance so the next run
  // retries the missed message (idempotent upserts make re-processing safe).
  const rawMessages: Record<string, unknown>[] = [];
  let blockingFetchFailure = false;
  for (const id of idsToFetch) {
    try {
      rawMessages.push(await getGmailMessage(accessToken, id, "full"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!(msg.endsWith("_404") || msg.endsWith("_410"))) blockingFetchFailure = true;
      continue;
    }
  }
  const { messageRows, threadRows } = parseGmailMessages(rawMessages, {
    tenantId,
    provider: PROVIDER,
    mailbox,
  });

  // --- upsert threads then messages (both idempotent) -----------------------
  if (threadRows.length > 0) {
    const { error: thErr } = await supabase
      .from("email_threads")
      .upsert(threadRows, { onConflict: "tenant_id,provider,provider_thread_id" });
    if (thErr)
      return await finishFailed("db_error", `Failed to upsert threads: ${thErr.message}`, 500);
  }
  if (messageRows.length > 0) {
    const { error: msgErr } = await supabase
      .from("email_messages")
      .upsert(messageRows, { onConflict: "tenant_id,provider,provider_message_id" });
    if (msgErr)
      return await finishFailed("db_error", `Failed to upsert messages: ${msgErr.message}`, 500);
  }

  // On success, promote the account to active_dwd (preserve OAuth 'active') and
  // advance the cursor + heal state AFTER persistence (§6).
  const successStamp: Record<string, unknown> = {
    status: "active_dwd",
    last_incremental_success_at: new Date().toISOString(),
    last_sync_error: null,
  };
  if (profileHistoryId && !blockingFetchFailure) successStamp.history_id = profileHistoryId;
  await supabase
    .from("email_accounts")
    .update({ ...successStamp, updated_at: new Date().toISOString() })
    .eq("id", accountId)
    .in("status", DWD_STATUSES);

  // A successful delegated sync PROVES delegation → self-heal a latched
  // connection error so "Re-test delegation" stops recurring (§4/§11). The health
  // model also treats this success as newer than any past delegation failure.
  if (connection?.id) {
    await supabase
      .from("google_workspace_connections")
      .update({
        status: "active",
        error_message: null,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id as string)
      .eq("tenant_id", tenantId)
      .eq("status", "error");
  }

  await supabase
    .from("email_sync_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      records_processed: messageRows.length,
      metadata: {
        ...baseMetadata,
        mode: usedIncremental ? "incremental" : "window",
        ids_seen: allIds.length,
        fetched: idsToFetch.length,
        threads_processed: threadRows.length,
        cursor_advanced: Boolean(profileHistoryId),
      },
    })
    .eq("id", syncRunId);

  return json({
    success: true,
    provider: PROVIDER,
    email_account_id: accountId,
    records_processed: messageRows.length,
    threads_processed: threadRows.length,
    mailbox,
    sync_run_id: syncRunId,
  });
});
