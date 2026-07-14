// ServiceOS — Edge Function: objective-evaluate (thin wrapper).
//
// Manual / operator trigger for Objective Health evaluation. Business logic lives
// in the shared handler (_shared/worker_handlers/objective_evaluate.ts); the
// platform-worker calls the SAME handler directly (no HTTP) for the async path.
// This wrapper keeps ONLY: CORS, parsing, tenant-bound authz, the platform_jobs
// lifecycle and HTTP formatting. The objective must belong to the caller's tenant
// (the handler enforces it too — defence in depth).
//
// Request body: { objective_id: string, triggered_by?: string, force?: boolean,
//                 correlation_id?: string, evaluated_at?: string }
// Runtime: Deno.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";
import { handleObjectiveEvaluate } from "../_shared/worker_handlers/objective_evaluate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}
function fail(code: string, message: string, status: number): Response {
  return json({ success: false, error: { code, message } }, status);
}
function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // Tenant-bound authz — owner/admin/ops only; tenant comes from the profile,
  // NEVER from the request body.
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!isUuid(body.objective_id)) {
    return fail("invalid_input", "objective_id must be a uuid", 400);
  }
  const objectiveId = body.objective_id as string;
  const force = body.force === true;
  const correlationId = isUuid(body.correlation_id) ? (body.correlation_id as string) : null;
  // A manual invocation is 'manual' unless a caller passes 'backfill'.
  const triggeredBy = body.triggered_by === "backfill" ? "backfill" : "manual";
  // Forced runs must not collapse against a pending eval — the nonce distinguishes.
  const nonce = force ? (correlationId ?? new Date().toISOString()) : null;
  const jobKey = nonce
    ? `objective.evaluate:${tenantId}:${objectiveId}:${nonce}`
    : `objective.evaluate:${tenantId}:${objectiveId}`;

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.objectives",
    jobType: "objective.evaluate",
    jobKey,
    payload: {
      objective_id: objectiveId,
      triggered_by: triggeredBy,
      ...(force ? { force: true, nonce } : {}),
      ...(correlationId ? { correlation_id: correlationId } : {}),
    },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  const res = await handleObjectiveEvaluate({
    supabaseAdmin: admin,
    tenantId,
    jobId,
    payload: {
      objective_id: objectiveId,
      triggered_by: triggeredBy,
      ...(force ? { force: true, nonce } : {}),
      ...(correlationId ? { correlation_id: correlationId } : {}),
    },
  });

  if (res.result) {
    if (jobId) {
      await completePlatformJob(admin, jobId, {
        recordsProcessed: res.recordsProcessed ?? 0,
        result: res.result,
      });
    }
    return json({ success: res.success, ...res.result });
  }
  const message = res.error?.message ?? "objective evaluation failed";
  if (jobId) await failPlatformJob(admin, jobId, message);
  return fail(res.error?.code ?? "evaluation_error", message, 500);
});
