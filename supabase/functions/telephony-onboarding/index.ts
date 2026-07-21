// ServiceOS — Edge Function: telephony-onboarding.
//
// Guided, resumable provider onboarding. Tenant-bound, owner/admin for writes.
// Actions: state (get/create + resume), test_connection, discover (idempotent inventory
// import), advance, complete, dashboard (real calibration metrics), test_call.
// Provider-neutral: everything goes through the adapter contract. No secrets returned;
// account/endpoint references are masked. Never mutates raw transcripts/payloads.

import { createSupabaseAdmin } from "../_shared/simwood.ts";
import { requireTenantUser, assertSameTenant } from "../_shared/authz.ts";
import { getAdapter, availableProviders, getConnectionSpec } from "../_shared/telephony/registry.ts";
import {
  DISCOVERY_ORDER,
  type AdapterContext,
  type CanonicalType,
} from "../_shared/telephony/adapter.ts";
import {
  validateConnectionInput,
  partitionValues,
} from "../_shared/telephony/connection_spec.ts";
import {
  storeCredential,
  getConnectionStatus,
  connectionSnapshot,
  resolveCredential,
  revokeCredential,
  recordConnectionTest,
  logConnectionEvent,
  listConnectionEvents,
} from "../_shared/telephony/credential_broker.ts";
import { startOAuth } from "../_shared/telephony/oauth.ts";

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
  const READ_ONLY_ACTIONS = new Set([
    "state",
    "dashboard",
    "test_connection",
    "diagnostics",
    "providers",
    "spec",
    "connection_status",
    "audit",
  ]);
  const readOnly = READ_ONLY_ACTIONS.has(action);
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
  // Server-side secret resolver — wired to the Vault broker. Adapters may use it inside
  // testConnection/discover; secrets are NEVER returned to the client.
  const ctx: AdapterContext = {
    db,
    tenantId,
    resolveSecret: (field: string) => resolveCredential(db, tenantId, provider, field),
  };
  const nowIso = new Date().toISOString();
  const actorId = auth.ctx.userId === "service" ? null : auth.ctx.userId;

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
  async function ensureOnboarding() {
    const existing = await loadState();
    if (existing) return existing;
    await db.from("telephony_onboarding").insert({
      tenant_id: tenantId,
      provider,
      stage: "provider_selected",
      completion_pct: pctFor("provider_selected"),
      started_by: auth.ctx.userId,
      updated_by: auth.ctx.userId,
    });
    return loadState();
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
    const includeDev = body.include_dev === true;
    return json({
      success: true,
      state: state ? maskState(state) : null,
      available_providers: availableProviders(includeDev),
      capabilities: adapter?.getCapabilityStatus() ?? null,
      connection_spec: getConnectionSpec(provider),
      connection: await getConnectionStatus(db, tenantId, provider),
    });
  }

  // ── providers (gallery) ─────────────────────────────────────────────────────
  if (action === "providers") {
    return json({ success: true, providers: availableProviders(body.include_dev === true) });
  }

  if (!adapter) return fail("unknown_provider", `No adapter for '${provider}'`, 400);

  // ── spec / connection_status (adapter-driven form + secret-free status) ──────
  if (action === "spec" || action === "connection_status") {
    return json({
      success: true,
      provider,
      connection_spec: adapter.getConnectionSpec(),
      capabilities: adapter.getCapabilityStatus(),
      connection: await getConnectionStatus(db, tenantId, provider),
    });
  }

  // ── test_connection (diagnostics) ───────────────────────────────────────────
  if (action === "test_connection") {
    ctx.connection = await connectionSnapshot(db, tenantId, provider);
    const result = await adapter.testConnection(ctx);
    await recordConnectionTest(db, tenantId, provider, result.ok, { checks: result.checks }, actorId);
    return json({ success: true, provider, ...result });
  }

  // ── discover (idempotent inventory import) ──────────────────────────────────
  if (action === "discover") {
    ctx.connection = await connectionSnapshot(db, tenantId, provider);
    await logConnectionEvent(db, tenantId, provider, "discovery_started", actorId, {});
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
    await logConnectionEvent(db, tenantId, provider, "discovery_completed", actorId, {
      discovered,
      imported,
      per_type: perType,
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
    if (body.accepted_gaps === true) {
      await logConnectionEvent(db, tenantId, provider, "gaps_accepted", actorId, {});
    }
    await logConnectionEvent(db, tenantId, provider, "onboarding_completed", actorId, {
      accepted_gaps: body.accepted_gaps === true,
    });
    return json({ success: true, stage: "complete", accepted_gaps: body.accepted_gaps === true });
  }

  // ── reopen onboarding (after completion) ────────────────────────────────────
  if (action === "reopen") {
    await ensureOnboarding();
    await patchState({
      stage: String(body.stage ?? "mappings_reviewed"),
      stage_status: "in_progress",
      completion_pct: pctFor(String(body.stage ?? "mappings_reviewed")),
      last_success_action: "reopen",
    });
    await logConnectionEvent(db, tenantId, provider, "onboarding_reopened", actorId, {});
    return json({ success: true, reopened: true });
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

  // ── configure_connection (adapter-schema-driven, secure) ────────────────────
  if (action === "configure_connection") {
    const spec = adapter.getConnectionSpec();
    const values = (body.values ?? {}) as Record<string, unknown>;
    const existing = await getConnectionStatus(db, tenantId, provider);
    const errors = validateConnectionInput(spec, values, existing.configuredFields);
    if (errors.length) {
      return json(
        { success: false, error: { code: "validation_failed", message: "Invalid connection details" }, field_errors: errors },
        400,
      );
    }
    const { secrets, nonSecret } = partitionValues(spec, values);
    const manual = spec.manual && Object.keys(secrets).length === 0;
    const status = await storeCredential(db, tenantId, provider, {
      authMode: spec.authMode,
      secrets,
      nonSecret,
      accountRefField: spec.accountRefField ?? null,
      manual,
      actorId,
    });
    await ensureOnboarding();
    await patchState({
      stage: "connection_configured",
      stage_status: "done",
      completion_pct: pctFor("connection_configured"),
      connection_ref: status.accountRef,
      last_success_action: "configure_connection",
      last_error: null,
    });
    return json({ success: true, provider, connection: status });
  }

  // ── import_existing (recognise a pre-existing operator connection, e.g. Drummond) ──
  if (action === "import_existing") {
    const { data: accts } = await db
      .from("connector_accounts")
      .select("account_key, display_name")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true })
      .limit(1);
    const acct = (accts ?? [])[0];
    if (!acct) {
      return json({ success: true, provider, imported: false, reason: "no existing connector account found" });
    }
    // Import WITHOUT copying credentials: mark manual/provider-assisted, masked account ref.
    const { data: existing } = await db
      .from("provider_connections")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();
    await db.from("provider_connections").upsert(
      {
        tenant_id: tenantId,
        provider,
        status: "manual",
        auth_mode: adapter.authMode,
        account_ref: acct.account_key ? `…${String(acct.account_key).slice(-4)}` : null,
        non_secret_config: { provider_account: acct.display_name ?? null, imported: true },
        updated_by: actorId,
        created_by: existing ? undefined : actorId,
      },
      { onConflict: "tenant_id,provider" },
    );
    await ensureOnboarding();
    await patchState({
      stage: "connection_verified",
      stage_status: "done",
      completion_pct: pctFor("connection_verified"),
      connection_ref: acct.account_key ? `…${String(acct.account_key).slice(-4)}` : null,
      last_success_action: "import_existing",
    });
    await logConnectionEvent(db, tenantId, provider, "credentials_configured", actorId, {
      imported: true,
      manual: true,
    });
    return json({ success: true, provider, imported: true, connection: await getConnectionStatus(db, tenantId, provider) });
  }

  // ── diagnostics (structured, honest) ────────────────────────────────────────
  if (action === "diagnostics") {
    ctx.connection = await connectionSnapshot(db, tenantId, provider);
    const status = await getConnectionStatus(db, tenantId, provider);
    const test = await adapter.testConnection(ctx);
    const caps = adapter.getCapabilityStatus();
    const { count: inv } = await db
      .from("telephony_inventory")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .eq("status", "active");
    const remediation: Record<string, { likely_cause: string; recommended_action: string }> = {
      credentials_present: {
        likely_cause: "No credentials have been configured for this provider yet.",
        recommended_action: "Enter connection details in the connection step.",
      },
      authentication_accepted: {
        likely_cause: "The stored credential was rejected or could not be resolved.",
        recommended_action: "Replace the credential, then retry the connection test.",
      },
      provider_reachable: {
        likely_cause: "The provider endpoint could not be reached or authorised.",
        recommended_action: "Check the account reference and credentials; retry.",
      },
      call_history_permission: {
        likely_cause: "The account lacks call-history access, or no calls have synced yet.",
        recommended_action: "Confirm call-history permission with the provider; wait for the next sync.",
      },
    };
    const checks = test.checks.map((c) => ({
      ...c,
      likely_cause: c.ok ? null : (remediation[c.name]?.likely_cause ?? "This check did not pass."),
      recommended_action: c.ok ? null : (remediation[c.name]?.recommended_action ?? "Retry, or contact your operator."),
    }));
    return json({
      success: true,
      provider,
      connection_status: status.status,
      account_ref: status.accountRef,
      ok: test.ok,
      checks,
      capabilities: caps,
      active_inventory: inv ?? 0,
      manual: adapter.getConnectionSpec().manual,
    });
  }

  // ── behaviour (manual pickup / shared-device configuration) ─────────────────
  if (action === "behaviour") {
    const entries = Array.isArray(body.entries) ? (body.entries as Array<Record<string, unknown>>) : [];
    let saved = 0;
    for (const e of entries) {
      const t = String(e.canonical_type ?? "");
      if (!t) continue;
      const pid = String(e.provider_object_id ?? `manual:${t}:${String(e.label ?? crypto.randomUUID())}`);
      const { error } = await db.from("telephony_inventory").upsert(
        {
          tenant_id: tenantId,
          provider,
          provider_object_id: pid,
          canonical_type: t,
          label: (e.label as string | null) ?? null,
          status: "active",
          discovery_source: "manual",
          provisioning_state: "manual",
          confidence: 1.0,
          capabilities: (e.capabilities as Record<string, unknown>) ?? {},
          provider_metadata: { note: e.note ?? null },
          last_seen: nowIso,
          synced_at: nowIso,
        },
        { onConflict: "tenant_id,provider,provider_object_id", ignoreDuplicates: false },
      );
      if (!error) saved++;
    }
    const config = (body.config ?? {}) as Record<string, unknown>;
    await ensureOnboarding();
    await patchState({
      stage: "behaviour_configured",
      stage_status: "done",
      completion_pct: pctFor("behaviour_configured"),
      behaviour_config: config,
      last_success_action: "behaviour",
    });
    if (saved) await logConnectionEvent(db, tenantId, provider, "inventory_imported", actorId, { manual_entries: saved });
    return json({ success: true, provider, saved, config });
  }

  // ── disconnect / reconnect (connected-state management) ──────────────────────
  if (action === "disconnect") {
    const status = await revokeCredential(db, tenantId, provider, actorId);
    return json({ success: true, provider, connection: status });
  }
  if (action === "reconnect") {
    return json({
      success: true,
      provider,
      connection_spec: adapter.getConnectionSpec(),
      connection: await getConnectionStatus(db, tenantId, provider),
    });
  }

  // ── audit (connection event history — secret-free) ──────────────────────────
  if (action === "audit") {
    const events = await listConnectionEvents(db, tenantId, provider, Number(body.limit ?? 50));
    return json({ success: true, provider, events });
  }

  // ── oauth_start (reusable delegated-authorization framework) ─────────────────
  if (action === "oauth_start") {
    const spec = adapter.getConnectionSpec();
    if (!spec.oauth?.supported) {
      return fail("oauth_unsupported", `${provider} does not support OAuth`, 400);
    }
    const values = (body.values ?? {}) as Record<string, unknown>;
    const errors = validateConnectionInput(spec, values, []);
    if (errors.length) {
      return json(
        { success: false, error: { code: "validation_failed", message: "Invalid connection details" }, field_errors: errors },
        400,
      );
    }
    const { nonSecret } = partitionValues(spec, values);
    const up = provider.toUpperCase();
    const authorizeBase =
      Deno.env.get(`PROVIDER_OAUTH_${up}_AUTHORIZE_URL`) ?? "https://oauth-demo.serviceos.local/authorize";
    const clientId = Deno.env.get(`PROVIDER_OAUTH_${up}_CLIENT_ID`) ?? "serviceos-demo";
    const redirectUri = String(
      body.redirect_uri ?? Deno.env.get(`PROVIDER_OAUTH_${up}_REDIRECT_URI`) ?? "",
    );
    // Persist non-secret config early (do not disturb an existing configured row's status).
    const { data: existing } = await db
      .from("provider_connections")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("provider", provider)
      .maybeSingle();
    if (existing) {
      await db
        .from("provider_connections")
        .update({ non_secret_config: nonSecret, auth_mode: spec.authMode, updated_by: actorId })
        .eq("tenant_id", tenantId)
        .eq("provider", provider);
    } else {
      await db.from("provider_connections").insert({
        tenant_id: tenantId,
        provider,
        status: "not_configured",
        auth_mode: spec.authMode,
        non_secret_config: nonSecret,
        created_by: actorId,
        updated_by: actorId,
      });
    }
    const { authorizeUrl, state } = await startOAuth({
      db,
      tenantId,
      provider,
      userId: actorId,
      scopes: spec.oauth.scopes,
      redirectUri,
      authorizeBase,
      clientId,
      usePkce: spec.oauth.pkce,
    });
    await ensureOnboarding();
    await logConnectionEvent(db, tenantId, provider, "oauth_started", actorId, { scopes: spec.oauth.scopes });
    return json({ success: true, provider, authorize_url: authorizeUrl, state });
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
