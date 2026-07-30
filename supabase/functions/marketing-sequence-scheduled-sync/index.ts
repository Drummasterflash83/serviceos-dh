// ServiceOS — Edge Function: marketing-sequence-scheduled-sync (Phase 6).
//
// The sequence heartbeat. Every minute (only once an operator installs the
// cron via serviceos_schedule_all() with MARKETING_SEQUENCE_SECRET configured)
// it DISCOVERS tenants with due sequence work and enqueues the bounded
// marketing.sequence_advance platform job for each.
//
// It NEVER sends email, renders content, evaluates policy or touches an
// enrolment itself — the platform worker owns all of that through the governed
// SQL RPCs. Discovery and execution are deliberately separate.
//
// Auth: NOT a user session. A shared secret header `x-schedule-secret` must
// match MARKETING_SEQUENCE_SECRET, else 403 (the same model as every other
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

  const expected = Deno.env.get("MARKETING_SEQUENCE_SECRET");
  if (!expected) {
    return fail("config_error", "MARKETING_SEQUENCE_SECRET is not configured", 500);
  }
  const provided = req.headers.get("x-schedule-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-schedule-secret", 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fail("config_error", "service env missing", 500);
  const admin = createClient(supabaseUrl, serviceKey);

  // 1) which tenants have due sequence work (bounded, read-only)
  const due = await admin.rpc("marketing_sequence_due", { p_limit: 200 });
  if (due.error) return fail("due_failed", due.error.message.slice(0, 200), 500);
  const rows = (due.data ?? []) as { tenant_id: string; due_enrolments: number }[];
  const tenantIds = new Set<string>(rows.map((r) => r.tenant_id));

  // 2) tenants whose only remaining work is a QUEUED step (a lost execution
  //    enqueue) still need the worker: its repair sweep is what recovers them
  const { data: stuck, error: sErr } = await admin
    .from("marketing_sequence_executions")
    .select("tenant_id")
    .eq("status", "queued")
    .limit(500);
  if (sErr) return fail("scan_failed", sErr.message.slice(0, 200), 500);
  for (const row of stuck ?? []) tenantIds.add(row.tenant_id as string);

  let enqueued = 0;
  for (const tenantId of tenantIds) {
    const r = await enqueueJob(admin, {
      tenantId,
      jobType: "marketing.sequence_advance",
      jobKey: `marketing.sequence_advance:${tenantId}`,
      moduleId: "marketing.sequences",
      payload: {},
    });
    if (r.id && !r.duplicate) enqueued += 1;
  }

  return json({
    success: true,
    tenants_with_due_work: rows.length,
    tenants_driven: tenantIds.size,
    jobs_enqueued: enqueued,
  });
});
