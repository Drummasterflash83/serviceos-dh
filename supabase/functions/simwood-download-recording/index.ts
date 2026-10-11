import { captureAdmission } from "../_shared/learn_capture_control.ts";
import {
  capturePhoneRecordingVersion,
  reconcilePhoneRecordingVersion,
} from "../_shared/phone-download-version.ts";
import { confirmPhonePipelineCompletion } from "../_shared/phone-pipeline-completion.ts";
import {
  resolveSimwoodAccount,
  boundSimwoodRecordingUrl,
  simwoodRecordingCustomer,
} from "../_shared/simwood-account.ts";
// ServiceOS — Edge Function: simwood-download-recording (Phase Phone-3)
//
// Downloads a single recording's WAV audio from Simwood/Sipcentric (server-side
// only) and stores it in the PRIVATE Supabase Storage bucket `phone-recordings`.
// New downloads use immutable attempt-specific paths; unless force=true, an
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
//     "force": boolean?,         // optional — re-download even if stored
//     "resume_run_id": "uuid"?   // owner/admin: verify and finish this existing attempt only
//   }

import {
  createSupabaseAdmin,
  failResponse,
  getSimwoodCredentials,
  isUuid,
  jsonResponse,
  PROVIDER,
  simwoodGetBinary,
  corsHeaders,
} from "../_shared/simwood.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";

// Provider recording retention window. A 404 on a recording younger than this is
// treated as "not ready yet" (retryable); older than this, the audio is gone for
// good (non-retryable). Simwood/Sipcentric retention is conservative here.
const PROVIDER_RETENTION_DAYS = 45;

/**
 * Map a raw provider fetch failure to a SAFE, retry-aware error code (§5). The
 * queue (platform_queue.ts) reads these codes to decide retry vs dead-letter:
 * transient provider states retry with backoff; a recording gone past retention
 * dead-letters. Never contains a URL, secret or customer content.
 */
function classifyDownloadError(
  code: string,
  ageMs: number | null,
): { code: string; retryable: boolean } {
  switch (code) {
    case "rate_limited":
      return { code: "provider_rate_limited", retryable: true };
    case "network_error":
      return { code: "provider_timeout", retryable: true };
    case "upstream_error":
    case "download_error":
      return { code: "download_failed", retryable: true };
    case "not_found": {
      // A provider 404: not ready yet (young) vs permanently gone (past retention).
      const beyondRetention =
        ageMs !== null && ageMs > PROVIDER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      return beyondRetention
        ? { code: "provider_recording_missing", retryable: false }
        : { code: "recording_not_ready", retryable: true };
    }
    default:
      // auth_failed / anything else — keep the original code.
      return { code, retryable: true };
  }
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

  const recordingId = body.recording_id;
  if (!isUuid(recordingId)) {
    return failResponse("invalid_recording_id", "recording_id is required and must be a UUID", 400);
  }
  if (body.force !== undefined && typeof body.force !== "boolean") {
    return failResponse("invalid_force", "force must be a boolean", 400);
  }
  const force = body.force === true;
  const resumeRunId = body.resume_run_id;
  if (resumeRunId !== undefined && (!isUuid(resumeRunId) || force))
    return failResponse(
      "invalid_resume",
      "resume_run_id must be a UUID and cannot be combined with force",
      400,
    );

  // --- DB client (required: we must be able to log + read + write) ---------
  const configuredClient = createSupabaseAdmin();
  if (!configuredClient) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }
  const supabase = configuredClient;

  // --- authz: bind tenant server-side (force ⇒ owner/admin only) -----------
  const auth = await requireTenantUser(
    req,
    supabase,
    force || resumeRunId !== undefined ? ["owner", "admin"] : ["owner", "admin", "ops"],
  );
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // --- load the recording row ---------------------------------------------
  const { data: recording, error: recErr } = await supabase
    .from("phone_recordings")
    .select(
      "id, provider, provider_recording_id, recording_uri, storage_path, file_size, started_at, created_at",
    )
    .eq("id", recordingId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (recErr) {
    return failResponse("db_error", "Failed to load recording", 500);
  }
  if (!recording) {
    return failResponse("not_found", "Recording not found for this tenant", 404);
  }

  if (resumeRunId !== undefined) {
    const reconciled = await reconcilePhoneRecordingVersion(supabase, {
      tenantId,
      runId: resumeRunId as string,
      recordingId: recordingId as string,
    });
    if (!reconciled.ok)
      return failResponse(reconciled.code, reconciled.message, reconciled.httpStatus, {
        sync_run_id: resumeRunId,
        recording_id: recordingId,
      });
    return jsonResponse({
      success: true,
      provider: PROVIDER,
      recording_id: recordingId,
      storage_path: reconciled.storagePath,
      reconciled: true,
      sync_run_id: resumeRunId,
    });
  }

  // Stored audio remains usable while capture is paused. Only a new download
  // (including force) needs provider admission, before opening a sync run.
  if (!recording.storage_path || force) {
    const admission = await captureAdmission(supabase, tenantId, "phone");
    if (!admission.allowed)
      return failResponse(admission.code, admission.message, admission.httpStatus);
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
  ): Promise<boolean> {
    const metadata = { ...baseMetadata, ...metaExtra };
    const confirmed = await confirmPhonePipelineCompletion(supabase, {
      runKind: "download",
      tenantId,
      runId: syncRunId,
      status,
      recordsProcessed,
      errorMessage,
      metadata,
    });
    if (!confirmed) return false;
    await writeAudit(status, { ...metadata, ...(errorMessage ? { message: errorMessage } : {}) });
    return true;
  }

  async function finishFailed(
    code: string,
    message: string,
    httpStatus: number,
    metaExtra: Record<string, unknown> = {},
  ): Promise<Response> {
    if (!(await finish("failed", 0, { ...metaExtra, error_code: code }, message)))
      return failResponse(
        "phone_download_unconfirmed",
        "The saved download status needs review.",
        503,
        { sync_run_id: syncRunId, recording_id: recordingId },
      );
    return failResponse(code, message, httpStatus, {
      sync_run_id: syncRunId,
      recording_id: recordingId,
    });
  }

  if (recording.provider !== PROVIDER)
    return await finishFailed(
      "invalid_recording",
      "Recording belongs to a different phone provider",
      422,
    );
  const providerRecordingId = recording.provider_recording_id as string | null;
  if (!providerRecordingId) {
    // Unfetchable forever (non-retryable per platform_queue.ts).
    return await finishFailed("invalid_recording", "Recording has no provider_recording_id", 422);
  }

  // Recording age drives 404 classification (not-ready vs gone-past-retention).
  const recordedAtIso = (recording.started_at ?? recording.created_at) as string | null;
  const recordingAgeMs =
    recordedAtIso && !Number.isNaN(Date.parse(recordedAtIso))
      ? Date.now() - Date.parse(recordedAtIso)
      : null;

  // --- short-circuit if already downloaded --------------------------------
  if (recording.storage_path && !force) {
    const confirmed = await finish(
      "success",
      0,
      {
        provider_recording_id: providerRecordingId,
        storage_path: recording.storage_path,
        already_downloaded: true,
      },
      null,
    );
    if (!confirmed)
      return failResponse(
        "phone_download_unconfirmed",
        "The saved download status needs review.",
        503,
        { sync_run_id: syncRunId, recording_id: recordingId },
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

  // Bind downloads to the tenant's registered account, never the first shared account.
  const account = await resolveSimwoodAccount(
    supabase,
    tenantId,
    simwoodRecordingCustomer(providerRecordingId, recording.recording_uri),
  );
  if (!account.ok) return await finishFailed(account.code, account.message, account.httpStatus);
  const downloadUrl = boundSimwoodRecordingUrl(
    account.customerId,
    providerRecordingId,
    recording.recording_uri,
  );
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

  // --- credentials ---------------------------------------------------------
  const creds = getSimwoodCredentials();
  if (!creds) {
    return await finishFailed("config_error", "Simwood credentials are not configured", 500);
  }

  const downloaded = await capturePhoneRecordingVersion({
    db: supabase,
    scope: { tenantId, runId: syncRunId, recordingId: recordingId as string },
    definition: {
      accountId: account.accountId,
      connectorId: account.connectorId,
      customerId: account.customerId,
      source: {
        providerRecordingId,
        recordingUri: recording.recording_uri ?? null,
        storagePath: recording.storage_path ?? null,
        fileSize: recording.file_size ?? null,
      },
    },
    fetchAudio: async () => {
      const audio = await simwoodGetBinary(downloadUrl, creds, "audio/wav");
      return audio.ok
        ? audio
        : { ok: false, code: classifyDownloadError(audio.code, recordingAgeMs).code };
    },
  });
  if (!downloaded.ok)
    return failResponse(downloaded.code, downloaded.message, downloaded.httpStatus, {
      sync_run_id: syncRunId,
      recording_id: recordingId,
    });
  await writeAudit("success", {
    ...baseMetadata,
    downloaded_bytes: downloaded.bytes,
    sha256: downloaded.sha256,
  });
  return jsonResponse({
    success: true,
    provider: PROVIDER,
    recording_id: recordingId,
    provider_recording_id: providerRecordingId,
    storage_path: downloaded.storagePath,
    already_downloaded: false,
    sync_run_id: syncRunId,
  });
});
