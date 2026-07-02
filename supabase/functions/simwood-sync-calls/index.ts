// ServiceOS — Edge Function: simwood-sync-calls (Phase Phone-1)
//
// Ingests Simwood/Sipcentric call history (CDRs) into the phone_calls table.
// Idempotent: upserts on (tenant_id, provider, provider_call_id) so re-running
// never duplicates a call. Every attempt is recorded in phone_sync_runs and
// mirrored to audit_logs.
//
// Scope (Phase-1): call history ONLY. No recordings, audio, transcription or
// AI enrichment. Runtime: Supabase Edge Functions (Deno); URL imports only.
//
// Request body:
//   {
//     "tenant_id": "uuid",                 // required
//     "provider_customer_id": "string?",   // optional; discovered if omitted
//     "from": "ISO date?",                 // optional; defaults to now-24h
//     "to": "ISO date?",                   // optional; defaults to now
//     "direction": "inbound|outbound?",    // optional
//     "limit": number?                     // optional; max records to process
//   }
//
// NOTE: the request's `from`/`to` are the DATE WINDOW and map to the API's
// `startedAfter`/`startedBefore`. They are NOT the API's `from`/`to` params
// (which are phone-number filters) — those are intentionally not used here.

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
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";

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

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Map request direction ("inbound"/"outbound") to the API's IN/OUT. */
function apiDirection(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  const v = String(value).toLowerCase();
  if (v === "inbound" || v === "in") return { ok: true, value: "IN" };
  if (v === "outbound" || v === "out") return { ok: true, value: "OUT" };
  return { ok: false };
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

  const direction = apiDirection(body.direction);
  if (!direction.ok) {
    return failResponse("invalid_direction", "direction must be 'inbound' or 'outbound'", 400);
  }

  const limit = toInt(body.limit);
  if (body.limit !== undefined && (limit === null || limit <= 0)) {
    return failResponse("invalid_limit", "limit must be a positive number", 400);
  }

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

  const suppliedCustomerId =
    typeof body.provider_customer_id === "string" && body.provider_customer_id.trim() !== ""
      ? body.provider_customer_id.trim()
      : null;

  const baseMetadata: Record<string, unknown> = {
    from,
    to,
    direction: direction.value,
    limit,
    provider_customer_id_supplied: suppliedCustomerId !== null,
  };

  // Open a sync run (status running) so even a mid-run failure is auditable.
  const { data: runRow, error: runErr } = await supabase
    .from("phone_sync_runs")
    .insert({
      tenant_id: tenantId,
      provider: PROVIDER,
      sync_type: "calls",
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
        actor: "edge:simwood-sync-calls",
        action: "simwood.sync_calls",
        resource_type: "phone_calls",
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

  // --- page through calls and upsert --------------------------------------
  const pageSize = limit && limit > 0 ? Math.min(PAGE_SIZE_MAX, limit) : PAGE_SIZE_MAX;
  let processed = 0;
  let skippedNoId = 0;
  let pagesFetched = 0;

  for (let page = 1; page <= HARD_PAGE_CAP; page++) {
    const qs = new URLSearchParams({
      startedAfter: from,
      startedBefore: to,
      includeLocal: "false",
      pageSize: String(pageSize),
      page: String(page),
    });
    if (direction.value) qs.set("direction", direction.value);

    const result = await simwoodGet(
      `/customers/${encodeURIComponent(customerId)}/calls?${qs}`,
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
      .filter((c) => {
        const hasId = c.callId !== undefined && c.callId !== null && String(c.callId) !== "";
        if (!hasId) skippedNoId++;
        return hasId;
      })
      .map((c) => ({
        tenant_id: tenantId,
        provider: PROVIDER,
        provider_call_id: String(c.callId),
        linked_id: c.linkedId != null ? String(c.linkedId) : null,
        direction: c.direction != null ? String(c.direction) : null,
        from_number: c.from != null ? String(c.from) : null,
        to_number: c.to != null ? String(c.to) : null,
        started_at: toIso(c.callStarted),
        duration_seconds: toInt(c.duration),
        outcome: c.outcome != null ? String(c.outcome) : null,
        cost: toNumber(c.cost),
        raw_payload: c,
      }));

    if (rows.length > 0) {
      const { error: upsertErr } = await supabase
        .from("phone_calls")
        .upsert(rows, { onConflict: "tenant_id,provider,provider_call_id" });
      if (upsertErr) {
        return await finishFailed(
          "db_error",
          `Failed to upsert calls: ${upsertErr.message}`,
          500,
          processed,
          {
            customer_id: customerId,
            pages_fetched: pagesFetched,
          },
        );
      }
      processed += rows.length;
    }

    // Stop conditions: hit the limit, or a short page (no more data).
    if (limit && limit > 0 && processed >= limit) break;
    if (items.length < pageSize) break;
  }

  // --- success -------------------------------------------------------------
  const metadata = {
    ...baseMetadata,
    customer_id: customerId,
    pages_fetched: pagesFetched,
    skipped_no_call_id: skippedNoId,
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
