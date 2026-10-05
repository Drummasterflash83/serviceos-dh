// ServiceOS — Edge Function: customer-card-sync (thin wrapper).
//
// Business logic lives in the shared handler (_shared/worker_handlers/
// customer_card_sync.ts). This wrapper keeps ONLY: CORS, request parsing, auth +
// role + tenant validation, the platform_jobs lifecycle, and HTTP response
// formatting. The platform-worker calls the SAME handler directly (no HTTP).
//
// Request body: { customer_card_id?: uuid, graph_node_id?: uuid, limit?: number }
// Runtime: Deno.

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
import { handleCustomerCardSync } from "../_shared/worker_handlers/customer_card_sync.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let body: {
    customer_card_id?: unknown;
    graph_node_id?: unknown;
    limit?: unknown;
    tenant_id?: unknown;
  } = {};
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

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.customer_card",
    jobType: "customer_card.sync",
    jobKey: `customer_card.sync:${tenantId}`,
    payload: { limit: typeof body.limit === "number" ? body.limit : null },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  const res = await handleCustomerCardSync({
    supabaseAdmin: admin,
    tenantId,
    jobId,
    payload: body as Record<string, unknown>,
  });

  if (res.result) {
    if (jobId) {
      await completePlatformJob(admin, jobId, {
        recordsProcessed: res.recordsProcessed ?? 0,
        result: res.result,
      });
    }
    return jsonResponse({ success: res.success, ...res.result });
  }
  const message = res.error?.message ?? "customer-card-sync failed";
  if (jobId) await failPlatformJob(admin, jobId, message);
  return failResponse(res.error?.code ?? "card_sync_error", message, 500);
});
