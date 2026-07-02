// ServiceOS — Edge Function: phone-pipeline-status (Phase 5A)
//
// Read-only pipeline diagnostics counts for the Admin console. Uses the
// service-role key so it can read the RLS-protected phone_* tables (the browser
// anon key cannot). No writes. Runtime: Deno.
//
// Request body: { tenant_id: uuid }
// Returns: { success, pending, processing, failed, completed, recordings_total }
//
// Definitions (approximate but real — no fabricated data):
//   completed  = recordings with an AI insight (fully enriched)
//   processing = pipeline sync runs currently running
//   failed     = pipeline sync runs that failed
//   pending    = recordings_total − completed − processing (clamped ≥ 0)

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return failResponse("invalid_json", "Request body must be valid JSON", 400);
  }
  const body = (parsed ?? {}) as Record<string, unknown>;

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return failResponse("config_error", "Supabase admin client is not configured", 500);
  }

  // --- authz: bind tenant server-side (diagnostics ⇒ owner/admin/ops) ------
  const auth = await requireTenantUser(req, supabase, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  async function countRecordings(): Promise<number> {
    const { count } = await supabase
      .from("phone_recordings")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    return count ?? 0;
  }
  async function countInsights(): Promise<number> {
    const { count } = await supabase
      .from("phone_ai_insights")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    return count ?? 0;
  }
  async function countPipelineRuns(status: string): Promise<number> {
    const { count } = await supabase
      .from("phone_sync_runs")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("sync_type", "pipeline")
      .eq("status", status);
    return count ?? 0;
  }

  const recordingsTotal = await countRecordings();
  const completed = await countInsights();
  const processing = await countPipelineRuns("running");
  const failed = await countPipelineRuns("failed");
  const pending = Math.max(0, recordingsTotal - completed - processing);

  return jsonResponse({
    success: true,
    pending,
    processing,
    failed,
    completed,
    recordings_total: recordingsTotal,
  });
});
