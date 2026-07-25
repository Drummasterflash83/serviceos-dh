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
  loadDiscoveryHistory,
  loadTenantSummary,
  loadTenantWorkspace,
  resolveForEvidence,
} from "../_shared/controlplane/store.ts";
import {
  discoverEmailEndpoints,
  discoverTelephonyEndpoints,
} from "../_shared/controlplane/discovery.ts";
import { discoverTelephonyExtensionsFromActivity } from "../_shared/controlplane/telephony_discovery.ts";
import {
  gatherLearningMetrics,
  buildLearningOverview,
} from "../_shared/controlplane/learning_centre.ts";
import { computeSourceReadiness } from "../_shared/controlplane/projection.ts";
import {
  validateManualEndpoint,
  findDuplicate,
  type ExistingEndpoint,
} from "../_shared/controlplane/telephony_validation.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-openfolk-actor",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Delegated-setup helpers ──────────────────────────────────────────────────
// Which fields a customer admin may submit per task type (purpose scope). Enforced again
// server-side by delegated_task_submit; validated here at issue time.
const DELEGATED_TASK_TYPES = new Set([
  "authorise_google_workspace",
  "authorise_microsoft_365",
  "provide_telephony_inventory",
  "authorise_slack",
  "provide_provider_admin_contact",
  "confirm_company_domains",
]);
const DELEGATED_ALLOWED_FIELDS: Record<string, string[]> = {
  provide_telephony_inventory: [
    "endpoint_type",
    "value",
    "display_label",
    "extension",
    "ddi",
    "device_label",
    "queue_or_group_name",
    "provider",
    "account_reference",
    "notes",
  ],
  confirm_company_domains: ["domain", "notes"],
  provide_provider_admin_contact: ["contact_name", "contact_email", "contact_phone", "notes"],
  authorise_google_workspace: ["notes"],
  authorise_microsoft_365: ["notes"],
  authorise_slack: ["notes"],
};
const MAX_TTL_SECONDS = 30 * 24 * 3600; // approved expiry ceiling: 30 days
const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// SAFE operator columns — NEVER token_hash / secrets.
const DELEGATED_SAFE_COLS =
  "id, tenant_id, provider, connection_id, task_type, requested_action, recipient_email, recipient_name, status, token_last4, single_use, max_uses, use_count, expires_at, opened_at, submitted_at, completed_at, revoked_at, created_by, correlation_id, created_at";
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
  "endpoint.validate",
  "connections.discovery_history",
  "delegated.list",
  "delegated.get_submission",
  "learning.overview",
]);

// Machine mode (x-openfolk-machine-key) may invoke ONLY these named operations — never
// arbitrary writes, ownership assignment, or a generic query. Interactive operators are
// governed by the platform-grant model instead.
const MACHINE_ACTIONS = new Set([
  "tenants.list",
  "workspace",
  "resolve",
  "data_quality",
  "audit",
  "readiness",
  "endpoint.validate",
  "discover.email",
  "discover.telephony",
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

  // Machine mode is restricted to an explicit allowlist of named operations.
  if (ctx.role === "machine" && !MACHINE_ACTIONS.has(action)) {
    return fail("forbidden", `Machine mode may not invoke '${action}'`, 403);
  }

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
      case "learning.overview": {
        // Learning Centre Stage 1 — read-only projection over tenant-scoped canonical evidence.
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const metrics = await gatherLearningMetrics(admin, tenantId, new Date(now).toISOString());
        return json({ ok: true, data: buildLearningOverview(metrics) });
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

      case "endpoint.validate": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const v = validateManualEndpoint({
          kind: body.endpoint_kind,
          value: body.value,
          display: body.display_value,
          providerContext: body.provider_context,
          providerId: body.provider_id,
        });
        if (!v.ok) return json({ ok: true, data: { valid: false, errors: v.errors } });
        const { data: eps } = await admin
          .from("communication_endpoints")
          .select("endpoint_kind, normalized_value, provider, source")
          .eq("tenant_id", tenantId)
          .eq("status", "active");
        const dup = findDuplicate(v, (eps ?? []) as ExistingEndpoint[]);
        return json({
          ok: true,
          data: {
            valid: true,
            kind: v.kind,
            canonical: v.canonical,
            display: v.display,
            duplicate: dup
              ? { normalized_value: dup.normalized_value, source: dup.source ?? null }
              : null,
          },
        });
      }

      // ── Writes (admin, atomic RPCs) ──
      case "endpoint.manual_create": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const v = validateManualEndpoint({
          kind: body.endpoint_kind,
          value: body.value,
          display: body.display_value,
          providerContext: body.provider_context,
          providerId: body.provider_id,
        });
        if (!v.ok) return fail("validation_failed", v.errors.join("; "), 400);
        const { data: eps } = await admin
          .from("communication_endpoints")
          .select("endpoint_kind, normalized_value, provider, source")
          .eq("tenant_id", tenantId)
          .eq("status", "active");
        const dup = findDuplicate(v, (eps ?? []) as ExistingEndpoint[]);
        if (dup)
          return fail(
            "duplicate_endpoint",
            `A ${v.kind} '${v.canonical}' already exists (source: ${dup.source ?? "?"})`,
            409,
          );
        const { data, error } = await rpc("cp_upsert_endpoint", {
          p_tenant: tenantId,
          p_channel: v.channel,
          p_endpoint_kind: v.kind,
          p_normalized: v.canonical,
          p_display: v.display,
          p_provider: body.provider_context ?? null,
          p_provider_ref: body.provider_id ?? null,
          p_is_shared: v.is_shared,
          p_source: "manual",
          p_source_object_ref: null,
          p_metadata: {
            verification: "manual",
            provider_context: body.provider_context ?? null,
            notes: body.notes ?? null,
            created_by: ctx.actor,
          },
        });
        if (error) return fail("write_failed", error.message, 400);
        const r = data as { id?: string; outcome?: string } | null;
        return json({ ok: true, data: { id: r?.id, outcome: r?.outcome } });
      }
      case "endpoint.archive": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        if (!body.endpoint_id) return fail("bad_request", "endpoint_id required", 400);
        const { data, error } = await rpc("cp_archive_endpoint", {
          p_tenant: tenantId,
          p_endpoint_id: String(body.endpoint_id),
        });
        if (error) return fail("write_failed", error.message, 400);
        const r = data as { id?: string; outcome?: string } | null;
        return json({ ok: true, data: { id: r?.id, outcome: r?.outcome } });
      }
      case "identity.review": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        if (!body.endpoint_id || !body.decision)
          return fail("bad_request", "endpoint_id + decision required", 400);
        const { data, error } = await rpc("cp_review_identity", {
          p_tenant: tenantId,
          p_endpoint: String(body.endpoint_id),
          p_decision: String(body.decision),
          p_member: body.team_member_id ?? null,
          p_confidence: body.confidence ?? null,
          p_evidence: body.evidence ?? {},
        });
        if (error) return fail("write_failed", error.message, 400);
        return json({ ok: true, data });
      }
      case "endpoint.update": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        if (!body.endpoint_id) return fail("bad_request", "endpoint_id required", 400);
        const { data, error } = await rpc("cp_update_manual_endpoint", {
          p_tenant: tenantId,
          p_endpoint: String(body.endpoint_id),
          p_display: body.display_value ?? null,
          p_provider_context: body.provider_context ?? null,
          p_metadata: body.metadata ?? null,
          p_expected_updated_at: body.expected_updated_at ?? null,
        });
        if (error) return fail("write_failed", error.message, 400);
        const r = data as { id?: string; outcome?: string } | null;
        return json({ ok: true, data: { id: r?.id, outcome: r?.outcome } });
      }
      case "ownership.end": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        if (!body.assignment_id) return fail("bad_request", "assignment_id required", 400);
        const { data, error } = await rpc("cp_end_ownership", {
          p_tenant: tenantId,
          p_assignment: String(body.assignment_id),
          p_effective_to: body.effective_to ?? null,
          p_expected_updated_at: body.expected_updated_at ?? null,
        });
        if (error) return fail("write_failed", error.message, 400);
        return json({ ok: true, data });
      }
      case "endpoint.restore": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        if (!body.endpoint_id) return fail("bad_request", "endpoint_id required", 400);
        const { data, error } = await rpc("cp_restore_endpoint", {
          p_tenant: tenantId,
          p_endpoint_id: String(body.endpoint_id),
        });
        if (error) return fail("write_failed", error.message, 400);
        const r = data as { id?: string; outcome?: string } | null;
        return json({ ok: true, data: { id: r?.id, outcome: r?.outcome } });
      }
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
        // cp_upsert_endpoint now returns { id, outcome } (created|updated|unchanged).
        const r = data as { id?: string; outcome?: string } | string | null;
        return json({
          ok: true,
          data: r && typeof r === "object" ? { id: r.id, outcome: r.outcome } : { id: r },
        });
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
        // Two complementary, endpoints-only discovery passes (neither touches ownership):
        //  (a) provider inventory objects (addressable extensions/DDIs), and
        //  (b) internal seats derived from observed call activity (caller-ID labels), which
        //      is where sipcentric's per-person extensions actually surface.
        const [inventory, activity] = await Promise.all([
          discoverTelephonyEndpoints(admin, tenantId, ctx.actor),
          discoverTelephonyExtensionsFromActivity(admin, tenantId, ctx.actor),
        ]);
        return json({ ok: true, data: { inventory, activity } });
      }
      case "discover.email": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        return json({ ok: true, data: await discoverEmailEndpoints(admin, tenantId, ctx.actor) });
      }

      // ── Generic discovery history (read) ──
      case "connections.discovery_history": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const data = await loadDiscoveryHistory(admin, tenantId, {
          page: typeof body.page === "number" ? body.page : 0,
          page_size: typeof body.page_size === "number" ? body.page_size : 25,
          provider: body.provider ? String(body.provider) : null,
          status: body.status ? String(body.status) : null,
        });
        return json({ ok: true, data });
      }

      // ── Delegated setup tasks (operator) ──
      case "delegated.list": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const { data } = await admin
          .from("delegated_setup_tasks")
          .select(DELEGATED_SAFE_COLS + ", submission")
          .eq("tenant_id", tenantId)
          .order("created_at", { ascending: false })
          .limit(200);
        // Never leak the staged payload in the list — only its presence.
        const tasks = (data ?? []).map((t: Row) => {
          const { submission, ...safe } = t;
          return { ...safe, submission_present: submission != null };
        });
        return json({ ok: true, data: { tasks } });
      }
      case "delegated.get_submission": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const taskId = body.task_id ? String(body.task_id) : null;
        if (!taskId) return fail("bad_request", "task_id required", 400);
        const { data: t } = await admin
          .from("delegated_setup_tasks")
          .select(DELEGATED_SAFE_COLS + ", submission")
          .eq("tenant_id", tenantId) // tenant isolation
          .eq("id", taskId)
          .maybeSingle();
        if (!t) return fail("not_found", "task not found for tenant", 404);
        return json({ ok: true, data: { task: t } });
      }
      case "delegated.issue": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const taskType = String(body.task_type ?? "");
        if (!DELEGATED_TASK_TYPES.has(taskType))
          return fail("validation_failed", `invalid task_type '${taskType}'`, 400);
        const requestedAction = String(body.requested_action ?? "").trim();
        if (!requestedAction) return fail("validation_failed", "requested_action required", 400);
        const recipientEmail = String(body.recipient_email ?? "")
          .trim()
          .toLowerCase();
        if (!recipientEmail || !recipientEmail.includes("@"))
          return fail("validation_failed", "valid recipient_email required", 400);
        const permitted = DELEGATED_ALLOWED_FIELDS[taskType] ?? [];
        const allowedFields = Array.isArray(body.allowed_fields)
          ? (body.allowed_fields as unknown[]).map(String)
          : permitted;
        const invalid = allowedFields.filter((f) => !permitted.includes(f));
        if (invalid.length)
          return fail(
            "validation_failed",
            `fields not valid for ${taskType}: ${invalid.join(", ")}`,
            400,
          );
        const ttl = typeof body.ttl_seconds === "number" ? body.ttl_seconds : 7 * 24 * 3600;
        if (ttl < 60 || ttl > MAX_TTL_SECONDS)
          return fail("validation_failed", `ttl_seconds must be 60..${MAX_TTL_SECONDS}`, 400);
        const connectionId = body.connection_id ? String(body.connection_id) : null;
        if (connectionId) {
          const { data: c } = await admin
            .from("provider_connections")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("id", connectionId)
            .maybeSingle();
          if (!c) return fail("validation_failed", "connection does not belong to tenant", 400);
        }
        // Generate the RAW token HERE. It never touches the DB and is returned exactly once.
        const raw = b64url(crypto.getRandomValues(new Uint8Array(32)));
        const tokenHash = await sha256hex(raw);
        const last4 = raw.slice(-4);
        const { data: taskId, error } = await admin.rpc("delegated_task_issue", {
          p_tenant: tenantId,
          p_task_type: taskType,
          p_requested_action: requestedAction,
          p_allowed_fields: allowedFields,
          p_recipient_email: recipientEmail,
          p_recipient_name: body.recipient_name ? String(body.recipient_name) : null,
          p_provider: body.provider ? String(body.provider) : null,
          p_connection_id: connectionId,
          p_token_hash: tokenHash,
          p_token_last4: last4,
          p_ttl_seconds: ttl,
          p_single_use: body.single_use === false ? false : true,
          p_max_uses: typeof body.max_uses === "number" ? body.max_uses : 1,
          p_created_by: null,
        });
        if (error) return fail("issue_failed", error.message, 500);
        // Audit WITHOUT the raw token or URL.
        await admin.from("controlplane_change_log").insert({
          tenant_id: tenantId,
          actor: ctx.actor,
          action: "controlplane.delegated.issue",
          resource_type: "delegated_setup_task",
          resource_id: String(taskId),
          reason,
          correlation_id: correlation,
          view_as_active: ctx.viewAsActive,
          source: "controlplane",
          after: { task_type: taskType, recipient_email: recipientEmail, token_last4: last4 },
        });
        // Build the one-time setup URL from a request-provided origin; do NOT log it.
        const origin = body.origin ? String(body.origin) : "";
        return json({
          ok: true,
          data: {
            task_id: taskId,
            task_type: taskType,
            recipient_email: recipientEmail,
            token_last4: last4,
            setup_url: origin ? `${origin.replace(/\/$/, "")}/setup/${raw}` : `/setup/${raw}`,
            warning: "This setup link is shown once and cannot be recovered. Copy it now.",
          },
        });
      }
      case "delegated.revoke": {
        if (!tenantId) return fail("bad_request", "tenant_id required", 400);
        const taskId = body.task_id ? String(body.task_id) : null;
        if (!taskId) return fail("bad_request", "task_id required", 400);
        const { data: t } = await admin
          .from("delegated_setup_tasks")
          .select("id, status")
          .eq("tenant_id", tenantId) // tenant isolation
          .eq("id", taskId)
          .maybeSingle();
        if (!t) return fail("not_found", "task not found for tenant", 404);
        if (t.status === "completed")
          return fail("illegal_transition", "a completed task cannot be revoked", 409);
        const { data: ok, error } = await admin.rpc("delegated_task_revoke", {
          p_task_id: taskId,
          p_actor: null,
        });
        if (error) return fail("revoke_failed", error.message, 500);
        if (ok !== true) return fail("noop", "task was not revoked (already revoked?)", 409);
        await admin.from("controlplane_change_log").insert({
          tenant_id: tenantId,
          actor: ctx.actor,
          action: "controlplane.delegated.revoke",
          resource_type: "delegated_setup_task",
          resource_id: taskId,
          reason,
          correlation_id: correlation,
          view_as_active: ctx.viewAsActive,
          source: "controlplane",
        });
        return json({ ok: true, data: { revoked: true } });
      }

      default:
        return fail("bad_request", `unknown action '${action}'`, 400);
    }
  } catch (e) {
    return fail("controlplane_error", (e as Error).message, 500);
  }
});
