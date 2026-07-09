// ServiceOS — shared phone pipeline orchestration helpers (Deno).
//
// The three step functions (simwood-download-recording, phone-transcribe-
// recording, phone-analyse-transcript) are already idempotent and self-logging.
// These helpers REUSE them via internal function-to-function invocation
// (service role) rather than duplicating their business logic. Idempotency and
// sync_run/audit logging therefore live in the invoked functions, not here.

interface StepOk {
  ok: true;
  data: Record<string, unknown>;
}
interface StepErr {
  ok: false;
  code: string;
  message: string;
  httpStatus: number;
}
export type StepResult = StepOk | StepErr;

function functionsBase(): string | null {
  const url = Deno.env.get("SUPABASE_URL");
  return url ? `${url}/functions/v1` : null;
}

/**
 * Invoke a sibling Edge Function server-to-server. `authToken` MUST be the
 * SERVICE-ROLE key (every caller in this codebase passes
 * Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")): the target's authz recognises the
 * service-role bearer + the x-internal-tenant-id header set below and binds the
 * tenant internally. A user JWT must NEVER be passed here — a background/manual
 * pipeline run would then fail the moment that session expires ("Invalid or
 * expired session"). `apikey` also uses the service-role key to pass the gateway.
 */
export async function invokeFunction(
  name: string,
  body: Record<string, unknown>,
  authToken: string,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const base = functionsBase();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key || !authToken) return { status: 0, json: null };

  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: `Bearer ${authToken}`,
    apikey: key,
  };
  // Carry the tenant on internal hops so the service-role auth path in authz.ts
  // can bind it. Harmless for user-JWT calls (that path ignores this header).
  if (body.tenant_id != null) headers["x-internal-tenant-id"] = String(body.tenant_id);

  let resp: Response;
  try {
    resp = await fetch(`${base}/${name}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, json: null };
  }

  let json: Record<string, unknown> | null = null;
  try {
    json = (await resp.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

function toStepError(step: string, status: number, json: Record<string, unknown> | null): StepErr {
  const error = (json?.error ?? {}) as { code?: unknown; message?: unknown };
  return {
    ok: false,
    code: typeof error.code === "string" ? error.code : `${step}_failed`,
    message:
      typeof error.message === "string"
        ? error.message
        : `${step} step failed (${status || "network"})`,
    httpStatus: status && status >= 400 ? status : 502,
  };
}

/** Ensure the recording's audio is downloaded (delegates to simwood-download-recording). */
export async function ensureRecordingDownloaded(opts: {
  tenantId: string;
  recordingId: string;
  force: boolean;
  authToken: string;
}): Promise<StepResult> {
  const { status, json } = await invokeFunction(
    "simwood-download-recording",
    { tenant_id: opts.tenantId, recording_id: opts.recordingId, force: opts.force },
    opts.authToken,
  );
  if (json?.success) return { ok: true, data: json };
  return toStepError("download", status, json);
}

/** Ensure the recording is transcribed (delegates to phone-transcribe-recording). */
export async function ensureRecordingTranscribed(opts: {
  tenantId: string;
  recordingId: string;
  force: boolean;
  authToken: string;
}): Promise<StepResult> {
  const { status, json } = await invokeFunction(
    "phone-transcribe-recording",
    { tenant_id: opts.tenantId, recording_id: opts.recordingId, force: opts.force },
    opts.authToken,
  );
  if (json?.success) return { ok: true, data: json };
  return toStepError("transcribe", status, json);
}

/** Ensure the transcript is analysed (delegates to phone-analyse-transcript). */
export async function ensureTranscriptAnalysed(opts: {
  tenantId: string;
  transcriptId: string;
  force: boolean;
  authToken: string;
}): Promise<StepResult> {
  const { status, json } = await invokeFunction(
    "phone-analyse-transcript",
    { tenant_id: opts.tenantId, transcript_id: opts.transcriptId, force: opts.force },
    opts.authToken,
  );
  if (json?.success) return { ok: true, data: json };
  return toStepError("analyse", status, json);
}

/**
 * Fire-and-forget pipeline runs for newly-inserted recordings. `authToken` MUST
 * be the SERVICE-ROLE key — this is a BACKGROUND path (it outlives the request
 * via EdgeRuntime.waitUntil), so a user JWT would frequently be expired by the
 * time it runs. Each invocation is failure-isolated.
 */
export function triggerPipelineBackground(
  tenantId: string,
  recordingIds: string[],
  authToken: string,
): void {
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  for (const recordingId of recordingIds) {
    const p = invokeFunction(
      "phone-process-pipeline",
      { tenant_id: tenantId, recording_id: recordingId, force: false },
      authToken,
    )
      .then(() => {})
      .catch(() => {});
    if (er?.waitUntil) er.waitUntil(p);
  }
}
