// ServiceOS — Edge Function: live-call-session-update (Live Call Card v1)
//
// The Live Call Card's confirm/reject/dismiss actions. User session auth; tenant
// bound server-side; the session must belong to the caller's tenant. Service-role
// writes (frontend has SELECT-only RLS). v1 keeps it to safe state changes — no
// CRM merge, no silent linking.
//
// Actions:
//   { action: "confirm", session_id }  → match_status = 'confirmed'
//   { action: "reject",  session_id }  → match_status = 'rejected'
//   { action: "dismiss", session_id }  → dismissed_at = now
//
// Runtime: Supabase Edge Functions (Deno). No new dependencies. No secret logging.

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
  isUuid,
} from "../_shared/simwood.ts";
import { requireTenantUser } from "../_shared/authz.ts";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  const admin = createSupabaseAdmin();
  if (!admin) return failResponse("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const tenantId = auth.ctx.tenantId;

  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return failResponse("invalid_json", "Body must be JSON", 400);
  }

  const sessionId = body.session_id;
  if (!isUuid(sessionId))
    return failResponse("invalid_session_id", "session_id must be a UUID", 400);
  const action = typeof body.action === "string" ? body.action : "";

  const patch: Record<string, unknown> = {};
  if (action === "confirm") patch.match_status = "confirmed";
  else if (action === "reject") patch.match_status = "rejected";
  else if (action === "dismiss") patch.dismissed_at = new Date().toISOString();
  else return failResponse("invalid_action", `Unknown action: ${action}`, 400);

  const { data, error } = await admin
    .from("live_call_sessions")
    .update(patch)
    .eq("id", sessionId as string)
    .eq("tenant_id", tenantId) // tenant-scoped: cannot touch another tenant's call
    .select("id")
    .maybeSingle();
  if (error) return failResponse("db_error", error.message, 500);
  if (!data) return failResponse("not_found", "Session not found for this tenant", 404);

  return jsonResponse({ success: true, id: data.id });
});
