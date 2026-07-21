// ServiceOS — Edge Function: telephony-onboarding.
//
// Guided, resumable provider onboarding. Tenant-bound, owner/admin for writes.
// Actions: state (get/create + resume), test_connection, discover (idempotent inventory
// import), advance, complete, dashboard (real calibration metrics), test_call.
// Provider-neutral: everything goes through the adapter contract. No secrets returned;
// account/endpoint references are masked. Never mutates raw transcripts/payloads.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { requireTenantUser, assertSameTenant } from "../_shared/authz.ts";
import { getAdapter, availableProviders } from "../_shared/telephony/registry.ts";
import { DISCOVERY_ORDER, type CanonicalType } from "../_shared/telephony/adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
const fail = (code: string, message: string, s: number) =>
  json({ success: false, error: { code, message } }, s);

// Stage → completion %. Ordered lifecycle.
const STAGES = [
  "provider_selected",
  "connection_configured",
  "connection_verified",
  "inventory_discovered",
  "inventory_imported",
  "mappings_reviewed",
  "behaviour_configured",
  "test_call_verified",
  "complete",
] as const;
const pctFor = (stage: string) =>
  Math.round((STAGES.indexOf(stage as never) / (STAGES.length - 1)) * 100);
const mask = (r: string | null) => (r ? `…${r.slice(-6)}` : null);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);
  const db = createSupabaseAdmin();
  if (!db) return fail("config_error", "Service role not configured", 500);

  let body: Record<string, unknown> = {};
  try {
    body = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return fail("invalid_json", "Body must be JSON", 400);
  }
  const action = String(body.action ?? "state");
  const readOnly = action === "state" || action === "dashboard" || action === "test_connection";
  const auth = await requireTenantUser(
    req,
    db,
    (readOnly ? ["owner", "admin", "ops"] : ["owner", "admin"]) as never,
  );
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return fail(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;
  const provider = String(body.provider ?? "sipcentric");
  const adapter = getAdapter(provider);
  const ctx = { db, tenantId };
  const nowIso = new Date().toISOString();

  async function loadState() {
    const { data } = await db
      .from("telephony_onboarding")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();
    return data;
  }
  async function patchState(patch: Record<string, unknown>) {
    await db
      .from("telephony_onboarding")
      .update({ ...patch, updated_by: auth.ctx.userId })
      .eq("tenant_id", tenantId)
      .eq("provider", provider);
  }

  // ── state: get or create (resume) ───────────────────────────────────────────
  if (action === "state") {
    let state = await loadState();
    if (!state && !readOnlyCreateBlocked(auth.ctx.role)) {
      await db.from("telephony_onboarding").insert({
        tenant_id: tenantId,
        provider,
        stage: "provider_selected",
        completion_pct: pctFor("provider_selected"),
        started_by: auth.ctx.userId,
        updated_by: auth.ctx.userId,
      });
      state = await loadState();
    }
    return json({
      success: true,
      state: state ? maskState(state) : null,
      available_providers: availableProviders(),
      capabilities: adapter?.getCapabilityStatus() ?? null,
    });
  }

  if (!adapter) return fail("unknown_provider", `No adapter for '${provider}'`, 400);

  // ── test_connection (diagnostics) ───────────────────────────────────────────
  if (action === "test_connection") {
    const result = await adapter.testConnection(ctx);
    return json({ success: true, provider, ...result });
  }

  // ── discover (idempotent inventory import) ──────────────────────────────────
  if (action === "discover") {
    let discovered = 0;
    let imported = 0;
    const perType: Array<{ type: string; supported: boolean; count?: number; reason?: string }> =
      [];
    for (const type of DISCOVERY_ORDER as CanonicalType[]) {
      const r = await adapter.discover(type, ctx);
      if (!r.supported) {
        perType.push({ type, supported: false, reason: r.reason });
        continue;
      }
      perType.push({ type, supported: true, count: r.objects.length });
      discovered += r.objects.length;
      for (const o of r.objects) {
        const { error } = await db.from("telephony_inventory").upsert(
          {
            tenant_id: tenantId,
            provider,
            provider_object_id: o.providerObjectId,
            canonical_type: o.canonicalType,
            label: o.label,
            parent_object_id: o.parentObjectId ?? null,
            status: "active",
            discovery_source: o.discoverySource,
            confidence: o.confidence,
            capabilities: o.capabilities ?? {},
            provider_metadata: o.providerMetadata ?? {},
            last_seen: nowIso,
            synced_at: nowIso,
          },
          { onConflict: "tenant_id,provider,provider_object_id", ignoreDuplicates: false },
        );
        if (!error) imported++;
      }
    }
    await patchState({
      stage: "inventory_imported",
      stage_status: "done",
      completion_pct: pctFor("inventory_imported"),
      discovered_count: discovered,
      imported_count: imported,
      last_success_action: "discover",
      last_error: null,
    });
    return json({ success: true, provider, discovered, imported, per_type: perType });
  }

  // ── advance / complete ──────────────────────────────────────────────────────
  if (action === "advance") {
    const stage = String(body.stage ?? "");
    if (!STAGES.includes(stage as never)) return fail("invalid_stage", "Unknown stage", 400);
    await patchState({
      stage,
      stage_status: String(body.stage_status ?? "in_progress"),
      completion_pct: pctFor(stage),
      blockers: Array.isArray(body.blockers) ? body.blockers : [],
      last_success_action: "advance",
    });
    return json({ success: true, stage, completion_pct: pctFor(stage) });
  }
  if (action === "complete") {
    // Refuse to complete if call ingestion itself is broken (no calls at all).
    const { count: calls } = await db
      .from("phone_calls")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (!calls)
      return fail("ingestion_broken", "No call ingestion — cannot complete onboarding", 409);
    await patchState({
      stage: "complete",
      stage_status: "done",
      completion_pct: 100,
      accepted_gaps: body.accepted_gaps === true,
      last_success_action: "complete",
    });
    return json({ success: true, stage: "complete", accepted_gaps: body.accepted_gaps === true });
  }

  // ── dashboard (real calibration metrics) ────────────────────────────────────
  if (action === "dashboard") {
    const c = async (table: string, match: Record<string, unknown>) => {
      let q = db.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenantId);
      for (const [k, v] of Object.entries(match)) q = q.eq(k, v as never);
      return (await q).count ?? 0;
    };
    const [endpoints, confirmed, shared, callsProcessed, internalResolved] = await Promise.all([
      c("telephony_inventory", { canonical_type: "endpoint", status: "active" }),
      c("telephony_directory", { status: "confirmed", active: true }),
      c("telephony_directory", { is_shared_device: true, active: true }),
      db
        .from("call_directions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .then((r) => r.count ?? 0),
      db
        .from("call_participants")
        .select("*", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("participant_role", "internal")
        .not("resolved_entity_id", "is", null)
        .then((r) => r.count ?? 0),
    ]);
    // Honest denominator: resolved internal staff as a fraction of ALL processed calls
    // (an unmapped call has no internal participant row), not of resolved rows only.
    return json({
      success: true,
      metrics: {
        active_endpoints: endpoints,
        confirmed_mappings: confirmed,
        shared_devices: shared,
        unresolved_endpoints: Math.max(0, endpoints - confirmed - shared),
        calls_processed: callsProcessed,
        internal_resolved_calls: internalResolved,
        internal_resolution_rate: callsProcessed
          ? Math.round((internalResolved / callsProcessed) * 100)
          : 0,
      },
    });
  }

  // ── test_call (final verification of one call) ──────────────────────────────
  if (action === "test_call") {
    const callId = body.call_id ? String(body.call_id) : null;
    let cid = callId;
    if (!cid) {
      const { data } = await db
        .from("call_directions")
        .select("call_id")
        .eq("tenant_id", tenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      cid = (data?.call_id as string | null) ?? null;
    }
    if (!cid) return json({ success: true, steps: { call_found: false } });
    const [{ data: dir }, { data: parts }] = await Promise.all([
      db
        .from("call_directions")
        .select("direction")
        .eq("tenant_id", tenantId)
        .eq("call_id", cid)
        .maybeSingle(),
      db
        .from("call_participants")
        .select("participant_role, resolved_entity_id")
        .eq("tenant_id", tenantId)
        .eq("call_id", cid),
    ]);
    const internal = (parts ?? []).find((p) => p.participant_role === "internal");
    const steps = {
      call_found: true,
      direction_resolved: !!dir?.direction,
      participant_resolved: !!(parts && parts.length),
      staff_identity_resolved: !!internal?.resolved_entity_id,
      visible_in_communications: !!dir?.direction, // Communications reads these rows
    };
    if (steps.direction_resolved && steps.participant_resolved) {
      await patchState({
        stage: "test_call_verified",
        completion_pct: pctFor("test_call_verified"),
        last_success_action: "test_call",
      });
    }
    return json({ success: true, call: mask(cid), steps });
  }

  return fail("unknown_action", `Unknown action '${action}'`, 400);
});

function readOnlyCreateBlocked(role: string): boolean {
  return !["owner", "admin"].includes(role);
}
function maskState(s: Record<string, unknown>): Record<string, unknown> {
  return {
    ...s,
    connection_ref: typeof s.connection_ref === "string" ? `…${s.connection_ref.slice(-4)}` : null,
  };
}
