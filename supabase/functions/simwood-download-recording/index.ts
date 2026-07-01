// ServiceOS — Edge Function: simwood-download-recording (Phase Phone-3)
//
// Downloads a single recording's WAV audio from Simwood/Sipcentric (server-side
// only) and stores it in the PRIVATE Supabase Storage bucket `phone-recordings`.
// Idempotent: the storage path is deterministic and, unless force=true, an
// already-downloaded recording returns without re-downloading. Every attempt is
// logged to phone_sync_runs and mirrored to audit_logs.
//
// Scope (Phase-3): audio download + secure storage ONLY. No transcription, no
// AI enrichment. The raw Simwood recording URL and credentials are never
// returned to the caller. Runtime: Supabase Edge Functions (Deno).
//
// Request body:
//   {
//     "tenant_id": "uuid",       // required
//     "recording_id": "uuid",    // required — phone_recordings.id
//     "force": boolean?          // optional — re-download even if stored
//   }

import {
  createSupabaseAdmin,
  discoverCustomerId,
  failResponse,
  getSimwoodCredentials,
  isUuid,
  jsonResponse,
  PROVIDER,
  resolveSimwoodUrl,
  SIMWOOD_API_BASE,
  simwoodGetBinary,
  corsHeaders,
} from "../_shared/simwood.ts";

const STORAGE_BUCKET = "phone-recordings";

/** Keep storage keys safe/deterministic: only [A-Za-z0-9._-], others -> "_". */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

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

  const tenantId = body.tenant_id;
  if (!isUuid(tenantId)) {
    return failResponse("invalid_tenant_id", "tenant_id is required and must be a UUID", 400);
  }
  const recordingId = body.recording_id;
  if (!isUuid(recordingId)) {
    return failResponse("invalid_recording_id", "recording_id is required and must be a UUID", 400);
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return failResponse("invalid_force", "force must be a boolean", 400);
  }
  const force = body.force === true;

  // --- DB client (required: we must be able to log + read + write) ---------
  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  const baseMetadata: Record<string, unknown> = { recording_id: recordingId, force };

  // Open a sync run (status running) so even a mid-run failure is auditable.
  const { data: runRow, error: runErr } = await supabase
    .from("phone_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "recording_download",
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
        actor: "edge:simwood-download-recording",
        action: "simwood.download_recording",
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

  // --- credentials ---------------------------------------------------------
  const creds = getSimwoodCredentials();
  if (!creds) {
    return await finishFailed("config_error", "Simwood credentials are not configured", 500);
  }

  // --- load the recording row ---------------------------------------------
  const { data: recording, error: recErr } = await supabase
    .from("phone_recordings")
    .select("id, provider, provider_recording_id, recording_uri, storage_path, file_size")
    .eq("id", recordingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (recErr) {
    return await finishFailed("db_error", "Failed to load recording", 500);
  }
  if (!recording) {
    return await finishFailed("not_found", "Recording not found for this tenant", 404);
  }

  const providerRecordingId = recording.provider_recording_id as string | null;
  if (!providerRecordingId) {
    return await finishFailed("invalid_recording", "Recording has no provider_recording_id", 422);
  }

  const storagePath = `${tenantId}/${PROVIDER}/recordings/${safeSegment(providerRecordingId)}.wav`;

  // --- short-circuit if already downloaded --------------------------------
  if (recording.storage_path && !force) {
    await finish(
      "success",
      0,
      {
        provider_recording_id: providerRecordingId,
        storage_path: recording.storage_path,
        already_downloaded: true,
      },
      null,
    );
    return jsonResponse({
      success: true,
      provider: PROVIDER,
      recording_id: recordingId,
      provider_recording_id: providerRecordingId,
      storage_path: recording.storage_path,
      already_downloaded: true,
      sync_run_id: syncRunId,
    });
  }

  // --- resolve the download URL (host-locked) -----------------------------
  let downloadUrl = resolveSimwoodUrl(recording.recording_uri);
  if (!downloadUrl) {
    // Fall back to constructing the canonical path from the customer + id.
    const discovered = await discoverCustomerId(creds);
    if (!discovered.ok) {
      return await finishFailed(discovered.code, discovered.message, discovered.httpStatus, {
        provider_recording_id: providerRecordingId,
      });
    }
    downloadUrl = resolveSimwoodUrl(
      `${SIMWOOD_API_BASE}/customers/${encodeURIComponent(discovered.customerId)}/recordings/${encodeURIComponent(providerRecordingId)}`,
    );
  }
  if (!downloadUrl) {
    return await finishFailed(
      "invalid_recording_uri",
      "Could not resolve a valid Simwood recording URL",
      422,
      {
        provider_recording_id: providerRecordingId,
      },
    );
  }

  // --- download the WAV (server-side only) --------------------------------
  const audio = await simwoodGetBinary(downloadUrl, creds, "audio/wav");
  if (!audio.ok) {
    return await finishFailed(audio.code, audio.message, audio.httpStatus, {
      provider_recording_id: providerRecordingId,
    });
  }
  if (audio.bytes.byteLength === 0) {
    return await finishFailed("empty_audio", "Downloaded audio was empty", 502, {
      provider_recording_id: providerRecordingId,
    });
  }

  // --- store in the private bucket ----------------------------------------
  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, new Blob([audio.bytes], { type: "audio/wav" }), {
      contentType: "audio/wav",
      upsert: true,
    });
  if (uploadErr) {
    return await finishFailed("storage_error", `Failed to store audio: ${uploadErr.message}`, 500, {
      provider_recording_id: providerRecordingId,
      storage_path: storagePath,
    });
  }

  // --- record the storage pointer -----------------------------------------
  const { error: updateErr } = await supabase
    .from("phone_recordings")
    .update({ storage_path: storagePath })
    .eq("id", recordingId)
    .eq("tenant_id", tenantId);
  if (updateErr) {
    return await finishFailed("db_error", `Failed to update recording: ${updateErr.message}`, 500, {
      provider_recording_id: providerRecordingId,
      storage_path: storagePath,
    });
  }

  // --- success -------------------------------------------------------------
  const downloadedBytes = audio.bytes.byteLength;
  const expectedSize = typeof recording.file_size === "number" ? recording.file_size : null;
  const sizeMismatch =
    expectedSize !== null && expectedSize > 0 && expectedSize !== downloadedBytes;

  await finish(
    "success",
    1,
    {
      provider_recording_id: providerRecordingId,
      storage_path: storagePath,
      already_downloaded: false,
      downloaded_bytes: downloadedBytes,
      expected_bytes: expectedSize,
      size_mismatch: sizeMismatch,
    },
    null,
  );

  return jsonResponse({
    success: true,
    provider: PROVIDER,
    recording_id: recordingId,
    provider_recording_id: providerRecordingId,
    storage_path: storagePath,
    already_downloaded: false,
    sync_run_id: syncRunId,
  });
});
