// ServiceOS — Edge Function: gmail-sync-messages (Email Phase-2)
//
// Syncs recent Gmail messages from a connected OAuth mailbox into email_threads
// and email_messages. Metadata + plain-text/HTML body only — NO attachments, NO
// AI analysis, NO unified comms graph (later phases).
//
// authenticated owner/admin/ops; tenant bound from the caller's profile (never
// the client). The OAuth token is loaded/refreshed with the service role and is
// NEVER returned or logged. Idempotent: upserts on the unique provider ids, safe
// to re-run.
//
// Input: { email_account_id: uuid, force?: boolean, max_results?: number }
// Runtime: Supabase Edge Functions (Deno). Requires a valid Supabase Auth JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import {
  getGmailMessage,
  getGmailProfile,
  getGoogleOAuthConfig,
  HISTORY_TOO_OLD,
  listGmailHistory,
  listGmailMessages,
  RefreshError,
  refreshGmailAccessToken,
} from "../_shared/gmail_oauth.ts";
import { parseGmailMessages } from "../_shared/gmail_message.ts";

const PROVIDER = "gmail";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABELS = ["INBOX", "SENT"];
const TOKEN_SKEW_MS = 60 * 1000; // refresh if expiring within a minute

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

  // authz — bind tenant server-side; sync is owner/admin/ops.
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  const config = getGoogleOAuthConfig();
  if (!config) return fail("config_error", "Google OAuth is not configured", 500);

  // Verify the account belongs to this tenant (never trust the client).
  const { data: account, error: accErr } = await supabase
    .from("email_accounts")
    .select("id, email_address, provider, history_id")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (accErr) return fail("db_error", "Could not load the email account", 500);
  if (!account) return fail("not_found", "No Gmail account for this tenant with that id", 404);

  // Best-effort account-state stamps (feed the diagnostics table; never secrets).
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

  const startedAt = new Date().toISOString();
  const baseMetadata: Record<string, unknown> = {
    email_account_id: accountId,
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
      sync_type: "messages",
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

  // --- load + refresh the OAuth token (service role; never logged) ----------
  const { data: token, error: tokErr } = await supabase
    .from("email_oauth_tokens")
    .select("access_token, refresh_token, expires_at, scope, token_type")
    .eq("email_account_id", accountId)
    .maybeSingle();
  if (tokErr) return await finishFailed("db_error", "Could not load the OAuth token", 500);
  if (!token)
    return await finishFailed("no_token", "This mailbox is not connected (no token)", 400);

  let accessToken = (token.access_token as string | null) ?? "";
  const expMs = token.expires_at ? Date.parse(token.expires_at as string) : 0;
  if (!accessToken || !expMs || expMs - Date.now() < TOKEN_SKEW_MS) {
    const refreshToken = (token.refresh_token as string | null) ?? "";
    if (!refreshToken) {
      // Genuine reconnect condition — record honest auth state; non-retryable.
      await stampAccount({
        auth_state: "needs_reconnect",
        auth_error: "missing_refresh_token",
        auth_state_at: new Date().toISOString(),
        last_sync_error: "missing_refresh_token",
      });
      return await finishFailed("needs_reconnect", "Mailbox has no refresh token — reconnect", 401);
    }
    try {
      const refreshed = await refreshGmailAccessToken(config, refreshToken);
      accessToken = refreshed.accessToken;
      await supabase
        .from("email_oauth_tokens")
        .update({
          access_token: refreshed.accessToken,
          expires_at: refreshed.expiresIn
            ? new Date(Date.now() + refreshed.expiresIn * 1000).toISOString()
            : null,
          scope: refreshed.scope ?? (token.scope as string | null),
          token_type: refreshed.tokenType ?? (token.token_type as string | null),
          updated_at: new Date().toISOString(),
        })
        .eq("email_account_id", accountId);
      // A successful refresh HEALS any prior auth-failure state (§3).
      await stampAccount({
        auth_state: "ok",
        auth_error: null,
        auth_state_at: new Date().toISOString(),
      });
    } catch (cause) {
      // Permanent (invalid_grant/revoked) → genuine reconnect, dead-letter.
      // Transient (429/5xx/network) → leave state intact, retry later.
      const permanent = cause instanceof RefreshError ? cause.permanent : false;
      const code = cause instanceof RefreshError ? cause.code : "token_refresh_failed";
      if (permanent) {
        await stampAccount({
          auth_state: code === "refresh_token_revoked" ? "revoked" : "needs_reconnect",
          auth_error: code,
          auth_state_at: new Date().toISOString(),
          last_sync_error: code,
        });
        return await finishFailed(code, "Token refresh permanently failed — reconnect", 401);
      }
      await stampAccount({ last_sync_error: code });
      return await finishFailed("provider_temporary", "Temporary token refresh failure", 502);
    }
  }

  // --- resolve the mailbox address + capture the cursor target --------------
  // Always read the profile: it yields both the mailbox (for direction) and the
  // current historyId we advance the cursor to AFTER a successful persist (§6).
  let mailbox = ((account.email_address as string | null) ?? "").toLowerCase();
  let profileHistoryId: string | null = null;
  try {
    const profile = await getGmailProfile(accessToken);
    profileHistoryId = profile.historyId;
    if (!mailbox && profile.emailAddress) {
      mailbox = profile.emailAddress.toLowerCase();
      await stampAccount({ email_address: mailbox });
    }
  } catch (_e) {
    // non-fatal; without a fresh historyId we simply won't advance the cursor.
  }

  // --- select message ids: incremental (historyId) or recent-window fallback -
  const priorCursor = (account.history_id as string | null) ?? null;
  let candidateIds: string[] = [];
  let usedIncremental = false;
  if (priorCursor && !force) {
    try {
      const h = await listGmailHistory(accessToken, priorCursor, { labelIds: LABELS });
      candidateIds = h.messageIds;
      usedIncremental = true;
    } catch (cause) {
      // Cursor expired → fall back to the recent window and reset it below.
      if (!(cause instanceof Error && cause.message === HISTORY_TOO_OLD)) {
        return await finishFailed("gmail_history_failed", "Could not read Gmail history", 502);
      }
    }
  }
  if (!usedIncremental) {
    const refs = new Map<string, string | null>();
    try {
      for (const label of LABELS) {
        const { messages } = await listGmailMessages(accessToken, {
          maxResults,
          labelIds: [label],
        });
        for (const m of messages) if (!refs.has(m.id)) refs.set(m.id, m.threadId);
      }
    } catch (_cause) {
      return await finishFailed("gmail_list_failed", "Could not list Gmail messages", 502);
    }
    candidateIds = Array.from(refs.keys());
  }

  // Idempotent dedupe: without force, skip ids we already stored (a message added
  // to a label we already ingested must never create a duplicate row).
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
  const allIds = candidateIds;

  // --- fetch full messages, then parse via the shared parser ----------------
  // A 404/410 means the message is gone (deleted/archived) → safe to skip and let
  // the cursor advance past it. Any OTHER fetch error is transient: we keep the run
  // going but must NOT advance the cursor, so the next run re-lists the same range
  // and retries the missed message (no silently-skipped mail). Upserts are
  // idempotent, so re-processing already-stored messages is harmless.
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

  // --- advance the cursor + stamp success (AFTER persistence, §6) -----------
  // Only advance history_id once messages are safely stored AND no selected message
  // hit a transient fetch failure — otherwise the next run re-lists the same range
  // and retries, so mail is never silently skipped. A window-fallback run seeds the
  // cursor so subsequent runs are incremental.
  const successStamp: Record<string, unknown> = {
    auth_state: "ok",
    auth_error: null,
    last_incremental_success_at: new Date().toISOString(),
    last_sync_error: null,
  };
  if (profileHistoryId && !blockingFetchFailure) successStamp.history_id = profileHistoryId;
  await stampAccount(successStamp);

  const metadata = {
    ...baseMetadata,
    mailbox: mailbox || null,
    mode: usedIncremental ? "incremental" : "window",
    ids_seen: allIds.length,
    fetched: idsToFetch.length,
    threads_processed: threadRows.length,
    cursor_advanced: Boolean(profileHistoryId),
  };
  await supabase
    .from("email_sync_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      records_processed: messageRows.length,
      metadata,
    })
    .eq("id", syncRunId);

  return json({
    success: true,
    provider: PROVIDER,
    email_account_id: accountId,
    records_processed: messageRows.length,
    threads_processed: threadRows.length,
    mailbox: mailbox || null,
    mode: usedIncremental ? "incremental" : "window",
    sync_run_id: syncRunId,
  });
});
