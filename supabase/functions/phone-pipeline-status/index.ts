// ServiceOS — Edge Function: phone-pipeline-status (Phase 5A → 5B)
//
// THE single source of truth for phone-pipeline health. Both surfaces read this
// one endpoint — the Operations Centre renders the business-health SUMMARY, the
// Admin › Phone Operations page renders the full DIAGNOSTICS — so there is no
// duplicated health logic. Uses the service-role key so it can read the
// RLS-protected phone_* tables and reason across them (which a single browser
// query can't). Read-only. Runtime: Deno.
//
// Request body: { tenant_id: uuid }
// Returns (all real — no fabricated data):
//   success, health ("healthy"|"warning"|"critical"), health_reason,
//   recordings_total, not_downloaded, downloaded, need_transcription,
//   need_analysis, need_work,                         ← stage backlog
//   pending, processing, failed, completed,           ← high-level (back-compat)
//   oldest_pending_at, oldest_pending_age_seconds, oldest_pending_beyond_scan,
//   last_success_at, last_failure_at, last_failure_message,
//   throughput_per_min, estimated_drain_seconds
//
// Definitions:
//   need_transcription = downloaded − transcripts_completed (clamped ≥ 0)
//   need_analysis      = transcripts_completed − insights_total (clamped ≥ 0)
//   need_work          = not_downloaded + need_transcription + need_analysis
//   completed          = recordings with an AI insight (fully enriched)
//   throughput_per_min = pipeline runs completed in the last THROUGHPUT_WINDOW
//   estimated drain    = need_work ÷ throughput_per_min (null if throughput 0)

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";

// How far back (minutes) we measure completed pipeline runs for throughput.
const THROUGHPUT_WINDOW_MIN = 15;
// Oldest-pending scan bound — reason over the most recent N recordings. Backlog
// older than this is flagged via `oldest_pending_beyond_scan` (never hidden).
const OLDEST_SCAN = 500;
// Health thresholds (seconds / counts) — documented, not magic.
const CRITICAL_AGE_SEC = 3600; // >1h oldest pending ⇒ the drainer isn't keeping up
const WARNING_AGE_SEC = 900; // >15m oldest pending ⇒ building
const WARNING_BACKLOG = 10; // >10 items needing work ⇒ building

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const body = (parsed ?? {}) as Record<string, unknown>;

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  // --- authz: bind tenant server-side (diagnostics ⇒ owner/admin/ops) ------
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  const nowMs = Date.now();
  const head = { count: "exact" as const, head: true as const };

  // --- stage backlog (full-table counts, cheap + accurate) -----------------
  const recordingsTotal =
    (await supabase.from("phone_recordings").select("*", head).eq("tenant_id", tenantId)).count ??
    0;
  const notDownloaded =
    (
      await supabase
        .from("phone_recordings")
        .select("*", head)
        .eq("tenant_id", tenantId)
        .is("storage_path", null)
    ).count ?? 0;
  const transcriptsCompleted =
    (
      await supabase
        .from("phone_transcripts")
        .select("*", head)
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
    ).count ?? 0;
  const insightsTotal =
    (await supabase.from("phone_ai_insights").select("*", head).eq("tenant_id", tenantId)).count ??
    0;
  const downloaded = Math.max(0, recordingsTotal - notDownloaded);
  const needTranscription = Math.max(0, downloaded - transcriptsCompleted);
  const needAnalysis = Math.max(0, transcriptsCompleted - insightsTotal);
  const needWork = notDownloaded + needTranscription + needAnalysis;

  // High-level, kept for back-compat with the existing tiles.
  const completed = insightsTotal;
  const processing =
    (
      await supabase
        .from("phone_sync_runs")
        .select("*", head)
        .eq("tenant_id", tenantId)
        .eq("sync_type", "pipeline")
        .eq("status", "running")
    ).count ?? 0;
  const failed =
    (
      await supabase
        .from("phone_sync_runs")
        .select("*", head)
        .eq("tenant_id", tenantId)
        .eq("sync_type", "pipeline")
        .eq("status", "failed")
    ).count ?? 0;
  const pending = Math.max(0, recordingsTotal - completed - processing);

  // --- oldest pending (cross-table scan of the most recent OLDEST_SCAN) -----
  let oldestPendingAt: string | null = null;
  let oldestPendingBeyondScan = false;
  {
    const { data: recs } = await supabase
      .from("phone_recordings")
      .select("id, storage_path, started_at, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(OLDEST_SCAN);
    const rows = (recs ?? []) as {
      id: string;
      storage_path: string | null;
      started_at: string | null;
      created_at: string;
    }[];
    const ids = rows.map((r) => r.id);
    const completedTranscript = new Set<string>();
    const analysed = new Set<string>();
    if (ids.length > 0) {
      const { data: trs } = await supabase
        .from("phone_transcripts")
        .select("recording_id")
        .eq("tenant_id", tenantId)
        .eq("status", "completed")
        .in("recording_id", ids);
      for (const t of (trs ?? []) as Record<string, unknown>[]) {
        const rid = t.recording_id as string | null;
        if (rid) completedTranscript.add(rid);
      }
      const { data: inss } = await supabase
        .from("phone_ai_insights")
        .select("recording_id")
        .eq("tenant_id", tenantId)
        .in("recording_id", ids);
      for (const i of (inss ?? []) as Record<string, unknown>[]) {
        const rid = i.recording_id as string | null;
        if (rid) analysed.add(rid);
      }
    }
    for (const r of rows) {
      const incomplete =
        r.storage_path === null || !completedTranscript.has(r.id) || !analysed.has(r.id);
      if (!incomplete) continue;
      const at = r.started_at ?? r.created_at;
      if (!oldestPendingAt || Date.parse(at) < Date.parse(oldestPendingAt)) oldestPendingAt = at;
    }
    // Backlog exists but none of the scanned (most-recent) recordings are pending
    // ⇒ the oldest pending item is older than the scan window. Never hide it.
    oldestPendingBeyondScan =
      needWork > 0 && oldestPendingAt === null && recordingsTotal > OLDEST_SCAN;
  }
  const oldestPendingAgeSeconds = oldestPendingAt
    ? Math.max(0, Math.floor((nowMs - Date.parse(oldestPendingAt)) / 1000))
    : null;

  // --- last success / last failure (pipeline runs) -------------------------
  const { data: lastOk } = await supabase
    .from("phone_sync_runs")
    .select("completed_at")
    .eq("tenant_id", tenantId)
    .eq("sync_type", "pipeline")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSuccessAt = (lastOk?.completed_at as string | null) ?? null;

  const { data: lastFail } = await supabase
    .from("phone_sync_runs")
    .select("started_at, error_message")
    .eq("tenant_id", tenantId)
    .eq("sync_type", "pipeline")
    .eq("status", "failed")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastFailureAt = (lastFail?.started_at as string | null) ?? null;
  const lastFailureMessage = (lastFail?.error_message as string | null) ?? null;
  // A failure is only CURRENT if it happened after the last successful run (or
  // there has never been one). A newer success resolves it → it becomes history,
  // not a current warning. This is what stops a stale 'invalid_auth' from a past
  // era being shown as the live problem once processing recovers.
  const lastFailureIsCurrent =
    lastFailureAt !== null &&
    (lastSuccessAt === null || Date.parse(lastFailureAt) > Date.parse(lastSuccessAt));

  // --- throughput + estimated drain ---------------------------------------
  const windowStartIso = new Date(nowMs - THROUGHPUT_WINDOW_MIN * 60_000).toISOString();
  const completedInWindow =
    (
      await supabase
        .from("phone_sync_runs")
        .select("*", head)
        .eq("tenant_id", tenantId)
        .eq("sync_type", "pipeline")
        .eq("status", "success")
        .gte("completed_at", windowStartIso)
    ).count ?? 0;
  const throughputPerMin = completedInWindow / THROUGHPUT_WINDOW_MIN;
  const estimatedDrainSeconds =
    needWork > 0 && throughputPerMin > 0 ? Math.round((needWork / throughputPerMin) * 60) : null;

  // --- derived health ------------------------------------------------------
  let health: "healthy" | "warning" | "critical" = "healthy";
  let healthReason = "Pipeline healthy";
  if (needWork > 0 && lastSuccessAt === null) {
    health = "critical";
    healthReason = "Backlog exists but no successful processing run has completed";
  } else if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > CRITICAL_AGE_SEC) {
    health = "critical";
    healthReason = "Oldest waiting call is over an hour old — the drainer isn't keeping up";
  } else if (oldestPendingBeyondScan) {
    health = "critical";
    healthReason = "Backlog older than the scan window — processing has stalled";
  } else if (lastFailureIsCurrent && needWork > 0) {
    // Only when the latest failure is newer than the latest success — a resolved
    // (older) failure never drives health.
    health = "warning";
    healthReason = "The latest pipeline run failed and work is still pending";
  } else if (needWork > WARNING_BACKLOG) {
    health = "warning";
    healthReason = `${needWork} recordings waiting to be processed`;
  } else if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > WARNING_AGE_SEC) {
    health = "warning";
    healthReason = "Calls have been waiting more than 15 minutes";
  } else if (needWork > 0) {
    healthReason = `${needWork} recording(s) processing normally`;
  }

  return jsonResponse({
    success: true,
    health,
    health_reason: healthReason,
    // stage backlog
    recordings_total: recordingsTotal,
    not_downloaded: notDownloaded,
    downloaded,
    need_transcription: needTranscription,
    need_analysis: needAnalysis,
    need_work: needWork,
    // high-level (back-compat)
    pending,
    processing,
    failed,
    completed,
    // freshness + flow
    oldest_pending_at: oldestPendingAt,
    oldest_pending_age_seconds: oldestPendingAgeSeconds,
    oldest_pending_beyond_scan: oldestPendingBeyondScan,
    last_success_at: lastSuccessAt,
    last_failure_at: lastFailureAt,
    last_failure_message: lastFailureMessage,
    last_failure_is_current: lastFailureIsCurrent,
    throughput_per_min: Math.round(throughputPerMin * 100) / 100,
    estimated_drain_seconds: estimatedDrainSeconds,
  });
});
