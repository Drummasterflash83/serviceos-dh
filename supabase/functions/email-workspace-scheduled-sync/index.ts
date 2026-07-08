// ServiceOS — Edge Function: email-workspace-scheduled-sync (Workspace DWD)
//
// Keeps enabled Workspace/DWD mailboxes current on a cron (every 5 minutes). It
// owns NO Gmail logic — it finds the tenant's DWD email_accounts and invokes the
// existing gmail-workspace-sync-messages once per mailbox (service-role internal
// path, see _shared/authz.ts). One failing mailbox never aborts the run.
//
// Auth: NOT a user session. A shared secret header `x-schedule-secret` must match
// EMAIL_WORKSPACE_SCHEDULE_SECRET, else 403. Tokens/keys are handled inside the
// sync function and are NEVER exposed or logged here.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false (cron
// has no JWT; the schedule secret is the gate) — see supabase/config.toml.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { syncGmailMailbox } from "../_shared/email_pipeline.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";

const PROVIDER = "gmail";
const SYNC_FUNCTION = "gmail-workspace-sync-messages";
const DWD_STATUSES = ["pending_tokenless_dwd", "active_dwd"];

// TODO(integration): move tenant to per-tenant integration config once provider
// connections are stored per tenant.
const SCHEDULED_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const MAX_RESULTS = 25;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedule-secret",
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
  const expected = Deno.env.get("EMAIL_WORKSPACE_SCHEDULE_SECRET");
  if (!expected) {
    return fail("config_error", "EMAIL_WORKSPACE_SCHEDULE_SECRET is not configured", 500);
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
  const baseMetadata: Record<string, unknown> = { provider: PROVIDER, max_results: MAX_RESULTS };

  const { data: runRow, error: runErr } = await supabase
    .from("email_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "workspace_scheduled_sync",
      status: "running",
      started_at: startedAt,
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) return fail("db_error", "Could not open a scheduled sync run", 500);
  const syncRunId = runRow.id as string;

  // Durable platform job (supplements email_sync_runs; scheduled-run granularity).
  // Best-effort: a duplicate active job this minute → don't double-track. No secrets.
  // TODO(jobs): per-mailbox jobs inside gmail-workspace-sync-messages.
  const created = await createPlatformJob(supabase, {
    tenantId,
    connectorId: "google-workspace",
    moduleId: "communications.email",
    jobType: "email.workspace_sync",
    jobKey: `email.workspace_sync:${tenantId}:${startedAt.slice(0, 16)}`,
    payload: { max_results: MAX_RESULTS },
  });
  const jobId = created.duplicate ? null : created.id;
  if (jobId) await startPlatformJob(supabase, jobId);

  // --- find enabled DWD mailboxes for the tenant (service role) -------------
  // Only pending_tokenless_dwd / active_dwd — this deliberately SKIPS OAuth
  // 'active' accounts (they sync via email-scheduled-sync) and 'disabled' ones.
  const { data: accounts, error: accErr } = await supabase
    .from("email_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("provider", PROVIDER)
    .in("status", DWD_STATUSES);
  if (accErr) {
    await supabase
      .from("email_sync_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: "Could not list DWD email accounts",
        metadata: { ...baseMetadata, error_code: "db_error" },
      })
      .eq("id", syncRunId);
    if (jobId) await failPlatformJob(supabase, jobId, "db_error: could not list DWD accounts");
    return json({ success: false, sync_run_id: syncRunId, error: { code: "db_error" } }, 500);
  }
  const accountList = accounts ?? [];

  // --- sync each mailbox; one failure never aborts the run -----------------
  let messagesProcessed = 0;
  let failedAccounts = 0;
  const perAccount: Array<Record<string, unknown>> = [];

  for (const acc of accountList) {
    const res = await syncGmailMailbox({
      tenantId,
      emailAccountId: acc.id as string,
      maxResults: MAX_RESULTS,
      serviceKey,
      functionName: SYNC_FUNCTION,
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
        accounts_processed: accountList.length,
        messages_processed: messagesProcessed,
        failed_accounts: failedAccounts,
        accounts: perAccount,
      },
    })
    .eq("id", syncRunId);

  if (jobId) {
    if (overallOk) {
      await completePlatformJob(supabase, jobId, {
        recordsProcessed: messagesProcessed,
        result: { accounts_processed: accountList.length, messages_processed: messagesProcessed },
      });
    } else {
      await failPlatformJob(supabase, jobId, `${failedAccounts} mailbox(es) failed`, {
        accounts_processed: accountList.length,
        messages_processed: messagesProcessed,
      });
    }
  }

  return json({
    success: overallOk,
    accounts_processed: accountList.length,
    messages_processed: messagesProcessed,
    failed_accounts: failedAccounts,
    sync_run_id: syncRunId,
  });
});
