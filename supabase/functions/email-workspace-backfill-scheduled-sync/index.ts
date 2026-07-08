// ServiceOS — Edge Function: email-workspace-backfill-scheduled-sync
//
// Advances IN-PROGRESS Workspace DWD backfills a little at a time. It processes a
// SMALL number of mailboxes per run (one Gmail page each) to avoid timeouts and
// rate-limit blowups. It only continues backfills already started (status
// 'running') — it never auto-starts new ones (admin starts a mailbox's backfill).
// Fully separate from the 5-minute recent sync.
//
// Auth: NOT a user session. Header `x-schedule-secret` must match
// EMAIL_WORKSPACE_BACKFILL_SECRET, else 403. Owns no Gmail logic — invokes
// gmail-workspace-backfill-messages via the service-role internal path.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { syncGmailMailbox } from "../_shared/email_pipeline.ts";

const PROVIDER = "gmail";
const BACKFILL_FUNCTION = "gmail-workspace-backfill-messages";
const DWD_STATUSES = ["pending_tokenless_dwd", "active_dwd"];

// TODO(integration): move tenant to per-tenant integration config.
const SCHEDULED_TENANT_ID = "00000000-0000-0000-0000-000000000001";
// Keep small — one Gmail page per mailbox per run avoids timeouts/rate limits.
const MAX_MAILBOXES = 3;
const PAGE_SIZE = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-schedule-secret",
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

/** Constant-time-ish string compare (avoids trivial timing leaks on the secret). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  // --- shared-secret gate (NOT callable by ordinary users) -----------------
  const expected = Deno.env.get("EMAIL_WORKSPACE_BACKFILL_SECRET");
  if (!expected) {
    return fail("config_error", "EMAIL_WORKSPACE_BACKFILL_SECRET is not configured", 500);
  }
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!serviceKey || !supabase) {
    return fail("config_error", "Supabase admin client is not configured", 500);
  }

  const tenantId = SCHEDULED_TENANT_ID;
  const startedAt = new Date().toISOString();
  const baseMetadata: Record<string, unknown> = {
    provider: PROVIDER,
    max_mailboxes: MAX_MAILBOXES,
    page_size: PAGE_SIZE,
  };

  const { data: runRow, error: runErr } = await supabase
    .from("email_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "workspace_backfill_scheduled",
      status: "running",
      started_at: startedAt,
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) return fail("db_error", "Could not open a scheduled sync run", 500);
  const syncRunId = runRow.id as string;

  // Continue only IN-PROGRESS ('running') DWD backfills — oldest-touched first,
  // capped at MAX_MAILBOXES. Never auto-starts a new backfill.
  const { data: accounts, error: accErr } = await supabase
    .from("email_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .in("status", DWD_STATUSES)
    .eq("backfill_status", "running")
    .order("updated_at", { ascending: true })
    .limit(MAX_MAILBOXES);
  if (accErr) {
    await supabase
      .from("email_sync_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Could not list backfill accounts",
        metadata: { ...baseMetadata, error_code: "db_error" },
      })
      .eq("id", syncRunId);
    return json({ success: false, sync_run_id: syncRunId, error: { code: "db_error" } }, 500);
  }
  const accountList = accounts ?? [];

  let messagesProcessed = 0;
  let failedAccounts = 0;
  const perAccount: Array<Record<string, unknown>> = [];

  for (const acc of accountList) {
    const res = await syncGmailMailbox({
      tenantId,
      emailAccountId: acc.id as string,
      maxResults: PAGE_SIZE,
      serviceKey,
      functionName: BACKFILL_FUNCTION,
    });
    if (res.ok) messagesProcessed += res.recordsProcessed;
    else failedAccounts++;
    perAccount.push({
      email_account_id: acc.id,
      ok: res.ok,
      records: res.recordsProcessed,
      child_sync_run_id: res.syncRunId,
      ...(res.code ? { error: res.code } : {}),
    });
  }

  const overallOk = failedAccounts === 0;
  await supabase
    .from("email_sync_runs")
    .update({
      status: overallOk ? "success" : "failed",
      completed_at: new Date().toISOString(),
      records_processed: messagesProcessed,
      error_message: overallOk ? null : `${failedAccounts} mailbox(es) failed`,
      metadata: {
        ...baseMetadata,
        mailboxes_processed: accountList.length,
        messages_processed: messagesProcessed,
        failed_accounts: failedAccounts,
        accounts: perAccount,
      },
    })
    .eq("id", syncRunId);

  return json({
    success: overallOk,
    mailboxes_processed: accountList.length,
    messages_processed: messagesProcessed,
    failed_accounts: failedAccounts,
    sync_run_id: syncRunId,
  });
});
