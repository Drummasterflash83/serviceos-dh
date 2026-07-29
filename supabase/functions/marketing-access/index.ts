// ServiceOS — Edge Function: marketing-access (TENANT-facing, governed, fail-closed).
//
// The single server-side authority for "can this user use Marketing, and how".
// It is a THIN shell over the CANONICAL database resolver — permission logic
// lives in SQL (`marketing_effective_permissions`, shared with RLS) and tenant
// bootstrap lives in the service-role-only RPC `marketing_materialise_defaults`.
// This function never re-implements either.
//
// Fail-closed contract (hardening pass, see IMPLEMENTATION_LEDGER):
//  - Effective permissions are resolved BEFORE anything is returned or created.
//  - Every query result is checked; any resolver/config read error → HTTP 500
//    with NO access granted and NO role-default fallback.
//  - A caller without `marketing.view` receives ONLY the minimal verdict
//    { can_view:false, reason } — no settings, stages, grants, role or
//    permission details.
//  - Merely checking access NEVER mutates tenant configuration: materialisation
//    runs only for owner/admin callers (the roles that manage settings), via the
//    governed RPC, and only when settings are absent.
//  - Audits: materialisation success, denied access, and fail-closed errors —
//    tenant/actor identifiers only, never PII payloads or secrets.
//
// Deploy with verify_jwt=false (auth enforced via requireTenantUser).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...cors, "content-type": "application/json" },
  });
const fail = (code: string, message: string, s: number) =>
  json({ ok: false, error: { code, message } }, s);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  // Any authenticated tenant user may ASK about their own marketing access.
  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, role, userId, email } = auth.ctx;
  const actor = email ?? userId;

  // The internal service path (service-role bearer) has no profile row; it is
  // already inside the trust boundary and needs no per-user verdict.
  if (userId === "service") {
    return fail("not_applicable", "marketing-access is a user-facing endpoint", 400);
  }

  // ── 1) Resolve effective permissions FIRST, via the canonical DB resolver. ──
  const resolved = await admin.rpc("marketing_effective_permissions", {
    p_profile_id: userId,
  });
  if (resolved.error || !resolved.data || typeof resolved.data !== "object") {
    await writeAudit(admin, {
      tenantId,
      actor,
      action: "marketing.access.resolve_failed",
      resourceType: "marketing_settings",
      status: "error",
      detail: { code: resolved.error?.code ?? "empty_result" },
    });
    return fail("access_resolution_failed", "Could not resolve Marketing access", 500);
  }
  const verdict = resolved.data as Row;
  const permissions: string[] = Array.isArray(verdict.permissions) ? verdict.permissions : [];
  const enabled = verdict.enabled === true;
  const canView = enabled && permissions.includes("marketing.view");

  // ── 2) Denied: minimal verdict only — no settings, stages, role or grants. ──
  if (!canView) {
    await writeAudit(admin, {
      tenantId,
      actor,
      action: "marketing.access.denied",
      resourceType: "marketing_settings",
      status: "denied",
      detail: { reason: enabled ? "no_permission" : "not_enabled" },
    });
    return json({
      ok: true,
      data: { can_view: false, reason: enabled ? "no_permission" : "not_enabled" },
    });
  }

  try {
    // ── 3) Governed materialisation: owner/admin only, only when absent. ──
    let materialised: Row | null = null;
    if (!verdict.settings_exists && (role === "owner" || role === "admin")) {
      const mat = await admin.rpc("marketing_materialise_defaults", {
        p_tenant: tenantId,
        p_actor: userId,
      });
      if (mat.error) {
        await writeAudit(admin, {
          tenantId,
          actor,
          action: "marketing.defaults.materialise_failed",
          resourceType: "marketing_settings",
          status: "error",
          detail: { code: mat.error.code ?? "rpc_error" },
        });
        return fail("materialise_failed", "Could not initialise Marketing defaults", 500);
      }
      materialised = (mat.data as Row) ?? null;
      // The RPC writes its own audit_logs row on success.
    }

    // ── 4) Settings read — errors fail closed (never report enabled on failure). ──
    const settingsRes = await admin
      .from("marketing_settings")
      .select(
        "id, include_all_discovered, default_relationship_type, default_lifecycle_stage_key, timezone, tracking_enabled, reply_handling, version",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (settingsRes.error) {
      return fail("settings_read_failed", "Could not load Marketing configuration", 500);
    }
    const settings = (settingsRes.data as Row) ?? null;

    // ── 5) Tenant lifecycle stages — errors fail closed. ──
    const stagesRes = await admin
      .from("marketing_lifecycle_stages")
      .select("stage_key,label,tone,sort_order,active,terminal_outcome,is_default")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true });
    if (stagesRes.error) {
      return fail("stages_read_failed", "Could not load lifecycle configuration", 500);
    }

    return json({
      ok: true,
      data: {
        can_view: true,
        marketing_enabled: true,
        permissions: [...permissions].sort(),
        // initialised=false: settings not yet materialised (caller lacked the
        // authority to bootstrap); the UI states this honestly.
        initialised: settings !== null,
        materialised: materialised
          ? {
              created_settings: materialised.created_settings === true,
              created_stages: Number(materialised.created_stages ?? 0),
            }
          : null,
        settings: settings
          ? {
              include_all_discovered: settings.include_all_discovered === true,
              default_relationship_type: String(settings.default_relationship_type),
              default_lifecycle_stage_key: String(settings.default_lifecycle_stage_key),
              timezone: String(settings.timezone),
              tracking_enabled: settings.tracking_enabled === true,
              reply_handling: settings.reply_handling === "none" ? "none" : "workspace",
              version: Number(settings.version ?? 1),
            }
          : null,
        lifecycle_stages: stagesRes.data ?? [],
      },
    });
  } catch (e) {
    return fail("marketing_access_error", (e as Error).message, 500);
  }
});
