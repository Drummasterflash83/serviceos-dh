// ServiceOS — Edge Function: openfolk-control-plane
//
// The OpenFolk-operated managed-service admin surface. NOT a tenant/customer surface:
// access requires an OpenFolk profile role AND an active platform.controlplane grant
// (view to read, admin to write), enforced on the REAL actor — tenant admins/superadmins
// and View-As can NEVER reach it. Every write requires a reason and runs through an
// atomic cp_* RPC (mutation + immutable change-log in one transaction).
//
// Deploy with verify_jwt=false (auth enforced via requirePlatformOperator).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requirePlatformOperator } from "../_shared/controlplane/authz.ts";
import {
  computeDataQuality,
  loadTenantSummary,
  loadTenantWorkspace,
  resolveForEvidence,
} from "../_shared/controlplane/store.ts";
import {
  discoverEmailEndpoints,
  discoverTelephonyEndpoints,
} from "../_shared/controlplane/discovery.ts";
import { computeSourceReadiness } from "../_shared/controlplane/projection.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openfolk-actor",
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

const READ_ACTIONS = new Set([
  "tenants.list",
  "workspace",
  "resolve",
  "data_quality",
  "audit",
  "readiness",
]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  let body: Row = {};
  try {
    body = ((await req.json()) ?? {}) as Row;
  } catch {
    body = {};
  }
  const action = String(body.action ?? "");
  const isWrite = !READ_ACTIONS.has(action);

  // Authorize the REAL actor: view for reads, admin (+ no active View-As) for writes.
  const auth = await requirePlatformOperator(req, admin, { requireAdmin: isWrite });
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const ctx = auth.ctx;

  // Every write requires a reason (audit completeness).
  if (isWrite && !String(body.reason ?? "").trim()) {
    return fail("reason_required", "Every Control Plane change requires a reason", 400);
  }
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const reason = body.reason ? String(body.reason) : null;
  const correlation = body.correlation_id ? String(body.correlation_id) : null;
  const now = typeof body.now_ms === "number" ? body.now_ms : Date.now();

  const rpc = (fn: string, args: Row) =>
    admin.rpc(fn, {
      ...args,
      p_actor: ctx.actor,
      p_reason: reason,
      p_correlation: correlation,
      p_view_as: ctx.viewAsActive,
    });

  try {
    switch (action) {
      // ── Reads (view) ──
      case "tenants.list": {
        const { data: tenants } = await admin.from("tenants").select("id").order("slug");
        const summaries = [];
        for (const t of tenants ?? [])
          summaries.push(await loadTenantSummary(admin, t.id as string));
        return json({ ok: true, data: { tenants: summaries } });
      }
      case "workspace": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        return json({ ok: true, data: await loadTenantWorkspace(admin, tenantId) });
      }
      case "resolve": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const res = await resolveForEvidence(admin, tenantId, body.evidence ?? {}, now, {
          subjectRef: body.subject_ref ?? null,
        });
        return json({ ok: true, data: res });
      }
      case "data_quality": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        return json({ ok: true, data: { items: await computeDataQuality(admin, tenantId) } });
      }
      case "readiness": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        return json({ ok: true, data: await computeSourceReadiness(admin, tenantId) });
      }
      case "audit": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const { data } = await admin
          .from("controlplane_change_log")
          .select(
            "actor, action, resource_type, resource_id, before, after, reason, view_as_active, created_at",
          )
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(200);
        return json({ ok: true, data: { entries: data ?? [] } });
      }

      // ── Writes (admin, atomic RPCs) ──
      case "member.upsert": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const { data, error } = await rpc("cp_upsert_member", {
          p_tenant: tenantId,
          p_member_id: body.member_id ?? null,
          p_display_name: body.display_name ?? null,
          p_org_unit: body.org_unit_id ?? null,
          p_formal_role: body.formal_role ?? null,
        });
        if (error) return fail("write_failed", error.message, 400);
        return json({ ok: true, data: { id: data } });
      }
      case "identity.upsert": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const { data, error } = await rpc("cp_upsert_identity", {
          p_tenant: tenantId,
          p_member: body.team_member_id,
          p_provider: body.provider,
          p_identity_kind: body.identity_kind ?? "user",
          p_external_ref: body.external_ref,
          p_display: body.display ?? null,
          p_primary_login: body.primary_login ?? null,
          p_verification: body.verification_state ?? "unverified",
        });
        if (error) return fail("write_failed", error.message, 400);
        return json({ ok: true, data: { id: data } });
      }
      case "endpoint.upsert": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const { data, error } = await rpc("cp_upsert_endpoint", {
          p_tenant: tenantId,
          p_channel: body.channel,
          p_endpoint_kind: body.endpoint_kind,
          p_normalized: body.normalized_value,
          p_display: body.display_value ?? null,
          p_provider: body.provider ?? null,
          p_provider_ref: body.provider_external_ref ?? null,
          p_is_shared: body.is_shared ?? false,
          p_source: "openfolk",
          p_source_object_ref: body.source_object_ref ?? null,
          p_metadata: body.metadata ?? {},
        });
        if (error) return fail("write_failed", error.message, 400);
        return json({ ok: true, data: { id: data } });
      }
      case "ownership.assign": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const { data, error } = await rpc("cp_assign_ownership", {
          p_tenant: tenantId,
          p_endpoint: body.endpoint_id,
          p_owner_kind: body.owner_kind,
          p_member: body.owner_member_id ?? null,
          p_org_unit: body.owner_org_unit_id ?? null,
          p_role: body.owner_role ?? null,
          p_assignment_role: body.assignment_role,
          p_exclusive: body.exclusive ?? true,
          p_effective_from: body.effective_from ?? null,
          p_confidence: body.confidence ?? null,
          p_review_state: body.review_state ?? "confirmed",
        });
        if (error) return fail("write_failed", error.message, 400);
        return json({ ok: true, data: { id: data } });
      }
      case "discover.telephony": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        return json({
          ok: true,
          data: await discoverTelephonyEndpoints(admin, tenantId, ctx.actor),
        });
      }
      case "discover.email": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        return json({ ok: true, data: await discoverEmailEndpoints(admin, tenantId, ctx.actor) });
      }
      default:
        return fail("bad_request", `unknown action '${action}'`, 400);
    }
  } catch (e) {
    return fail("controlplane_error", (e as Error).message, 500);
  }
});
