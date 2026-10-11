// Versioned server-side transcription; previous completed text is retained until atomic publication.
import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  isUuid,
  jsonResponse,
} from "../_shared/simwood.ts";
import { getOpenAiKey, getTranscriptionModel, transcribeAudio } from "../_shared/openai.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import {
  phoneInputDigest,
  reconcilePhoneDerivedVersion,
  runPhoneDerivedVersion,
} from "../_shared/phone-derived-version.ts";
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const recordingId = body.recording_id,
    resume = body.resume_run_id,
    force = body.force === true;
  if (!isUuid(recordingId))
    return failResponse("invalid_recording_id", "recording_id must be a UUID", 400);
  if (body.force !== undefined && typeof body.force !== "boolean")
    return failResponse("invalid_force", "force must be a boolean", 400);
  if (resume !== undefined && (!isUuid(resume) || force))
    return failResponse(
      "invalid_resume",
      "resume_run_id must be a UUID and cannot be combined with force",
      400,
    );
  const db = createSupabaseAdmin();
  if (!db) return failResponse("config_error", "Supabase admin client is not configured", 500);
  const auth = await requireTenantUser(
    req,
    db,
    force || resume !== undefined ? ["owner", "admin"] : ["owner", "admin", "ops"],
  );
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId,
    model = getTranscriptionModel();
  const recording = await db
    .from("phone_recordings")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", recordingId)
    .maybeSingle();
  if (recording.error || !recording.data)
    return failResponse("recording_unavailable", "Recording is unavailable for this company", 404);
  let runId = resume as string | undefined;
  if (!runId) {
    const run = await db
      .from("phone_sync_runs")
      .insert({
        tenant_id: tenantId,
        provider: "openai",
        sync_type: "transcription",
        status: "running",
        metadata: { recording_id: recordingId, model, force },
      })
      .select("id")
      .single();
    if (run.error || !isUuid(run.data?.id))
      return failResponse("db_error", "Could not open a sync run", 500);
    runId = run.data.id;
  }
  const scope = {
    tenantId,
    recordingId: recordingId as string,
    runId: runId!,
    stage: "transcription" as const,
  };
  const result =
    resume !== undefined
      ? await reconcilePhoneDerivedVersion(db, scope)
      : await runPhoneDerivedVersion({
          db,
          scope,
          request: { model, force },
          prepareInput: async (source) => {
            // Cached receipts and reconciliation work without obtaining a provider key.
            const apiKey = getOpenAiKey();
            if (!apiKey) return { ok: false, code: "config_error" };
            if (typeof source.storagePath !== "string")
              return { ok: false, code: "input_unavailable" };
            const stored = await db.storage.from("phone-recordings").download(source.storagePath);
            if (stored.error || !(stored.data instanceof Blob))
              return { ok: false, code: "missing_audio" };
            if (stored.data.size === 0) return { ok: false, code: "empty_audio" };
            if (stored.data.size > 25_000_000) return { ok: false, code: "audio_too_large" };
            const bytes = new Uint8Array(await stored.data.arrayBuffer());
            return {
              ok: true,
              request: { sha256: await phoneInputDigest(bytes), bytes: bytes.byteLength },
              invoke: async () => {
                const response = await transcribeAudio({
                  apiKey,
                  model,
                  audio: stored.data,
                  filename: "recording.wav",
                });
                if (!response.ok) return { ok: false, code: response.code };
                if (!response.text.trim()) return { ok: false, code: "malformed_response" };
                return {
                  ok: true,
                  output: {
                    text: response.text,
                    language: response.language ?? "en",
                    model: response.model,
                  },
                };
              },
            };
          },
        });
  if (!result.ok)
    return failResponse(result.code, result.message, result.httpStatus, {
      sync_run_id: runId,
      recording_id: recordingId,
    });
  try {
    await db.from("audit_logs").insert({
      tenant_id: tenantId,
      actor: "edge:phone-transcribe-recording",
      action: "phone.transcribe_recording",
      resource_type: "phone_transcripts",
      resource_id: result.resultId,
      status: "success",
      detail: { sync_run_id: runId, cached: result.cached, reconciled: resume !== undefined },
    });
  } catch {
    /* receipt remains authoritative */
  }
  return jsonResponse({
    success: true,
    provider: "openai",
    recording_id: recordingId,
    transcript_id: result.resultId,
    status: "completed",
    language: result.result.language ?? "en",
    model: result.result.model ?? model,
    text_preview: String(result.result.text ?? "").slice(0, 240),
    sync_run_id: runId,
    reconciled: resume !== undefined,
    already_transcribed: result.cached,
  });
});
