import { captureAdmission } from "../learn_capture_control.ts";
// ServiceOS — Worker handler: phone.process_pending (backlog drainer orchestration).
// Pure orchestration — auth, CORS and the platform_jobs lifecycle live in the
// caller. Tenant is always caller-validated.
//
// SELECTION (Reliability v2): work is chosen DATABASE-SIDE via
// phone_select_pending() — bounded fresh/backfill lanes, per-recording retry
// cooldown and review holds, with readiness delay only for downloads. This replaces the
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
import { isRetryable } from "../platform_queue.ts";
import { heartbeatPhoneJob, phoneJobContext, phoneJobUnconfirmed } from "../phone-recovery-job.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_contract.ts";

const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;
// Brand-new recordings may not have downloadable audio on the provider yet. The
// download stage waits this long before first attempt; transcribe/analyse of
// already-downloaded rows are never delayed (readiness gate lives in the RPC).
const MIN_DOWNLOAD_AGE_SECONDS = 120;

function clampBatch(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : DEFAULT_BATCH;
  return Math.max(1, Math.min(MAX_BATCH, n));
}

export async function handlePhoneProcessPending(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: supabase, tenantId, jobId, payload } = ctx;
  const batch = clampBatch(payload.limit ?? payload.batch);
  const owner = phoneJobContext(ctx);
  if (!owner || !(await heartbeatPhoneJob(supabase, owner, 0))) return phoneJobUnconfirmed();

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
    // Database-side selection: fresh-flow capacity plus a historical lane;
    // cooldown/review-held recordings do not monopolise the batch.
    const { data: selected, error: selErr } = await supabase.rpc("phone_select_pending", {
      p_tenant_id: tenantId,
      p_limit: batch,
      p_min_download_age_seconds: MIN_DOWNLOAD_AGE_SECONDS,
    });
    if (
      selErr ||
      !Array.isArray(selected) ||
      selected.length > batch ||
      selected.some(
        (r) =>
          !r ||
          typeof r.id !== "string" ||
          !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(r.id) ||
          r.tenant_id !== tenantId ||
          !["download", "transcribe", "analyse"].includes(r.stage),
      ) ||
      new Set(selected.map((r) => r.id)).size !== selected.length
    )
      throw Error("selection_unconfirmed");
    const pending = (selected ?? []) as { id: string; stage: string }[];

    // Total still-incomplete recordings (full table, not a scan window) so the
    // result reports honest remaining work — and proves a no-op is "nothing to
    // do", never "skipped 40 complete rows".
    const { count: backlogCount, error: backlogError } = await supabase
      .from("phone_recording_pipeline_state")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_incomplete", true);
    if (backlogError || !Number.isSafeInteger(backlogCount) || backlogCount! < 0)
      throw Error("backlog_unconfirmed");
    const eligibleBacklog = backlogCount!;

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
          reason: eligibleBacklog > 0 ? "awaiting_retry_or_review" : "no_eligible_recordings",
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
    let captureWaiting = 0;
    // Surface the most recent child error (e.g. missing OPENAI_API_KEY) + the step
    // it failed at, instead of hiding it behind an opaque `failed` count. Never a
    // secret and never transcript/audio — the step functions return only
    // codes/messages. Keep a small per-failure summary for the UI.
    let lastError: string | null = null;
    let lastFailedStep: string | null = null;
    let lastErrorCode: string | null = null;
    const failures: Array<{ recording_id: string; failed_step: string | null; error: string }> = [];

    // Serial + failure-isolated: one bad recording never aborts the batch.
    let attempted = 0;
    for (const r of pending) {
      if (!(await heartbeatPhoneJob(supabase, owner, attempted))) return phoneJobUnconfirmed();
      if (r.stage === "download") {
        const admission = await captureAdmission(supabase, tenantId, "phone");
        if (!admission.allowed) {
          captureWaiting += 1;
          continue;
        }
      }

      const res = await invokeFunction(
        "phone-process-pipeline",
        { tenant_id: tenantId, recording_id: r.id, force: false },
        serviceKey,
      );
      const j = res.json;
      if (
        res.status >= 200 &&
        res.status < 300 &&
        j?.success === true &&
        j.recording_id === r.id &&
        j.downloaded === true &&
        j.transcribed === true &&
        j.analysed === true
      ) {
        if (j.downloaded) downloaded += 1;
        if (j.transcribed) transcribed += 1;
        if (j.analysed) analysedCount += 1;
        if (j.interaction_ready) interactionReady += 1;
      } else if (
        ["learn_capture_paused", "learn_capture_unavailable"].includes(
          (j?.error as { code?: string } | undefined)?.code ?? "",
        )
      ) {
        captureWaiting += 1;
        continue;
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
      attempted += 1;
      if (!(await heartbeatPhoneJob(supabase, owner, attempted))) return phoneJobUnconfirmed();
    }

    // Truthful backlog remaining AFTER this batch — re-read the count (a recording
    // that only advanced one stage is still incomplete, so an estimate would lie).
    const { count: remainingCount, error: remainingError } = await supabase
      .from("phone_recording_pipeline_state")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_incomplete", true);
    if (remainingError || !Number.isSafeInteger(remainingCount) || remainingCount! < 0)
      throw Error("backlog_unconfirmed");
    const remaining = remainingCount!;

    const result = {
      processed: pending.length - captureWaiting,
      capture_waiting: captureWaiting,
      downloaded,
      transcribed,
      analysed: analysedCount,
      interaction_ready: interactionReady,
      failed,
      skipped: 0,
      eligible_backlog: remaining,
      reason:
        failed > 0
          ? "processed_with_failures"
          : captureWaiting > 0
            ? "capture_waiting"
            : "processed",
      last_error: lastError,
      failed_step: lastFailedStep,
      failures,
    };

    return {
      success: failed === 0,
      recordsProcessed: pending.length - captureWaiting,
      result,
      ...(failed > 0
        ? {
            error: {
              code: lastErrorCode ?? "phone_process_failed",
              message: lastError ?? "one or more recordings failed",
              // A child may have completed its processing and committed its run.
              // Review the retained evidence before starting another pipeline.
              retryable: [
                "phone_pipeline_completion_unconfirmed",
                "phone_download_unconfirmed",
                "phone_recording_processing_held",
              ].includes(lastErrorCode ?? "")
                ? false
                : isRetryable(lastErrorCode),
              failedStep: lastFailedStep ?? undefined,
            },
          }
        : {}),
    };
  } catch {
    return {
      success: false,
      error: {
        code: "phone_recovery_unconfirmed",
        message:
          "Phone recovery selection or backlog could not be verified. Retained recordings remain available.",
        retryable: true,
      },
    };
  }
}
