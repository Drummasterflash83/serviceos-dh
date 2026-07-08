/**
 * Tenant-scoped email feed — client-side reads under RLS (Email Input Phase-0).
 *
 * Uses the browser Supabase client (the signed-in user's session), so every
 * query is filtered to the caller's tenant by the SELECT policies added in the
 * email foundation migration. NO service role, NO tenant_id passed by the
 * client. Mirrors `./phone-feed`.
 *
 * The feed is thread-centric and composed from several RLS-scoped reads because
 * `email_messages` links to `email_threads` by `provider_thread_id` (text) —
 * which PostgREST cannot auto-embed — and `email_ai_insights` links to messages
 * by uuid. Phase-0 has no data yet; nothing is wired to any UI.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type {
  ApiResult,
  EmailAccount,
  EmailFeedInput,
  EmailFeedItem,
  EmailInsight,
  EmailThreadDetail,
  EmailThreadMessage,
  GoogleWorkspaceConnection,
  GoogleWorkspaceMailboxWithAccount,
} from "./types";

/**
 * Read the tenant's most-recent Google Workspace connection (RLS-scoped browser
 * read), or null if none. Used by Admin to prefill domain/subject and show the
 * connection status + ServiceOS client id. No secrets are exposed — the
 * service-account key never lives in this table.
 */
export async function getWorkspaceConnection(): Promise<
  ApiResult<GoogleWorkspaceConnection | null>
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("google_workspace_connections")
    .select(
      "id, tenant_id, domain, impersonation_subject, service_account_client_id, service_account_email, authorised_scopes, status, last_verified_at, error_message, created_at, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data as GoogleWorkspaceConnection | null) ?? null };
}

/**
 * List discovered Google Workspace mailboxes for a connection (RLS-scoped
 * browser read). Used by Admin after discovery to render the selectable list.
 * No tokens/keys are exposed — those live only in Edge Function secrets.
 */
export async function listWorkspaceMailboxes(
  connectionId: string,
): Promise<ApiResult<GoogleWorkspaceMailboxWithAccount[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  if (typeof connectionId !== "string" || connectionId.trim() === "") {
    return {
      ok: false,
      error: { code: "invalid_connection_id", message: "connectionId required" },
    };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("google_workspace_mailboxes")
    .select(
      "id, tenant_id, connection_id, email_address, display_name, mailbox_type, sync_enabled, status, created_at, updated_at",
    )
    .eq("connection_id", connectionId)
    .order("email_address", { ascending: true });
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  const mailboxes = (data ?? []) as GoogleWorkspaceMailboxWithAccount[];

  // Join the matching gmail email_accounts (by address) so the admin can see
  // each mailbox's account status/id — both tables are RLS-scoped to the tenant.
  const addresses = Array.from(
    new Set(mailboxes.map((m) => m.email_address?.toLowerCase()).filter(Boolean)),
  ) as string[];
  const acctByAddr = new Map<string, { id: string; status: string }>();
  if (addresses.length > 0) {
    const { data: accts, error: acctErr } = await supabase
      .from("email_accounts")
      .select("id, email_address, status")
      .eq("provider", "gmail")
      .in("email_address", addresses);
    if (acctErr) return { ok: false, error: { code: "query_error", message: acctErr.message } };
    for (const a of accts ?? []) {
      const addr = (a.email_address as string | null)?.toLowerCase();
      if (addr && !acctByAddr.has(addr)) {
        acctByAddr.set(addr, { id: a.id as string, status: a.status as string });
      }
    }
  }

  return {
    ok: true,
    data: mailboxes.map((m) => {
      const acct = acctByAddr.get(m.email_address?.toLowerCase() ?? "");
      return { ...m, account_id: acct?.id ?? null, account_status: acct?.status ?? null };
    }),
  };
}

/**
 * List the tenant's connected email accounts (RLS-scoped browser read). Used by
 * Admin to show/pick a connected mailbox. No tokens are ever exposed here — the
 * `email_oauth_tokens` table is RLS-closed and never queried from the client.
 */
export async function listEmailAccounts(provider?: string): Promise<ApiResult<EmailAccount[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  let query = supabase
    .from("email_accounts")
    .select("id, tenant_id, provider, email_address, display_name, status, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (provider) query = query.eq("provider", provider);

  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as EmailAccount[] };
}

function clampLimit(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 100;
  return Math.max(1, Math.min(500, n));
}

/** Coerce a jsonb array into a clean string[] (drops non-string entries). */
function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

interface ThreadRow {
  id: string;
  provider_thread_id: string | null;
  subject: string | null;
  participants: unknown;
  last_message_at: string | null;
}

interface MessageRow {
  id: string;
  provider_thread_id: string | null;
  from_email: string | null;
  from_name: string | null;
  snippet: string | null;
  direction: string | null;
  received_at: string | null;
}

interface InsightRow {
  id: string;
  tenant_id: string;
  message_id: string | null;
  thread_id: string | null;
  intent: string | null;
  urgency: string | null;
  sentiment: string | null;
  summary: string | null;
  action_required: boolean | null;
  suggested_owner: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch a composed, tenant-scoped email feed: one record per thread, carrying
 * the thread's latest message and that message's AI insight (if any). The heavy
 * message bodies are intentionally not fetched here — use `getEmailThreadDetail`.
 */
export async function getEmailFeed(
  input: EmailFeedInput = {},
): Promise<ApiResult<EmailFeedItem[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const limit = clampLimit(input.limit);

  // 1) Threads — RLS scopes to the caller's tenant.
  let threadQuery = supabase
    .from("email_threads")
    .select("id, provider_thread_id, subject, participants, last_message_at")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (input.from) threadQuery = threadQuery.gte("last_message_at", input.from);
  if (input.to) threadQuery = threadQuery.lte("last_message_at", input.to);

  const { data: threads, error: threadErr } = await threadQuery;
  if (threadErr) return { ok: false, error: { code: "query_error", message: threadErr.message } };
  const threadRows = (threads ?? []) as ThreadRow[];

  // 2) Latest message per thread (RLS-scoped), keyed by provider_thread_id.
  const providerThreadIds = Array.from(
    new Set(threadRows.map((t) => t.provider_thread_id).filter((x): x is string => Boolean(x))),
  );
  const latestByThread = new Map<string, MessageRow>();
  if (providerThreadIds.length > 0) {
    const { data: msgs, error: msgErr } = await supabase
      .from("email_messages")
      .select("id, provider_thread_id, from_email, from_name, snippet, direction, received_at")
      .in("provider_thread_id", providerThreadIds)
      .order("received_at", { ascending: false, nullsFirst: false });
    if (msgErr) return { ok: false, error: { code: "query_error", message: msgErr.message } };
    for (const m of (msgs ?? []) as MessageRow[]) {
      // First seen = most recent by received_at (already ordered desc).
      if (m.provider_thread_id && !latestByThread.has(m.provider_thread_id)) {
        latestByThread.set(m.provider_thread_id, m);
      }
    }
  }

  // 3) Insights for those latest messages (RLS-scoped), keyed by message_id.
  const latestMessageIds = Array.from(
    new Set(Array.from(latestByThread.values()).map((m) => m.id)),
  );
  const insightByMessage = new Map<string, InsightRow>();
  if (latestMessageIds.length > 0) {
    const { data: ins, error: insErr } = await supabase
      .from("email_ai_insights")
      .select(
        "id, tenant_id, message_id, thread_id, intent, urgency, sentiment, summary, action_required, suggested_owner, confidence, created_at, updated_at",
      )
      .in("message_id", latestMessageIds)
      .order("created_at", { ascending: false, nullsFirst: false });
    if (insErr) return { ok: false, error: { code: "query_error", message: insErr.message } };
    for (const i of (ins ?? []) as InsightRow[]) {
      // First seen = most recent by created_at (already ordered desc).
      if (i.message_id && !insightByMessage.has(i.message_id)) {
        insightByMessage.set(i.message_id, i);
      }
    }
  }

  // 4) Compose.
  let items: EmailFeedItem[] = threadRows.map((t) => {
    const msg = t.provider_thread_id ? (latestByThread.get(t.provider_thread_id) ?? null) : null;
    const insight = msg ? (insightByMessage.get(msg.id) ?? null) : null;

    return {
      thread_id: t.id,
      provider_thread_id: t.provider_thread_id,
      subject: t.subject,
      participants: toStringArray(t.participants),
      last_message_at: t.last_message_at,
      latest_message_id: msg?.id ?? null,
      from_email: msg?.from_email ?? null,
      from_name: msg?.from_name ?? null,
      snippet: msg?.snippet ?? null,
      direction: msg?.direction ?? null,
      insight_id: insight?.id ?? null,
      summary: insight?.summary ?? null,
      intent: insight?.intent ?? null,
      urgency: insight?.urgency ?? null,
      sentiment: insight?.sentiment ?? null,
      action_required: insight?.action_required ?? null,
      suggested_owner: insight?.suggested_owner ?? null,
      confidence: insight?.confidence ?? null,
      processing_status: insight ? "analysed" : "received",
    };
  });

  if (input.direction && input.direction !== "ALL") {
    items = items.filter((i) => i.direction === input.direction);
  }
  if (input.actionRequiredOnly) {
    items = items.filter((i) => i.action_required === true);
  }

  return { ok: true, data: items };
}

interface DetailMessageRow {
  id: string;
  provider_message_id: string | null;
  from_email: string | null;
  from_name: string | null;
  to_emails: unknown;
  cc_emails: unknown;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string | null;
  received_at: string | null;
  direction: string | null;
}

function toInsight(r: InsightRow): EmailInsight {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    message_id: r.message_id,
    thread_id: r.thread_id,
    intent: r.intent,
    urgency: r.urgency,
    sentiment: r.sentiment,
    summary: r.summary,
    action_required: r.action_required,
    suggested_owner: r.suggested_owner,
    confidence: r.confidence,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/**
 * Lazily load one thread's full detail — its ordered messages (with bodies) and
 * each message's best-effort AI insight. RLS-scoped (browser client); keyed by
 * the thread uuid (`email_threads.id`) from a feed item.
 */
export async function getEmailThreadDetail(
  threadId: string,
): Promise<ApiResult<EmailThreadDetail>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  if (typeof threadId !== "string" || threadId.trim() === "") {
    return { ok: false, error: { code: "invalid_thread_id", message: "threadId is required" } };
  }
  const supabase = getSupabaseClient();

  // 1) Thread meta (RLS-scoped).
  const { data: thread, error: threadErr } = await supabase
    .from("email_threads")
    .select("id, provider_thread_id, subject, participants, last_message_at")
    .eq("id", threadId)
    .maybeSingle();
  if (threadErr) return { ok: false, error: { code: "query_error", message: threadErr.message } };
  if (!thread) return { ok: false, error: { code: "not_found", message: "Thread not found" } };
  const t = thread as ThreadRow;

  // 2) Messages in the thread, oldest → newest (RLS-scoped).
  const messageRows: DetailMessageRow[] = [];
  if (t.provider_thread_id) {
    const { data: msgs, error: msgErr } = await supabase
      .from("email_messages")
      .select(
        "id, provider_message_id, from_email, from_name, to_emails, cc_emails, subject, snippet, body_text, body_html, sent_at, received_at, direction",
      )
      .eq("provider_thread_id", t.provider_thread_id)
      .order("received_at", { ascending: true, nullsFirst: true });
    if (msgErr) return { ok: false, error: { code: "query_error", message: msgErr.message } };
    messageRows.push(...((msgs ?? []) as DetailMessageRow[]));
  }

  // 3) Insights for those messages (RLS-scoped), keyed by message_id.
  const messageIds = messageRows.map((m) => m.id);
  const insightByMessage = new Map<string, InsightRow>();
  if (messageIds.length > 0) {
    const { data: ins, error: insErr } = await supabase
      .from("email_ai_insights")
      .select(
        "id, tenant_id, message_id, thread_id, intent, urgency, sentiment, summary, action_required, suggested_owner, confidence, created_at, updated_at",
      )
      .in("message_id", messageIds)
      .order("created_at", { ascending: false, nullsFirst: false });
    if (insErr) return { ok: false, error: { code: "query_error", message: insErr.message } };
    for (const i of (ins ?? []) as InsightRow[]) {
      if (i.message_id && !insightByMessage.has(i.message_id)) {
        insightByMessage.set(i.message_id, i);
      }
    }
  }

  const messages: EmailThreadMessage[] = messageRows.map((m) => {
    const insight = insightByMessage.get(m.id) ?? null;
    return {
      message_id: m.id,
      provider_message_id: m.provider_message_id,
      from_email: m.from_email,
      from_name: m.from_name,
      to_emails: toStringArray(m.to_emails),
      cc_emails: toStringArray(m.cc_emails),
      subject: m.subject,
      snippet: m.snippet,
      body_text: m.body_text,
      body_html: m.body_html,
      sent_at: m.sent_at,
      received_at: m.received_at,
      direction: m.direction,
      insight: insight ? toInsight(insight) : null,
    };
  });

  return {
    ok: true,
    data: {
      thread_id: t.id,
      provider_thread_id: t.provider_thread_id,
      subject: t.subject,
      participants: toStringArray(t.participants),
      last_message_at: t.last_message_at,
      messages,
    },
  };
}
