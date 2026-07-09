// ServiceOS — Edge Function: phone-process-pipeline (Phase 5A)
//
// Orchestrates the full phone intelligence pipeline for ONE recording:
//   download audio → transcribe → analyse.
// Reuses the existing idempotent step functions via _shared/phone_pipeline.ts
// (no duplicated business logic). Each step is idempotent, so the whole pipeline
// is safe to re-run; `force` re-runs every step. A failed step stops THIS
// pipeline only — callers (e.g. the recordings sync) isolate failures per
// recording. Runtime: Deno.
//
// Request body: { tenant_id: uuid, recording_id: uuid, force?: boolean }

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  isUuid,
  jsonResponse,
} from "../_shared/simwood.ts";
import {
  ensureRecordingDownloaded,
  ensureRecordingTranscribed,
  ensureTranscriptAnalysed,
} from "../_shared/phone_pipeline.ts";
import { finalizeInteractionForRecording } from "../_shared/phone_enrich.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";

const PROVIDER = "pipeline";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  // --- input validation ----------------------------------------------------
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const body = (parsed ?? {}) as Record<string, unknown>;

  const recordingId = body.recording_id;
  if (!isUuid(recordingId)) {
    return failResponse("invalid_recording_id", "recording_id is required and must be a UUID", 400);
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return failResponse("invalid_force", "force must be a boolean", 400);
  }
  const force = body.force === true;

  // --- DB client -----------------------------------------------------------
  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  // --- authz: bind tenant server-side (force ⇒ owner/admin only) -----------
  const auth = await requireTenantUser(
    req,
    supabase,
    force ? ["owner", "admin"] : ["owner", "admin", "ops"],
  );
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // The caller (user OR internal) is now authenticated and the tenant is bound
  // server-side. The heavy step functions run SERVER-TO-SERVER via the internal
  // service path (service-role key + x-internal-tenant-id), never a user JWT — so
  // background/manual processing never fails on an expired session. Each child
  // still re-validates that the record belongs to this tenant_id.
  const authToken = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authToken) {
    return failResponse("config_error", "Service role key is not configured", 500);
  }

  const baseMetadata: Record<string, unknown> = { recording_id: recordingId, force };

  const { data: runRow, error: runErr } = await supabase
    .from("phone_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "pipeline",
      status: "running",
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return failResponse("db_error", "Could not open a sync run", 500);
  }
  const syncRunId = runRow.id as string;

  async function writeAudit(
    status: "success" | "failed",
    detail: Record<string, unknown>,
  ): Promise<void> {
    try {
      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:phone-process-pipeline",
        action: "phone.process_pipeline",
        resource_type: "phone_recordings",
        resource_id: recordingId as string,
        status,
        detail,
      });
    } catch (_e) {
      // never mask the real result
    }
  }

  async function finish(
    status: "success" | "failed",
    recordsProcessed: number,
    metaExtra: Record<string, unknown>,
    errorMessage: string | null,
  ): Promise<void> {
    const metadata = { ...baseMetadata, ...metaExtra };
    try {
      await supabase
        .from("phone_sync_runs")
        .update({
          status,
          completed_at: new Date().toISOString(),
          records_processed: recordsProcessed,
          error_message: errorMessage,
          metadata,
        })
        .eq("id", syncRunId);
    } catch (_e) {
      // ignore
    }
    await writeAudit(status, { ...metadata, ...(errorMessage ? { message: errorMessage } : {}) });
  }

  // Structured per-step trace so a failed run is self-diagnosing WITHOUT logging
  // any transcript/audio content or secrets — only step outcomes + a length-capped
  // safe error string (already just auth/step codes, never content). Identity /
  // customer-card enrichment run in a downstream subscriber (identity-resolve), so
  // they are out of this pipeline's scope and marked "deferred".
  function buildTrace(opts: {
    finalStatus: "success" | "failed";
    downloaded: boolean;
    transcribed: boolean;
    analysed: boolean;
    interaction?: string;
    event?: string;
    failedStep?: string | null;
    errorCode?: string | null;
    errorMessageSafe?: string | null;
  }): Record<string, unknown> {
    return {
      recording_id: recordingId,
      download: opts.downloaded ? "ok" : opts.failedStep === "download" ? "failed" : "pending",
      transcribe: opts.transcribed ? "ok" : opts.failedStep === "transcribe" ? "failed" : "pending",
      analyse: opts.analysed ? "ok" : opts.failedStep === "analyse" ? "failed" : "pending",
      interaction: opts.interaction ?? "none",
      event: opts.event ?? "none",
      identity: "deferred", // downstream subscriber (identity-resolve) — not this pipeline
      final_status: opts.finalStatus,
      failed_step: opts.failedStep ?? null,
      error_code: opts.errorCode ?? null,
      error_message_safe: opts.errorMessageSafe ? opts.errorMessageSafe.slice(0, 300) : null,
    };
  }

  async function finishFailed(
    code: string,
    message: string,
    httpStatus: number,
    stages: { downloaded: boolean; transcribed: boolean; analysed: boolean },
    failedStep: string,
    metaExtra: Record<string, unknown> = {},
  ): Promise<Response> {
    const trace = buildTrace({
      finalStatus: "failed",
      ...stages,
      failedStep,
      errorCode: code,
      errorMessageSafe: message,
    });
    await finish(
      "failed",
      0,
      { ...stages, ...metaExtra, error_code: code, failed_step: failedStep, trace },
      message,
    );
    return failResponse(code, message, httpStatus, {
      sync_run_id: syncRunId,
      recording_id: recordingId,
      downloaded: stages.downloaded,
      transcribed: stages.transcribed,
      analysed: stages.analysed,
      failed_step: failedStep,
      trace,
    });
  }

  // --- Step 1: recording exists -------------------------------------------
  const { data: recording, error: recErr } = await supabase
    .from("phone_recordings")
    .select("id")
    .eq("id", recordingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (recErr) {
    return await finishFailed(
      "db_error",
      "Failed to load recording",
      500,
      { downloaded: false, transcribed: false, analysed: false },
      "load",
    );
  }
  if (!recording) {
    return await finishFailed(
      "not_found",
      "Recording not found for this tenant",
      404,
      { downloaded: false, transcribed: false, analysed: false },
      "load",
    );
  }

  // --- Step 2: download (idempotent) --------------------------------------
  const d = await ensureRecordingDownloaded({ tenantId, recordingId, force, authToken });
  if (!d.ok) {
    return await finishFailed(
      d.code,
      d.message,
      d.httpStatus,
      { downloaded: false, transcribed: false, analysed: false },
      "download",
    );
  }

  // --- Step 3: transcribe (idempotent) ------------------------------------
  const t = await ensureRecordingTranscribed({ tenantId, recordingId, force, authToken });
  if (!t.ok) {
    return await finishFailed(
      t.code,
      t.message,
      t.httpStatus,
      { downloaded: true, transcribed: false, analysed: false },
      "transcribe",
    );
  }
  const transcriptId = typeof t.data.transcript_id === "string" ? t.data.transcript_id : null;
  if (!transcriptId) {
    return await finishFailed(
      "transcribe_incomplete",
      "No transcript id returned",
      502,
      { downloaded: true, transcribed: false, analysed: false },
      "transcribe",
    );
  }

  // --- Step 4: analyse (idempotent) ---------------------------------------
  const a = await ensureTranscriptAnalysed({ tenantId, transcriptId, force, authToken });
  if (!a.ok) {
    return await finishFailed(
      a.code,
      a.message,
      a.httpStatus,
      { downloaded: true, transcribed: true, analysed: false },
      "analyse",
      { transcript_id: transcriptId },
    );
  }
  const insightId = typeof a.data.insight_id === "string" ? a.data.insight_id : null;

  // --- Step 5: produce the canonical interaction + publish interaction.ready ---
  // The pipeline's ONLY hand-off to the shared business layer. Best-effort: a
  // failure here never fails the (already successful) analysis — downstream
  // enrichment engines are independent subscribers, not pipeline dependencies.
  // The scheduled interactions/identity syncs also cover this on their own cadence.
  const fin = await finalizeInteractionForRecording({
    admin: supabase,
    tenantId,
    recordingId: recordingId as string,
  });

  const interactionStatus = !fin.ok
    ? `skipped(${fin.reason ?? "unknown"})`
    : fin.alreadyEnriched
      ? "enriched"
      : "ready";
  const eventStatus = fin.eventPublished
    ? "published"
    : fin.ok && fin.alreadyEnriched
      ? "skipped"
      : "none";

  const trace = buildTrace({
    finalStatus: "success",
    downloaded: true,
    transcribed: true,
    analysed: true,
    interaction: interactionStatus,
    event: eventStatus,
  });

  // --- Step 6: combined result --------------------------------------------
  await finish(
    "success",
    1,
    {
      downloaded: true,
      transcribed: true,
      analysed: true,
      transcript_id: transcriptId,
      insight_id: insightId,
      interaction_id: fin.interactionId,
      interaction_ready: fin.ok && !fin.alreadyEnriched,
      event_published: fin.eventPublished,
      ...(fin.ok ? {} : { finalize_skipped: fin.reason ?? "unknown" }),
      trace,
    },
    null,
  );

  return jsonResponse({
    success: true,
    recording_id: recordingId,
    downloaded: true,
    transcribed: true,
    analysed: true,
    transcript_id: transcriptId,
    insight_id: insightId,
    interaction_id: fin.interactionId,
    interaction_ready: fin.ok && !fin.alreadyEnriched,
    event_published: fin.eventPublished,
    failed_step: null,
    trace,
    sync_run_id: syncRunId,
  });
});
