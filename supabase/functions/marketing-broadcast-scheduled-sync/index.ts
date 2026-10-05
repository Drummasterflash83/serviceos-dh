// ServiceOS — Edge Function: marketing-broadcast-scheduled-sync (Phase 5).
//
// The broadcast heartbeat. Every minute (when the operator installs the cron
// via serviceos_schedule_all() with MARKETING_BROADCAST_SECRET configured) it:
//   1. DISCOVERS due scheduled campaigns (marketing_broadcast_due — a guarded
//      SQL transition scheduled → active + idempotent dispatch
//      materialisation, FOR UPDATE SKIP LOCKED so concurrent ticks are safe);
//   2. enqueues the bounded marketing.broadcast_dispatch platform job for
//      every tenant with an ACTIVE campaign that still has pending
//      recipients (this is also what resumes work after quiet hours, a
//      pause → resume, or a crashed worker lease).
//
// It NEVER sends email, renders content, or touches a recipient itself — the
// platform worker owns all of that through the governed SQL RPCs.
//
// Auth: NOT a user session. A shared secret header `x-schedule-secret` must
// match MARKETING_BROADCAST_SECRET, else 403 (same model as every other
// scheduled sync). No secrets are logged. Deploy with verify_jwt=false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { enqueueJob } from "../_shared/platform_queue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-schedule-secret",
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

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const expected = Deno.env.get("MARKETING_BROADCAST_SECRET");
  if (!expected) {
    return fail("config_error", "MARKETING_BROADCAST_SECRET is not configured", 500);
  }
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fail("config_error", "service env missing", 500);
  const admin = createClient(supabaseUrl, serviceKey);

  // 1) due scheduled campaigns → active (guarded, idempotent)
  const due = await admin.rpc("marketing_broadcast_due", { p_limit: 20 });
  if (due.error) return fail("due_failed", due.error.message.slice(0, 200), 500);
  const activated = (due.data ?? []) as { tenant_id: string; campaign_id: string }[];

  // 2) drive the dispatch worker for every tenant with claimable work.
  //    'queued' counts too: a recipient whose lineage committed but whose
  //    execution enqueue was lost to a crash is only ever recovered by the
  //    worker's repair sweep, and no claim query would surface it.
  const { data: tenants, error: tErr } = await admin
    .from("marketing_broadcast_dispatches")
    .select("tenant_id, marketing_campaigns!inner(status)")
    .in("status", ["pending", "queued"])
    .eq("marketing_campaigns.status", "active")
    .limit(500);
  if (tErr) return fail("scan_failed", tErr.message.slice(0, 200), 500);
  const tenantIds = new Set<string>((tenants ?? []).map((r) => r.tenant_id as string));
  for (const a of activated) tenantIds.add(a.tenant_id);

  let enqueued = 0;
  for (const tenantId of tenantIds) {
    const r = await enqueueJob(admin, {
      tenantId,
      jobType: "marketing.broadcast_dispatch",
      jobKey: `marketing.broadcast_dispatch:${tenantId}`,
      moduleId: "marketing.campaigns",
      payload: {},
    });
    if (r.id && !r.duplicate) enqueued += 1;
    // keep the reconciler current for in-flight deliveries too
    await enqueueJob(admin, {
      tenantId,
      jobType: "marketing.delivery_sync",
      jobKey: `marketing.delivery_sync:${tenantId}`,
      moduleId: "marketing.senders",
      payload: { ttl: 30 },
    });
  }

  return json({
    success: true,
    activated: activated.length,
    tenants_with_pending: tenantIds.size,
    dispatch_jobs_enqueued: enqueued,
  });
});
