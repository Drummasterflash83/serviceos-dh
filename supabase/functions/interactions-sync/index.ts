// ServiceOS — Edge Function: interactions-sync (thin wrapper).
//
// Business logic lives in the shared handler (_shared/worker_handlers/
// interactions_sync.ts). This wrapper keeps ONLY: CORS, request parsing, auth +
// role + tenant validation, the platform_jobs lifecycle, and HTTP response
// formatting. The platform-worker calls the SAME handler directly (no HTTP).
//
// Request body: { source?: "phone" | "email" | "all", limit?: number, since?: string }
// Runtime: Deno.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";
import { handleInteractionsSync } from "../_shared/worker_handlers/interactions_sync.ts";

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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // Tenant-bound authz — owner/admin/ops only; tenant comes from the profile.
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: { source?: string; limit?: number; since?: string } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  const source = body.source === "phone" || body.source === "email" ? body.source : "all";

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.interactions",
    jobType: "interactions.sync",
    jobKey: `interactions.sync:${tenantId}:${source}`,
    payload: { source, limit: body.limit ?? null, since: body.since ?? null },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  const res = await handleInteractionsSync({
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
    return json({ success: res.success, ...res.result });
  }
  const message = res.error?.message ?? "interactions sync failed";
  if (jobId) await failPlatformJob(admin, jobId, message);
  return fail(res.error?.code ?? "sync_error", message, 500);
});
