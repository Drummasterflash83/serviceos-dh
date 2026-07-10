// ServiceOS — Edge Function: phone-process-pending (thin wrapper).
//
// Business/orchestration logic lives in the shared handler (_shared/
// worker_handlers/phone_process_pending.ts). This wrapper keeps ONLY: CORS,
// request parsing, auth + role + tenant validation, the platform_jobs lifecycle,
// and HTTP response formatting. The platform-worker calls the SAME handler
// directly (no worker→pending HTTP hop). The handler still chains to
// phone-process-pipeline per recording — see its header for why.
//
// Request body: { tenant_id?: uuid, limit?: number } → per-stage counts. Runtime: Deno.

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
import { handlePhoneProcessPending } from "../_shared/worker_handlers/phone_process_pending.ts";

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

  const job = await createPlatformJob(supabase, {
    tenantId,
    connectorId: "simwood",
    moduleId: "communications.phone",
    jobType: "phone.process_pending",
    jobKey: `phone.process_pending:${tenantId}`,
    payload: { limit: typeof body.limit === "number" ? body.limit : null },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(supabase, jobId);

  const res = await handlePhoneProcessPending({
    supabaseAdmin: supabase,
    tenantId,
    jobId,
    payload: body as Record<string, unknown>,
  });

  if (res.result) {
    if (jobId) {
      await completePlatformJob(supabase, jobId, {
        recordsProcessed: res.recordsProcessed ?? 0,
        result: res.result,
      });
    }
    return jsonResponse({ success: res.success, ...res.result });
  }
  const message = res.error?.message ?? "process-pending failed";
  if (jobId) await failPlatformJob(supabase, jobId, message);
  return failResponse(res.error?.code ?? "process_error", message, 500);
});
