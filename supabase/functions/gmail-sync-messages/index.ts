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
  listGmailMessages,
  refreshGmailAccessToken,
} from "../_shared/gmail_oauth.ts";

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

// --- Gmail message parsing --------------------------------------------------

function decodeB64Url(data: string): string {
  const b = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b.length % 4 ? b + "=".repeat(4 - (b.length % 4)) : b;
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

interface Part {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: Part[];
}

/** Walk the MIME tree for the first text/plain and text/html bodies. */
function extractBodies(payload: Part | undefined): {
  text: string | null;
  html: string | null;
  hasAttachments: boolean;
} {
  let text: string | null = null;
  let html: string | null = null;
  let hasAttachments = false;
  function walk(part: Part | undefined): void {
    if (!part) return;
    const mime = part.mimeType ?? "";
    if (part.filename && part.body?.attachmentId) hasAttachments = true;
    if (mime === "text/plain" && part.body?.data && text === null) {
      text = decodeB64Url(part.body.data);
    } else if (mime === "text/html" && part.body?.data && html === null) {
      html = decodeB64Url(part.body.data);
    }
    for (const p of part.parts ?? []) walk(p);
  }
  walk(payload);
  return { text, html, hasAttachments };
}

function headerMap(payload: Part | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of payload?.headers ?? []) {
    if (h?.name) map[h.name.toLowerCase()] = h.value ?? "";
  }
  return map;
}

function parseAddress(v: string): { name: string | null; email: string | null } {
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, email: m[2].trim().toLowerCase() || null };
  const e = v.trim().toLowerCase();
  return { name: null, email: e || null };
}

function parseAddressList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => parseAddress(s).email)
    .filter((x): x is string => Boolean(x));
}

function toIsoFromInternalDate(v: unknown): string | null {
  const ms = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toIsoFromDateHeader(v: string | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
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
    .select("id, email_address, provider")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (accErr) return fail("db_error", "Could not load the email account", 500);
  if (!account) return fail("not_found", "No Gmail account for this tenant with that id", 404);

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

  async function finishFailed(code: string, message: string, httpStatus: number): Promise<Response> {
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
  if (!token) return await finishFailed("no_token", "This mailbox is not connected (no token)", 400);

  let accessToken = (token.access_token as string | null) ?? "";
  const expMs = token.expires_at ? Date.parse(token.expires_at as string) : 0;
  if (!accessToken || !expMs || expMs - Date.now() < TOKEN_SKEW_MS) {
    const refreshToken = (token.refresh_token as string | null) ?? "";
    if (!refreshToken) {
      return await finishFailed("token_expired", "Access token expired and no refresh token", 401);
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
    } catch (_cause) {
      return await finishFailed("token_refresh_failed", "Could not refresh the access token", 502);
    }
  }

  // --- resolve the mailbox address (for direction) --------------------------
  let mailbox = ((account.email_address as string | null) ?? "").toLowerCase();
  if (!mailbox) {
    try {
      const profile = await getGmailProfile(accessToken);
      mailbox = (profile.emailAddress ?? "").toLowerCase();
      if (mailbox) {
        await supabase
          .from("email_accounts")
          .update({ email_address: mailbox, updated_at: new Date().toISOString() })
          .eq("id", accountId);
      }
    } catch (_e) {
      // non-fatal; direction falls back to the SENT label below.
    }
  }

  // --- list recent message ids for INBOX + SENT -----------------------------
  const refs = new Map<string, string | null>(); // id -> threadId
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

  // Incremental: without force, only fetch messages we don't already have.
  const allIds = Array.from(refs.keys());
  let idsToFetch = allIds;
  if (!force && allIds.length > 0) {
    const { data: existing } = await supabase
      .from("email_messages")
      .select("provider_message_id")
      .eq("tenant_id", tenantId)
      .eq("provider", PROVIDER)
      .in("provider_message_id", allIds);
    const have = new Set((existing ?? []).map((r) => r.provider_message_id as string));
    idsToFetch = allIds.filter((id) => !have.has(id));
  }

  // --- fetch + parse messages ----------------------------------------------
  interface ThreadAgg {
    subject: string | null;
    lastTs: string | null;
    participants: Set<string>;
  }
  const messageRows: Record<string, unknown>[] = [];
  const threads = new Map<string, ThreadAgg>();

  for (const id of idsToFetch) {
    let msg: Record<string, unknown>;
    try {
      msg = await getGmailMessage(accessToken, id, "full");
    } catch (_e) {
      continue; // skip a single unreadable message; keep the run going
    }
    const threadId = (msg.threadId as string | null) ?? refs.get(id) ?? null;
    const labelIds = Array.isArray(msg.labelIds) ? (msg.labelIds as string[]) : [];
    const payload = msg.payload as Part | undefined;
    const h = headerMap(payload);
    const bodies = extractBodies(payload);

    const fromParsed = parseAddress(h["from"] ?? "");
    const toEmails = parseAddressList(h["to"]);
    const ccEmails = parseAddressList(h["cc"]);
    const subject = h["subject"] ?? null;

    const receivedAt = toIsoFromInternalDate(msg.internalDate);
    const sentAt = toIsoFromDateHeader(h["date"]) ?? receivedAt;
    const ts = receivedAt ?? sentAt;

    const isOutbound =
      labelIds.includes("SENT") || (Boolean(mailbox) && fromParsed.email === mailbox);
    const direction = isOutbound ? "outbound" : "inbound";

    messageRows.push({
      tenant_id: tenantId,
      provider: PROVIDER,
      provider_message_id: id,
      provider_thread_id: threadId,
      from_email: fromParsed.email,
      from_name: fromParsed.name,
      to_emails: toEmails,
      cc_emails: ccEmails,
      subject,
      snippet: (msg.snippet as string | null) ?? null,
      body_text: bodies.text,
      body_html: bodies.html,
      sent_at: sentAt,
      received_at: receivedAt,
      direction,
      // Safe metadata only — NO body, NO attachment bytes, NO tokens.
      raw_payload: {
        label_ids: labelIds,
        size_estimate: (msg.sizeEstimate as number | null) ?? null,
        history_id: (msg.historyId as string | null) ?? null,
        has_attachments: bodies.hasAttachments,
      },
    });

    if (threadId) {
      const agg = threads.get(threadId) ?? {
        subject: null,
        lastTs: null,
        participants: new Set<string>(),
      };
      if (fromParsed.email) agg.participants.add(fromParsed.email);
      for (const e of toEmails) agg.participants.add(e);
      for (const e of ccEmails) agg.participants.add(e);
      if (!agg.lastTs || (ts && ts > agg.lastTs)) {
        agg.lastTs = ts;
        agg.subject = subject;
      }
      threads.set(threadId, agg);
    }
  }

  // --- upsert threads then messages (both idempotent) -----------------------
  if (threads.size > 0) {
    const threadRows = Array.from(threads.entries()).map(([provider_thread_id, agg]) => ({
      tenant_id: tenantId,
      provider: PROVIDER,
      provider_thread_id,
      subject: agg.subject,
      participants: Array.from(agg.participants),
      last_message_at: agg.lastTs,
      updated_at: new Date().toISOString(),
    }));
    const { error: thErr } = await supabase
      .from("email_threads")
      .upsert(threadRows, { onConflict: "tenant_id,provider,provider_thread_id" });
    if (thErr) return await finishFailed("db_error", `Failed to upsert threads: ${thErr.message}`, 500);
  }

  if (messageRows.length > 0) {
    const { error: msgErr } = await supabase
      .from("email_messages")
      .upsert(messageRows, { onConflict: "tenant_id,provider,provider_message_id" });
    if (msgErr) return await finishFailed("db_error", `Failed to upsert messages: ${msgErr.message}`, 500);
  }

  // --- success --------------------------------------------------------------
  const metadata = {
    ...baseMetadata,
    mailbox: mailbox || null,
    ids_seen: allIds.length,
    fetched: idsToFetch.length,
    threads_processed: threads.size,
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
    threads_processed: threads.size,
    mailbox: mailbox || null,
    sync_run_id: syncRunId,
  });
});
