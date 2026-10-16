// ServiceOS — Edge Function: email-workspace-scheduled-sync (Workspace DWD, queue-driven)
//
// ENQUEUES one `email.workspace_sync` job per enabled DWD mailbox plus a
// throttled `email.mailbox_discovery` job per tenant, then returns fast. The
// platform-worker runs them asynchronously, so a slow/failing mailbox never
// blocks the scheduler or the tenant. Runs every 5 minutes. Multi-tenant.
//
// Auth: `x-schedule-secret` must match EMAIL_WORKSPACE_SCHEDULE_SECRET, else 403.
// Deploy with verify_jwt=false (cron has no JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/platform_queue.ts";
import {
  emptySchedulerCounts,
  recordSchedulerHeartbeat,
  scheduleAndCount,
} from "../_shared/email_scheduler_health.ts";
import type { SchedulerCounts } from "../_shared/email_scheduler_health.ts";
import {
  isWorkspaceMailboxEligible,
  isWorkspaceRecentCaptureHeld,
} from "../_shared/workspace_scheduler_selection.ts";
import type {
  WorkspaceScheduleCheckpoint,
  WorkspaceScheduleMailbox,
} from "../_shared/workspace_scheduler_selection.ts";
import { shouldRecheckHeldMailbox } from "../_shared/workspace_held_probe.ts";

const PROVIDER = "gmail";
const DWD_STATUSES = ["pending_tokenless_dwd", "active_dwd"];
const MAX_RESULTS = 25;
// Re-discover at most this often (avoids a Directory list every single tick).
const DISCOVERY_MIN_INTERVAL_MS = 15 * 60 * 1000;

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
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const expected = Deno.env.get("EMAIL_WORKSPACE_SCHEDULE_SECRET");
  if (!expected) {
    return fail("config_error", "EMAIL_WORKSPACE_SCHEDULE_SECRET is not configured", 500);
  }
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) return fail("forbidden", "Invalid or missing secret", 403);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!supabase) return fail("config_error", "Supabase admin client is not configured", 500);

  // Establish both inventories before scheduling; failed reads are not empty lists.
  const { data: conns, error: connectionError } = await supabase
    .from("google_workspace_connections")
    .select("tenant_id")
    .neq("status", "disabled");
  if (connectionError) return fail("db_error", "Could not list Workspace connections", 500);
  const tenantIds = Array.from(
    new Set(((conns ?? []) as { tenant_id: string }[]).map((c) => c.tenant_id)),
  );
  // PostgREST limits a single page. A partial authority inventory must never
  // silently turn later accounts into absent or eligible sources.
  const accounts: { id: string; tenant_id: string; email_address: string }[] = [];
  const mailboxes: WorkspaceScheduleMailbox[] = [];
  const checkpoints: WorkspaceScheduleCheckpoint[] = [];
  let inventoryError = false;
  for (let offset = 0; offset < 100000; offset += 500) {
    const { data, error } = await supabase
      .from("email_accounts")
      .select("id,tenant_id,email_address")
      .eq("provider", PROVIDER)
      .in("status", DWD_STATUSES)
      .order("id")
      .range(offset, offset + 499);
    if (error || !data) {
      inventoryError = true;
      break;
    }
    accounts.push(...data);
    if (data.length < 500) break;
    if (offset === 99500) inventoryError = true;
  }
  if (!inventoryError) {
    for (let offset = 0; offset < 100000; offset += 500) {
      const { data, error } = await supabase
        .from("google_workspace_mailboxes")
        .select(
          "tenant_id,email_address,status,sync_enabled,mailbox_type,directory_identity_conflict",
        )
        .order("id")
        .range(offset, offset + 499);
      if (error || !data) {
        inventoryError = true;
        break;
      }
      mailboxes.push(...data);
      if (data.length < 500) break;
      if (offset === 99500) inventoryError = true;
    }
  }
  if (!inventoryError) {
    for (let offset = 0; offset < 100000; offset += 500) {
      const { data, error } = await supabase
        .from("email_ingestion_checkpoints")
        .select("tenant_id,email_account_id,generation,revision,state,block_code")
        .eq("stream", "recent")
        .eq("state", "blocked")
        .order("tenant_id")
        .order("email_account_id")
        .range(offset, offset + 499);
      if (error || !data) {
        inventoryError = true;
        break;
      }
      checkpoints.push(...data);
      if (data.length < 500) break;
      if (offset === 99500) inventoryError = true;
    }
  }
  const perTenant = new Map<string, SchedulerCounts>();
  const mailboxQueued = new Map<string, number>();
  const ineligibleByTenant = new Map<string, number>();
  const heldByTenant = new Map<string, number>();
  const heldRecheckCandidates: { tenantId: string; accountId: string;
    checkpoint: WorkspaceScheduleCheckpoint }[] = [];
  const discoveryCounts = new Map<string, number>();
  for (const tid of tenantIds) perTenant.set(tid, emptySchedulerCounts());
  for (const acc of inventoryError ? [] : accounts) {
    if (!perTenant.has(acc.tenant_id)) perTenant.set(acc.tenant_id, emptySchedulerCounts());
  }
  let discoveryQueued = 0,
    queued = 0,
    duplicates = 0;
  if (!inventoryError) {
    for (const tid of tenantIds) {
      const counts = perTenant.get(tid)!;
      const { data: lastDisc, error: discoveryError } = await supabase
        .from("email_sync_runs")
        .select("completed_at")
        .eq("tenant_id", tid)
        .eq("sync_type", "workspace_discover")
        .eq("status", "success")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastMs = lastDisc?.completed_at ? Date.parse(lastDisc.completed_at as string) : null;
      if (discoveryError || (lastMs !== null && !Number.isFinite(lastMs))) {
        counts.unconfirmed++;
        continue;
      }
      if (lastMs !== null && Date.now() - lastMs < DISCOVERY_MIN_INTERVAL_MS) continue;
      const before = counts.queued;
      await scheduleAndCount(
        supabase,
        {
          tenantId: tid,
          jobType: "email.mailbox_discovery",
          jobKey: `email.mailbox_discovery:${tid}`,
          connectorId: "google-workspace",
          moduleId: "communications.email",
        },
        counts,
        enqueueJob,
      );
      discoveryQueued += counts.queued - before;
      discoveryCounts.set(tid, counts.queued - before);
    }
    for (const acc of accounts) {
      const tid = acc.tenant_id as string,
        counts = perTenant.get(tid)!;
      if (!isWorkspaceMailboxEligible(acc, mailboxes)) {
        ineligibleByTenant.set(tid, (ineligibleByTenant.get(tid) ?? 0) + 1);
        continue;
      }
      const held = checkpoints.find((checkpoint) =>
        checkpoint.tenant_id === tid && checkpoint.email_account_id === acc.id);
      let profileProof = null;
      if (held?.block_code === "admin_delegation_missing") {
        const { data, error } = await supabase.from("audit_logs")
          .select("status,created_at,detail")
          .eq("tenant_id", tid)
          .eq("resource_type", "email_account")
          .eq("resource_id", acc.id)
          .eq("action", "learn.email.mailbox_source_probe_result")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1).maybeSingle();
        if (error) counts.unconfirmed++;
        else profileProof = data;
      }
      if (isWorkspaceRecentCaptureHeld(acc, checkpoints, profileProof)) {
        heldByTenant.set(tid, (heldByTenant.get(tid) ?? 0) + 1);
        if (held?.block_code === "admin_delegation_missing")
          heldRecheckCandidates.push({ tenantId: tid, accountId: acc.id, checkpoint: held });
        continue;
      }
      const before = { ...counts };
      await scheduleAndCount(
        supabase,
        {
          tenantId: tid,
          jobType: "email.workspace_sync",
          jobKey: `email.workspace_sync:${acc.id}`,
          connectorId: "google-workspace",
          moduleId: "communications.email",
          payload: { email_account_id: acc.id, max_results: MAX_RESULTS },
        },
        counts,
        enqueueJob,
      );
      queued += counts.queued - before.queued;
      duplicates += counts.duplicates - before.duplicates;
      mailboxQueued.set(tid, (mailboxQueued.get(tid) ?? 0) + counts.queued - before.queued);
    }
  }
  let heartbeatConfirmed = true;
  for (const [tid, counts] of perTenant) {
    if (
      !(await recordSchedulerHeartbeat(
        supabase,
        tid,
        "workspace_scheduled_sync",
        counts,
        {
          mailboxes_enqueued: mailboxQueued.get(tid) ?? 0,
          discovery_enqueued: discoveryCounts.get(tid) ?? 0,
        },
        inventoryError,
        ineligibleByTenant.get(tid) ?? 0,
        heldByTenant.get(tid) ?? 0,
      ))
    ) {
      heartbeatConfirmed = false;
    }
  }
  if (!heartbeatConfirmed)
    return fail(
      "heartbeat_unconfirmed",
      "Scheduler results could not be recorded. Check queued jobs before retrying.",
      503,
    );
  if (inventoryError) return fail("db_error", "Could not list DWD mailbox authority", 500);
  const counts = [...perTenant.values()];
  if (counts.some((c) => c.unconfirmed))
    return fail(
      "enqueue_unconfirmed",
      "Some scheduling results are uncertain. Check queued jobs before retrying.",
      503,
    );
  // An intermittent Google token denial can block a mailbox even when its
  // current delegated profile access works. Recheck at most one exact active
  // hold per tick, with two attempts in two hours and the probe's independent
  // 15-minute cooldown. The existing internal endpoint audits its own read,
  // returns no mailbox content and never clears a checkpoint by itself.
  const background = (globalThis as { EdgeRuntime?: {
    waitUntil?: (task: Promise<unknown>) => void;
  } }).EdgeRuntime;
  if (heldRecheckCandidates.length && background?.waitUntil) {
    const recheck = (async () => {
      for (const candidate of heldRecheckCandidates) {
        const now = Date.now();
        const { data: requests, error } = await supabase.from("audit_logs")
          .select("created_at")
          .eq("tenant_id", candidate.tenantId)
          .eq("resource_type", "email_account")
          .eq("resource_id", candidate.accountId)
          .eq("action", "learn.email.mailbox_source_probe")
          .gte("created_at", new Date(now - 2 * 60 * 60 * 1000).toISOString())
          .order("created_at", { ascending: false }).limit(2);
        if (error || !requests || !shouldRecheckHeldMailbox(candidate.checkpoint,
          requests.map((request) => request.created_at), now)) continue;
        const response = await fetch(`${supabaseUrl}/functions/v1/learn-email-mailbox-source-probe`, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
          headers: { Authorization: `Bearer ${serviceKey}`,
            "x-serviceos-internal-key": serviceKey,
            "x-internal-tenant-id": candidate.tenantId,
            "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: candidate.accountId }),
        });
        await response.body?.cancel();
        break;
      }
    })().catch(() => { /* No checkpoint or capture job changes on uncertainty. */ });
    background.waitUntil(recheck);
  }
  return json({
    success: true,
    mailboxes: accounts.length,
    queued,
    duplicates,
    discovery_queued: discoveryQueued,
    capture_paused: counts.reduce((n, c) => n + c.paused, 0),
    known_ineligible: [...ineligibleByTenant.values()].reduce((n, c) => n + c, 0),
    held_recovery: [...heldByTenant.values()].reduce((n, c) => n + c, 0),
  });
});
