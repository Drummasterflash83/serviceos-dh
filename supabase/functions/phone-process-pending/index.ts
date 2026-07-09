// ServiceOS — Edge Function: phone-process-pending (backlog drainer)
//
// Finds recordings that aren't fully processed (not downloaded, or downloaded but
// not transcribed, or transcribed but not analysed) and runs the existing
// idempotent pipeline for a SAFE batch. Every child step runs via the internal
// service path (no user JWT), so this works both when a user clicks "Process
// pending now" AND when the scheduled processor invokes it server-to-server.
//
// Auth: normal authz (owner/admin/ops) for user calls; the internal service path
// (service-role key + x-internal-tenant-id) for the scheduled caller. Tenant is
// bound server-side — the browser can never spoof it. No secrets logged.
//
// Request body: { tenant_id?: uuid, limit?: number }  → returns per-stage counts.

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { invokeFunction } from "../_shared/phone_pipeline.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";

// Serial OpenAI/download work per recording — keep the batch small to stay well
// under the function wall-clock. Repeated calls / the scheduler drain the rest.
const DEFAULT_BATCH = 5;
const MAX_BATCH = 10;
// How many recent recordings to scan when selecting the pending batch.
const SCAN_LIMIT = 40;

function clampBatch(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : DEFAULT_BATCH;
  return Math.max(1, Math.min(MAX_BATCH, n));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  const supabase = createSupabaseAdmin();
  if (!supabase)
    return failResponse("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);

  let body: { tenant_id?: unknown; limit?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const batch = clampBatch(body.limit);

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) return failResponse("config_error", "Service role key is not configured", 500);

  const job = await createPlatformJob(supabase, {
    tenantId,
    connectorId: "simwood",
    moduleId: "communications.phone",
    jobType: "phone.process_pending",
    jobKey: `phone.process_pending:${tenantId}`,
    payload: { batch },
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(supabase, jobId);

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
    let failed = 0;
    // Surface the most recent child error (e.g. missing OPENAI_API_KEY) instead of
    // hiding it behind an opaque `failed` count. Never contains a secret — the
    // step functions return only codes/messages.
    let lastError: string | null = null;

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
      } else {
        failed += 1;
        const err = (j?.error ?? null) as { code?: unknown; message?: unknown } | null;
        const code = typeof err?.code === "string" ? err.code : null;
        const message = typeof err?.message === "string" ? err.message : null;
        lastError = message ?? code ?? `pipeline failed (${res.status || "network"})`;
      }
    }

    if (jobId) {
      await completePlatformJob(supabase, jobId, {
        recordsProcessed: pending.length,
        result: {
          downloaded,
          transcribed,
          analysed: analysedCount,
          failed,
          skipped,
          ...(lastError ? { last_error: lastError } : {}),
        },
      });
    }

    return jsonResponse({
      success: failed === 0,
      processed: pending.length,
      downloaded,
      transcribed,
      analysed: analysedCount,
      failed,
      skipped,
      last_error: lastError,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "process-pending failed";
    if (jobId) await failPlatformJob(supabase, jobId, message);
    return failResponse("process_error", message, 500);
  }
});
