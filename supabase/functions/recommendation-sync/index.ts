// ServiceOS — Edge Function: recommendation-sync (thin wrapper).
//
// Business logic lives in the shared handler (_shared/worker_handlers/
// recommendation_sync.ts). This wrapper keeps ONLY: CORS, request parsing, auth +
// role + tenant validation, the platform_jobs lifecycle, and HTTP response
// formatting. The platform-worker calls the SAME handler directly (no HTTP).
//
// Deterministic, rule-based — no AI. Runtime: Deno.
//
// Request body: { customer_card_id?: uuid, limit?: number }

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";
import { handleRecommendationSync } from "../_shared/worker_handlers/recommendation_sync.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let body: { customer_card_id?: unknown; limit?: unknown; tenant_id?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }

  const admin = createSupabaseAdmin();
  if (!admin) return failResponse("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // Manual path owns its own platform_jobs row — but the active-job_key unique
  // index dedups against a live queue job, so no duplicate row is ever created.
  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.recommendations",
    jobType: "recommendation.sync",
    jobKey: `recommendation.sync:${tenantId}`,
    payload: { limit: typeof body.limit === "number" ? body.limit : null },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  const res = await handleRecommendationSync({
    supabaseAdmin: admin,
    tenantId,
    jobId,
    payload: body as Record<string, unknown>,
  });

  // A result means the batch ran (possibly with per-card failures) → complete +
  // 200. No result means a hard failure → fail the job + error response.
  if (res.result) {
    if (jobId) {
      await completePlatformJob(admin, jobId, {
        recordsProcessed: res.recordsProcessed ?? 0,
        result: res.result,
      });
    }
    return jsonResponse({ success: res.success, ...res.result });
  }
  const message = res.error?.message ?? "recommendation-sync failed";
  if (jobId) await failPlatformJob(admin, jobId, message);
  return failResponse(res.error?.code ?? "recommendation_sync_error", message, 500);
});
