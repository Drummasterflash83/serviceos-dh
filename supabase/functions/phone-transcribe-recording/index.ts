// ServiceOS — Edge Function: phone-transcribe-recording (Phase Phone-4A)
//
// Transcribes a stored recording's WAV audio into text via OpenAI and writes it
// to phone_transcripts. Audio is read from the PRIVATE Supabase Storage bucket
// with the service-role key and sent to OpenAI server-side only — neither the
// audio URL nor the OpenAI key is ever exposed to the caller.
//
// Scope (Phase-4A): transcription ONLY. No AI summary/insight extraction, no
// diarization, no playback UI. Provider is isolated in _shared/openai.ts so a
// specialist (e.g. Deepgram) can be swapped in later. Runtime: Deno.
//
// Request body:
//   {
//     "tenant_id": "uuid",       // required
//     "recording_id": "uuid",    // required — phone_recordings.id
//     "force": boolean?          // optional — re-transcribe even if completed
//   }

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  isUuid,
  jsonResponse,
} from "../_shared/simwood.ts";
import { getOpenAiKey, getTranscriptionModel, transcribeAudio } from "../_shared/openai.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";

const PROVIDER = "openai";
const STORAGE_BUCKET = "phone-recordings";
const PREVIEW_CHARS = 240;

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

  const model = getTranscriptionModel();
  const baseMetadata: Record<string, unknown> = { recording_id: recordingId, force, model };

  // Open a sync run (running) so even a mid-run failure is auditable.
  const { data: runRow, error: runErr } = await supabase
    .from("phone_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "transcription",
      status: "running",
      metadata: baseMetadata,
    })
    .select("id")
    .single();
  if (runErr || !runRow) {
    return failResponse("db_error", "Could not open a sync run", 500);
  }
  const syncRunId = runRow.id as string;

  // Finalisers -------------------------------------------------------------
  async function writeAudit(
    status: "success" | "failed",
    detail: Record<string, unknown>,
  ): Promise<void> {
    try {
      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:phone-transcribe-recording",
        action: "phone.transcribe_recording",
        resource_type: "phone_transcripts",
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

  // Best-effort: mark a transcript row failed without masking the real error.
  async function markTranscriptFailed(transcriptId: string): Promise<void> {
    try {
      await supabase.from("phone_transcripts").update({ status: "failed" }).eq("id", transcriptId);
    } catch (_e) {
      // ignore
    }
  }

  async function finishFailed(
    code: string,
    message: string,
    httpStatus: number,
    metaExtra: Record<string, unknown> = {},
  ): Promise<Response> {
    await finish("failed", 0, { ...metaExtra, error_code: code }, message);
    return failResponse(code, message, httpStatus, {
      sync_run_id: syncRunId,
      recording_id: recordingId,
    });
  }

  // --- OpenAI key ----------------------------------------------------------
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    return await finishFailed("config_error", "OPENAI_API_KEY is not configured", 500);
  }

  // --- load the recording --------------------------------------------------
  const { data: recording, error: recErr } = await supabase
    .from("phone_recordings")
    .select("id, storage_path")
    .eq("id", recordingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (recErr) {
    return await finishFailed("db_error", "Failed to load recording", 500);
  }
  if (!recording) {
    return await finishFailed("not_found", "Recording not found for this tenant", 404);
  }
  const storagePath = recording.storage_path as string | null;
  if (!storagePath) {
    return await finishFailed(
      "missing_storage",
      "Recording has no stored audio — download it first (Phase-3)",
      422,
    );
  }

  // --- idempotency: existing completed transcript --------------------------
  const { data: existing } = await supabase
    .from("phone_transcripts")
    .select("id, status, transcript_text, language, model")
    .eq("tenant_id", tenantId)
    .eq("recording_id", recordingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && existing.status === "completed" && !force) {
    await finish(
      "success",
      0,
      { transcript_id: existing.id, status: "completed", already_transcribed: true },
      null,
    );
    return jsonResponse({
      success: true,
      provider: PROVIDER,
      recording_id: recordingId,
      transcript_id: existing.id,
      status: "completed",
      language: existing.language ?? "en",
      model: existing.model ?? model,
      text_preview: ((existing.transcript_text as string | null) ?? "").slice(0, PREVIEW_CHARS),
      sync_run_id: syncRunId,
    });
  }

  // --- ensure a transcript row in "processing" -----------------------------
  let transcriptId: string;
  if (existing) {
    transcriptId = existing.id as string;
    await supabase
      .from("phone_transcripts")
      .update({ status: "processing", model })
      .eq("id", transcriptId);
  } else {
    const { data: created, error: insErr } = await supabase
      .from("phone_transcripts")
      .insert({ tenant_id: tenantId, recording_id: recordingId, status: "processing", model })
      .select("id")
      .single();
    if (insErr || !created) {
      return await finishFailed("db_error", "Could not create a transcript row", 500);
    }
    transcriptId = created.id as string;
  }

  // --- download the WAV from private storage -------------------------------
  const { data: blob, error: dlErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);
  if (dlErr || !blob) {
    await markTranscriptFailed(transcriptId);
    return await finishFailed("missing_audio", "Audio file not found in storage", 404, {
      transcript_id: transcriptId,
    });
  }
  if (blob.size === 0) {
    await markTranscriptFailed(transcriptId);
    return await finishFailed("empty_audio", "Stored audio is empty", 502, {
      transcript_id: transcriptId,
    });
  }

  // --- transcribe (server-side, provider-isolated) -------------------------
  const result = await transcribeAudio({ apiKey, model, audio: blob, filename: "recording.wav" });
  if (!result.ok) {
    await markTranscriptFailed(transcriptId);
    return await finishFailed(result.code, result.message, result.httpStatus, {
      transcript_id: transcriptId,
    });
  }

  // --- persist the transcript ----------------------------------------------
  const language = result.language ?? "en";
  const { error: updErr } = await supabase
    .from("phone_transcripts")
    .update({
      transcript_text: result.text,
      language,
      model: result.model,
      status: "completed",
    })
    .eq("id", transcriptId);
  if (updErr) {
    await markTranscriptFailed(transcriptId);
    return await finishFailed("db_error", `Failed to store transcript: ${updErr.message}`, 500, {
      transcript_id: transcriptId,
    });
  }

  await finish(
    "success",
    1,
    {
      transcript_id: transcriptId,
      status: "completed",
      language,
      chars: result.text.length,
    },
    null,
  );

  return jsonResponse({
    success: true,
    provider: PROVIDER,
    recording_id: recordingId,
    transcript_id: transcriptId,
    status: "completed",
    language,
    model: result.model,
    text_preview: result.text.slice(0, PREVIEW_CHARS),
    sync_run_id: syncRunId,
  });
});
