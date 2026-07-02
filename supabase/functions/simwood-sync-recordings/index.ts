// ServiceOS — Edge Function: simwood-sync-recordings (Phase Phone-2)
//
// Ingests Simwood/Sipcentric recording METADATA into the phone_recordings
// table. Idempotent: upserts on (tenant_id, provider, provider_recording_id)
// so re-running never duplicates a recording. Every attempt is recorded in
// phone_sync_runs and mirrored to audit_logs.
//
// Scope (Phase-2): recording metadata ONLY. It does NOT download WAV audio,
// transcribe, or run AI enrichment — those are later phases. Runtime: Supabase
// Edge Functions (Deno); URL imports only.
//
// Request body:
//   {
//     "tenant_id": "uuid",                 // required
//     "provider_customer_id": "string?",   // optional; discovered if omitted
//     "from": "ISO date?",                 // optional; defaults to now-24h
//     "to": "ISO date?",                   // optional; defaults to now
//     "call_id": "string?",                // optional; API `callId` filter
//     "linked_id": "string?",              // optional; API `linkedId` filter
//     "limit": number?                     // optional; max records to process
//   }
//
// NOTE: the request's `from`/`to` are the DATE WINDOW and map to the API's
// `startedAfter`/`startedBefore` (recording start time), consistent with the
// call-history sync. They are not the API's number filters.

import {
  createSupabaseAdmin,
  discoverCustomerId,
  extractItems,
  failResponse,
  getSimwoodCredentials,
  isUuid,
  jsonResponse,
  PROVIDER,
  simwoodGet,
  corsHeaders,
} from "../_shared/simwood.ts";
import { triggerPipelineBackground } from "../_shared/phone_pipeline.ts";
import { assertSameTenant, getBearerToken, requireTenantUser } from "../_shared/authz.ts";

// Safety cap: at most this many newly-inserted recordings auto-trigger the
// pipeline per sync run (backstop against a large backfill flooding OpenAI).
const MAX_AUTO_PIPELINE = 50;

const PAGE_SIZE_MAX = 200; // Simwood cap
const HARD_PAGE_CAP = 50; // safety bound: at most 50 pages (~10k rows) per run

function toIso(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function toInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Last path segment of a URI (recordings are addressed at /recordings/{id}). */
function lastPathSegment(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const clean = value.split("?")[0].replace(/\/+$/, "");
  const seg = clean.substring(clean.lastIndexOf("/") + 1);
  return seg || null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
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

  const limit = toInt(body.limit);
  if (body.limit !== undefined && (limit === null || limit <= 0)) {
    return failResponse("invalid_limit", "limit must be a positive number", 400);
  }

  const callIdFilter = optionalString(body.call_id);
  const linkedIdFilter = optionalString(body.linked_id);

  // Default window: last 24 hours.
  const nowIso = new Date().toISOString();
  const from = toIso(body.from) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = toIso(body.to) ?? nowIso;
  if (Date.parse(from) > Date.parse(to)) {
    return failResponse("invalid_range", "'from' must be before 'to'", 400);
  }

  // --- DB client (required: we must be able to log + upsert) ---------------
  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  // --- authz: bind tenant server-side (sync ⇒ owner/admin/ops) -------------
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const authToken = getBearerToken(req) ?? "";

  const suppliedCustomerId = optionalString(body.provider_customer_id);

  const baseMetadata: Record<string, unknown> = {
    from,
    to,
    call_id: callIdFilter,
    linked_id: linkedIdFilter,
    limit,
    provider_customer_id_supplied: suppliedCustomerId !== null,
  };

  // Open a sync run (status running) so even a mid-run failure is auditable.
  const { data: runRow, error: runErr } = await supabase
    .from("phone_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "recordings",
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
        actor: "edge:simwood-sync-recordings",
        action: "simwood.sync_recordings",
        resource_type: "phone_recordings",
        resource_id: syncRunId,
        status,
        detail,
      });
    } catch (_e) {
      // never mask the real result
    }
  }

  async function finishFailed(
    code: string,
    message: string,
    httpStatus: number,
    recordsProcessed: number,
    metaExtra: Record<string, unknown> = {},
  ): Promise<Response> {
    const metadata = { ...baseMetadata, ...metaExtra, error_code: code };
    try {
      await supabase
        .from("phone_sync_runs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          records_processed: recordsProcessed,
          error_message: message,
          metadata,
        })
        .eq("id", syncRunId);
    } catch (_e) {
      // ignore
    }
    await writeAudit("failed", { ...metadata, message });
    return failResponse(code, message, httpStatus, {
      sync_run_id: syncRunId,
      records_processed: recordsProcessed,
    });
  }

  // --- credentials ---------------------------------------------------------
  const creds = getSimwoodCredentials();
  if (!creds) {
    return await finishFailed("config_error", "Simwood credentials are not configured", 500, 0);
  }

  // --- resolve customer id -------------------------------------------------
  let customerId = suppliedCustomerId;
  if (!customerId) {
    const discovered = await discoverCustomerId(creds);
    if (!discovered.ok) {
      return await finishFailed(discovered.code, discovered.message, discovered.httpStatus, 0);
    }
    customerId = discovered.customerId;
  }

  // --- page through recordings and upsert (metadata only) -----------------
  const pageSize = limit && limit > 0 ? Math.min(PAGE_SIZE_MAX, limit) : PAGE_SIZE_MAX;
  let processed = 0;
  let skippedNoId = 0;
  let pagesFetched = 0;
  const referencedCallIds = new Set<string>();
  const newRecordingIds: string[] = [];

  for (let page = 1; page <= HARD_PAGE_CAP; page++) {
    const qs = new URLSearchParams({
      startedAfter: from,
      startedBefore: to,
      pageSize: String(pageSize),
      page: String(page),
    });
    if (callIdFilter) qs.set("callId", callIdFilter);
    if (linkedIdFilter) qs.set("linkedId", linkedIdFilter);

    const result = await simwoodGet(
      `/customers/${encodeURIComponent(customerId)}/recordings?${qs}`,
      creds,
    );
    if (!result.ok) {
      return await finishFailed(result.code, result.message, result.httpStatus, processed, {
        customer_id: customerId,
        pages_fetched: pagesFetched,
      });
    }
    pagesFetched++;

    const items = extractItems(result.data);
    if (items.length === 0) break;

    // Respect an explicit limit across pages.
    const room = limit && limit > 0 ? limit - processed : items.length;
    const slice = items.slice(0, Math.max(0, room));

    const rows = slice
      .map((c) => {
        const recordingId =
          c.id != null && String(c.id) !== "" ? String(c.id) : lastPathSegment(c.uri);
        return { c, recordingId };
      })
      .filter(({ recordingId }) => {
        if (!recordingId) skippedNoId++;
        return recordingId !== null;
      })
      .map(({ c, recordingId }) => {
        const providerCallId = c.callId != null ? String(c.callId) : null;
        if (providerCallId) referencedCallIds.add(providerCallId);
        return {
          tenant_id: tenantId,
          provider: PROVIDER,
          provider_recording_id: recordingId,
          provider_call_id: providerCallId,
          linked_id: c.linkedId != null ? String(c.linkedId) : null,
          recording_uri: c.uri != null ? String(c.uri) : null,
          file_size: toInt(c.size),
          started_at: toIso(c.started),
          duration_seconds: toInt(c.duration),
          // storage_path intentionally left null — no audio download in Phase-2.
          raw_payload: c,
        };
      });

    if (rows.length > 0) {
      // Which of these provider_recording_ids already existed? (to trigger the
      // pipeline for genuinely NEW recordings only — never historical ones).
      const providerIds = rows.map((r) => r.provider_recording_id);
      const { data: existingRows } = await supabase
        .from("phone_recordings")
        .select("provider_recording_id")
        .eq("tenant_id", tenantId)
        .eq("provider", PROVIDER)
        .in("provider_recording_id", providerIds);
      const existingSet = new Set((existingRows ?? []).map((r) => r.provider_recording_id));

      const { data: upserted, error: upsertErr } = await supabase
        .from("phone_recordings")
        .upsert(rows, { onConflict: "tenant_id,provider,provider_recording_id" })
        .select("id, provider_recording_id");
      if (upsertErr) {
        return await finishFailed(
          "db_error",
          `Failed to upsert recordings: ${upsertErr.message}`,
          500,
          processed,
          { customer_id: customerId, pages_fetched: pagesFetched },
        );
      }
      for (const u of upserted ?? []) {
        if (!existingSet.has(u.provider_recording_id)) newRecordingIds.push(u.id as string);
      }
      processed += rows.length;
    }

    // Stop conditions: hit the limit, or a short page (no more data).
    if (limit && limit > 0 && processed >= limit) break;
    if (items.length < pageSize) break;
  }

  // --- best-effort soft link check (never fails the sync) ------------------
  // Recordings carry provider_call_id/linked_id as the durable link. Here we
  // only *report* how many referenced calls already exist in phone_calls.
  let linkedCallsMatched: number | null = null;
  if (referencedCallIds.size > 0) {
    try {
      const { data: matches } = await supabase
        .from("phone_calls")
        .select("provider_call_id")
        .eq("tenant_id", tenantId)
        .eq("provider", PROVIDER)
        .in("provider_call_id", Array.from(referencedCallIds));
      linkedCallsMatched = matches ? matches.length : 0;
    } catch (_e) {
      linkedCallsMatched = null;
    }
  }

  // --- auto-process newly inserted recordings (background, isolated) -------
  const toTrigger = newRecordingIds.slice(0, MAX_AUTO_PIPELINE);
  if (toTrigger.length > 0) triggerPipelineBackground(tenantId, toTrigger, authToken);

  // --- success -------------------------------------------------------------
  const metadata = {
    ...baseMetadata,
    customer_id: customerId,
    pages_fetched: pagesFetched,
    skipped_no_recording_id: skippedNoId,
    call_ids_referenced: referencedCallIds.size,
    linked_calls_matched: linkedCallsMatched,
    new_recordings: newRecordingIds.length,
    auto_triggered: toTrigger.length,
  };
  await supabase
    .from("phone_sync_runs")
    .update({
      status: "success",
      completed_at: new Date().toISOString(),
      records_processed: processed,
      metadata,
    })
    .eq("id", syncRunId);
  await writeAudit("success", metadata);

  return jsonResponse({
    success: true,
    provider: PROVIDER,
    records_processed: processed,
    from,
    to,
    customer_id: customerId,
    sync_run_id: syncRunId,
  });
});
