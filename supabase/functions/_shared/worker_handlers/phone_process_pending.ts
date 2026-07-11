// ServiceOS — Worker handler: phone.process_pending (backlog drainer orchestration).
// Pure orchestration — auth, CORS and the platform_jobs lifecycle live in the
// caller. Tenant is always caller-validated.
//
// SELECTION (Reliability v2): work is chosen DATABASE-SIDE via
// phone_select_pending() — the OLDEST incomplete recordings first, bounded batch,
// with a readiness delay applied only to the download stage. This replaces the
// former "scan the newest 40, filter in memory" logic, which starved old
// recordings and produced the misleading `skipped: 40` no-op. See migration
// 20260711120000_phone_pipeline_selection.sql.
//
// REMAINING CHILD HTTP (documented, §5/§8): this handler still invokes
// phone-process-pipeline over HTTP per recording, which chains to
// simwood-download-recording / phone-transcribe-recording / phone-analyse-transcript.
// Those are separate provider (Simwood) / OpenAI / object-storage functions;
// extracting them is deliberately out of scope here to avoid regression risk.

import { invokeFunction } from "../phone_pipeline.ts";
import { isRetryable, heartbeatLease } from "../platform_queue.ts";
import { incrementPlatformJobProgress } from "../platform_jobs.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;
// Brand-new recordings may not have downloadable audio on the provider yet. The
// download stage waits this long before first attempt; transcribe/analyse of
// already-downloaded rows are never delayed (readiness gate lives in the RPC).
const MIN_DOWNLOAD_AGE_SECONDS = 120;
const LEASE_SECONDS = 300;

function clampBatch(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : DEFAULT_BATCH;
  return Math.max(1, Math.min(MAX_BATCH, n));
}

export async function handlePhoneProcessPending(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: supabase, tenantId, jobId, payload } = ctx;
  const batch = clampBatch(payload.limit ?? payload.batch);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) {
    return {
      success: false,
      error: {
        code: "config_error",
        message: "Service role key is not configured",
        retryable: false,
        failedStep: "config",
      },
    };
  }

  try {
    // Database-side selection: OLDEST incomplete recordings first (no starvation),
    // bounded batch, download-readiness delay applied server-side.
    const { data: selected, error: selErr } = await supabase.rpc("phone_select_pending", {
      p_tenant_id: tenantId,
      p_limit: batch,
      p_min_download_age_seconds: MIN_DOWNLOAD_AGE_SECONDS,
    });
    if (selErr) throw new Error(`select pending failed: ${selErr.message}`);
    const pending = (selected ?? []) as { id: string; stage: string }[];

    // Total still-incomplete recordings (full table, not a scan window) so the
    // result reports honest remaining work — and proves a no-op is "nothing to
    // do", never "skipped 40 complete rows".
    const { count: backlogCount } = await supabase
      .from("phone_recording_pipeline_state")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_incomplete", true);
    const eligibleBacklog = backlogCount ?? pending.length;

    // Truthful no-op: the query found nothing to do (NOT 40 complete rows skipped).
    if (pending.length === 0) {
      return {
        success: true,
        recordsProcessed: 0,
        result: {
          processed: 0,
          downloaded: 0,
          transcribed: 0,
          analysed: 0,
          interaction_ready: 0,
          failed: 0,
          skipped: 0,
          eligible_backlog: eligibleBacklog,
          reason: "no_eligible_recordings",
          last_error: null,
          failed_step: null,
          failures: [],
        },
      };
    }

    let downloaded = 0;
    let transcribed = 0;
    let analysedCount = 0;
    let interactionReady = 0;
    let failed = 0;
    // Surface the most recent child error (e.g. missing OPENAI_API_KEY) + the step
    // it failed at, instead of hiding it behind an opaque `failed` count. Never a
    // secret and never transcript/audio — the step functions return only
    // codes/messages. Keep a small per-failure summary for the UI.
    let lastError: string | null = null;
    let lastFailedStep: string | null = null;
    let lastErrorCode: string | null = null;
    const failures: Array<{ recording_id: string; failed_step: string | null; error: string }> = [];

    // Serial + failure-isolated: one bad recording never aborts the batch.
    for (const r of pending) {
      const res = await invokeFunction(
        "phone-process-pipeline",
        { tenant_id: tenantId, recording_id: r.id, force: false },
        serviceKey,
      );
      const j = res.json;
      if (j?.success) {
        if (j.downloaded) downloaded += 1;
        if (j.transcribed) transcribed += 1;
        if (j.analysed) analysedCount += 1;
        if (j.interaction_ready) interactionReady += 1;
      } else {
        failed += 1;
        const err = (j?.error ?? null) as { code?: unknown; message?: unknown } | null;
        const code = typeof err?.code === "string" ? err.code : null;
        const message = typeof err?.message === "string" ? err.message : null;
        const step = typeof j?.failed_step === "string" ? j.failed_step : null;
        lastError = message ?? code ?? `pipeline failed (${res.status || "network"})`;
        lastFailedStep = step ?? lastFailedStep;
        lastErrorCode = code ?? lastErrorCode;
        if (failures.length < 10) {
          failures.push({ recording_id: r.id, failed_step: step, error: lastError });
        }
      }
      // Progress + lease heartbeat so a long batch doesn't lose its claim (§7).
      if (jobId) {
        await incrementPlatformJobProgress(supabase, jobId, 1);
        await heartbeatLease(supabase, jobId, LEASE_SECONDS);
      }
    }

    // Truthful backlog remaining AFTER this batch — re-read the count (a recording
    // that only advanced one stage is still incomplete, so an estimate would lie).
    const { count: remainingCount } = await supabase
      .from("phone_recording_pipeline_state")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_incomplete", true);
    const remaining = remainingCount ?? eligibleBacklog;

    const result = {
      processed: pending.length,
      downloaded,
      transcribed,
      analysed: analysedCount,
      interaction_ready: interactionReady,
      failed,
      skipped: 0,
      eligible_backlog: remaining,
      reason: failed > 0 ? "processed_with_failures" : "processed",
      last_error: lastError,
      failed_step: lastFailedStep,
      failures,
    };

    return {
      success: failed === 0,
      recordsProcessed: pending.length,
      result,
      ...(failed > 0
        ? {
            error: {
              code: lastErrorCode ?? "phone_process_failed",
              message: lastError ?? "one or more recordings failed",
              retryable: isRetryable(lastErrorCode),
              failedStep: lastFailedStep ?? undefined,
            },
          }
        : {}),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "process-pending failed";
    return {
      success: false,
      error: { code: "process_error", message: message.slice(0, 500), retryable: true },
    };
  }
}
