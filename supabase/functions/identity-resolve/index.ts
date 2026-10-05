// ServiceOS — Edge Function: identity-resolve (thin wrapper).
//
// Business logic lives in the shared handler (_shared/worker_handlers/
// identity_resolve.ts). This wrapper keeps ONLY: CORS, request parsing, auth +
// role + tenant validation, the platform_jobs lifecycle, and HTTP response
// formatting. The platform-worker calls the SAME handler directly (no HTTP).
//
// Request body: { limit?: number }. Runtime: Deno.

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";
import { handleIdentityResolve } from "../_shared/worker_handlers/identity_resolve.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  const admin = createSupabaseAdmin();
  if (!admin) return failResponse("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: { limit?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.identity",
    jobType: "identity.resolve",
    jobKey: `identity.resolve:${tenantId}`,
    payload: { limit: typeof body.limit === "number" ? body.limit : null },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  const res = await handleIdentityResolve({
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
  const message = res.error?.message ?? "identity-resolve failed";
  if (jobId) await failPlatformJob(admin, jobId, message);
  return failResponse(res.error?.code ?? "resolve_error", message, 500);
});
