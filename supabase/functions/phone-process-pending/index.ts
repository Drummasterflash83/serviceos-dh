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
import { createPlatformJob } from "../_shared/platform_jobs.ts";
import {
  claimManualPhoneJob,
  settlePhoneJob,
  phoneJobUnconfirmed,
} from "../_shared/phone-recovery-job.ts";
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
  if (job.duplicate)
    return failResponse(
      "phone_processing_active",
      "Phone processing is already queued or running. Its progress is available in Operations.",
      409,
    );
  if (!job.id)
    return failResponse(
      "phone_job_unconfirmed",
      "Phone processing could not be queued. No processing was started by this request.",
      503,
    );
  const owner = await claimManualPhoneJob(
    supabase,
    tenantId,
    job.id,
    `phone-manual:${crypto.randomUUID()}`,
  );
  if (!owner) {
    const error = phoneJobUnconfirmed().error!;
    return failResponse(error.code, error.message, 503);
  }
  const jobId = owner.jobId;

  const res = await handlePhoneProcessPending({
    supabaseAdmin: supabase,
    tenantId,
    jobId,
    claim: owner.claim,
    payload: body as Record<string, unknown>,
  });

  const outcome = await settlePhoneJob(supabase, owner, res);
  if (outcome === "unconfirmed") {
    const error = phoneJobUnconfirmed().error!;
    return failResponse(error.code, error.message, 503, { job_id: jobId });
  }
  if (res.result) return jsonResponse({ success: res.success, ...res.result, job_id: jobId });
  return failResponse(
    res.error?.code ?? "process_error",
    res.error?.message ?? "Phone processing did not complete.",
    503,
    { job_id: jobId },
  );
});
