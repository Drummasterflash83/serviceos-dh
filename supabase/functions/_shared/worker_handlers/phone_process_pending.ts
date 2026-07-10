// ServiceOS — Worker handler: phone.process_pending (backlog drainer orchestration).
// Pure orchestration — moved verbatim from phone-process-pending/index.ts. Auth,
// CORS and the platform_jobs lifecycle live in the caller. Tenant is always
// caller-validated.
//
// REMAINING CHILD HTTP (documented, §5/§8): this handler still invokes
// phone-process-pipeline over HTTP per recording, which chains to
// simwood-download-recording / phone-transcribe-recording / phone-analyse-transcript.
// Those are separate provider (Simwood) / OpenAI / object-storage functions; the
// worker→phone-process-pending hop is removed (this handler runs in-process), but
// extracting the download/transcribe/analyse providers is deliberately out of
// scope here to avoid regression risk.

import { invokeFunction } from "../phone_pipeline.ts";
import { isRetryable, heartbeatLease } from "../platform_queue.ts";
import { incrementPlatformJobProgress } from "../platform_jobs.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;
const SCAN_LIMIT = 40;
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
    // Scan recent recordings, then pick those missing any pipeline stage.
    const { data: recs, error: recErr } = await supabase
      .from("phone_recordings")
      .select("id, storage_path")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(SCAN_LIMIT);
    if (recErr) throw new Error(`recordings read failed: ${recErr.message}`);
    const recordings = (recs ?? []) as { id: string; storage_path: string | null }[];

    const ids = recordings.map((r) => r.id);
    const completedTranscript = new Set<string>();
    const analysed = new Set<string>();
    if (ids.length > 0) {
      // Completed transcripts → their recording_ids.
      const { data: trs } = await supabase
        .from("phone_transcripts")
        .select("recording_id, status")
        .eq("tenant_id", tenantId)
        .in("recording_id", ids)
        .eq("status", "completed");
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

    const pendingAll = recordings.filter(
      (r) => r.storage_path === null || !completedTranscript.has(r.id) || !analysed.has(r.id),
    );
    const pending = pendingAll.slice(0, batch);
    // Recordings in the recent scan window that are ALREADY fully complete and so
    // are deliberately NOT reprocessed (evidence of "never reprocesses complete
    // items"). Scan-window scoped — older complete recordings aren't counted.
    const skipped = recordings.length - pendingAll.length;

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

    const result = {
      processed: pending.length,
      downloaded,
      transcribed,
      analysed: analysedCount,
      interaction_ready: interactionReady,
      failed,
      skipped,
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
