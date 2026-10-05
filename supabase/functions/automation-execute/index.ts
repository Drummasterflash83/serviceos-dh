// ServiceOS — Edge Function: automation-execute (thin wrapper).
//
// Manual / operator trigger for the Universal Automation Engine, for controlled
// testing and operations. Business logic lives in the shared handler
// (_shared/worker_handlers/automation_execute.ts); the platform-worker calls the
// SAME handler for the async path. This wrapper keeps ONLY CORS, parsing, tenant-bound
// authz, the platform_jobs lifecycle and HTTP formatting. It accepts ONLY an intent id
// + controlled trigger metadata — it CANNOT alter immutable intent parameters, override
// authority, or bypass Operational Mode / approval (the handler re-guards everything).
//
// Request body: { automation_intent_id: string, triggered_by?: string, correlation_id?: string }
// Runtime: Deno.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";
import { handleAutomationExecute } from "../_shared/worker_handlers/automation_execute.ts";

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

  // Tenant-bound authz — owner/admin/ops only; tenant from the profile, NEVER the body.
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (!isUuid(body.automation_intent_id)) {
    return fail("invalid_input", "automation_intent_id must be a uuid", 400);
  }
  const intentId = body.automation_intent_id as string;
  const correlationId = isUuid(body.correlation_id) ? (body.correlation_id as string) : null;

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.automation",
    jobType: "automation.execute",
    jobKey: `automation.execute:${tenantId}:${intentId}`,
    payload: {
      automation_intent_id: intentId,
      triggered_by: "manual",
      ...(correlationId ? { correlation_id: correlationId } : {}),
    },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  const res = await handleAutomationExecute({
    supabaseAdmin: admin,
    tenantId,
    jobId,
    payload: {
      automation_intent_id: intentId,
      triggered_by: "manual",
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
  const message = res.error?.message ?? "automation execution failed";
  if (jobId) await failPlatformJob(admin, jobId, message);
  return fail(res.error?.code ?? "execution_error", message, 500);
});
