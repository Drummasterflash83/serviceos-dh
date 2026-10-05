// ServiceOS — Edge Function: voice-endpoints-manage (Live Call Card v1)
//
// Owner/admin/ops manage the user ↔ VoIP-extension mapping (Mary → 102) that the
// webhook uses to assign live calls to the right person. User session auth; tenant
// bound server-side (never trusted from the client). Service-role writes.
//
// Actions:
//   { action: "upsert", extension, user_id? | email?, display_name?, enabled?, provider? }
//   { action: "disable", id }
//
// Runtime: Supabase Edge Functions (Deno). No new dependencies. No secret logging.

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
  PROVIDER,
} from "../_shared/simwood.ts";
import { requireTenantUser } from "../_shared/authz.ts";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

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
  const action = str(body.action) ?? "upsert";
  const provider = str(body.provider) ?? PROVIDER;

  if (action === "disable") {
    const id = str(body.id);
    if (!id) return failResponse("invalid_id", "id is required", 400);
    const { error } = await admin
      .from("user_voice_endpoints")
      .update({ enabled: false })
      .eq("id", id)
      .eq("tenant_id", tenantId); // tenant-scoped: cannot touch another tenant
    if (error) return failResponse("db_error", error.message, 500);
    return jsonResponse({ success: true });
  }

  if (action !== "upsert") return failResponse("invalid_action", `Unknown action: ${action}`, 400);

  const extension = str(body.extension);
  if (!extension) return failResponse("invalid_extension", "extension is required", 400);

  // Resolve the target user: explicit user_id, else an email within this tenant.
  let userId = str(body.user_id);
  if (!userId) {
    const email = str(body.email);
    if (!email) return failResponse("invalid_user", "user_id or email is required", 400);
    const { data: profile } = await admin
      .from("profiles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .maybeSingle();
    userId = (profile?.id as string | undefined) ?? null;
    if (!userId)
      return failResponse("user_not_found", "No user with that email in this tenant", 404);
  }

  const enabled = body.enabled === undefined ? true : body.enabled === true;
  const row = {
    tenant_id: tenantId,
    user_id: userId,
    provider,
    extension,
    display_name: str(body.display_name),
    enabled,
  };
  const { data, error } = await admin
    .from("user_voice_endpoints")
    .upsert(row, { onConflict: "tenant_id,provider,extension" })
    .select("id")
    .single();
  if (error) return failResponse("db_error", error.message, 500);
  return jsonResponse({ success: true, id: data?.id ?? null });
});
