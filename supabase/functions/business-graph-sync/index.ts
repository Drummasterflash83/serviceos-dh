// ServiceOS — Edge Function: business-graph-sync (thin wrapper).
//
// Business logic lives in the shared handler (_shared/worker_handlers/
// business_graph_sync.ts). This wrapper keeps ONLY: CORS, request parsing, auth +
// role + tenant validation, the platform_jobs lifecycle, and HTTP response
// formatting. The platform-worker calls the SAME handler directly (no HTTP).
//
// Request body: { source?: "interaction" | "identity" | "all", limit?: number }
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
import { handleBusinessGraphSync } from "../_shared/worker_handlers/business_graph_sync.ts";
import { enqueueJob } from "../_shared/platform_queue.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let body: { source?: unknown; limit?: unknown; tenant_id?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }
  const source = body.source === "interaction" || body.source === "identity" ? body.source : "all";

  const admin = createSupabaseAdmin();
  if (!admin) return failResponse("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  // Internal notifications only request a refresh. Run the graph through the
  // leased queue, where an interrupted edge invocation can be reclaimed.
  if (auth.ctx.userId === "service") {
    const queued = await enqueueJob(admin, {
      tenantId,
      connectorId: "openfolk-core",
      moduleId: "core.graph",
      jobType: "graph.sync",
      jobKey: `graph.sync:${tenantId}`,
      payload: { source, limit: typeof body.limit === "number" ? body.limit : null },
    });
    if (!queued.id)
      return failResponse("graph_enqueue_unconfirmed", "Graph refresh could not be queued.", 503);
    return jsonResponse({ success: true, queued: !queued.duplicate, job_id: queued.id });
  }

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.graph",
    jobType: "graph.sync",
    jobKey: `graph.sync:${tenantId}`,
    payload: { source, limit: typeof body.limit === "number" ? body.limit : null },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  if (!job.id)
    return failResponse("graph_job_unconfirmed", "Graph refresh could not be tracked.", 503);
  if (job.duplicate)
    return jsonResponse({ success: true, queued: true, duplicate: true, job_id: job.id });
  const jobId = job.id;
  if (!(await startPlatformJob(admin, jobId, 1800)))
    return failResponse(
      "graph_claim_unconfirmed",
      "Graph refresh claim could not be confirmed.",
      503,
    );

  const res = await handleBusinessGraphSync({
    supabaseAdmin: admin,
    tenantId,
    jobId,
    payload: body as Record<string, unknown>,
  });

  if (res.success && res.result) {
    await completePlatformJob(admin, jobId, {
      recordsProcessed: res.recordsProcessed ?? 0,
      result: res.result,
    });
    return jsonResponse({ success: true, ...res.result });
  }
  const message = res.error?.message ?? "business-graph-sync failed";
  await failPlatformJob(admin, jobId, message, res.result);
  return failResponse(res.error?.code ?? "graph_sync_error", message, 500);
});
