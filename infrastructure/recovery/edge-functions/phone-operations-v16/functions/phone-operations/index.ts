// ServiceOS — phone operations API + provider webhook receiver.
//
// Interactive actions are tenant-bound from the authenticated user's profile.
// Provider webhooks require a dedicated shared secret and resolve the tenant from
// a configured provider identity (assistant/phone/account id), never from payload
// tenant_id. Notification delivery is intentionally separate and remains disabled
// until channels are explicitly configured.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import {
  classifyTwilioAlarm,
  classifyVapiServerMessage,
  safeAlertMetadata,
  type PhoneSignal,
} from "../_shared/phone_operations.ts";

type Admin = SupabaseClient;

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(await req.text()).entries());
  }
  return record(await req.json());
}

function providerIdentity(provider: string, body: Record<string, unknown>): string | null {
  if (provider === "vapi") {
    const message = record(body.message);
    const call = record(message.call);
    return (
      text(call.assistantId) ??
      text(call.phoneNumberId) ??
      text(record(call.assistant).id) ??
      null
    );
  }
  if (provider === "twilio") {
    return text(body.AccountSid ?? body.account_sid);
  }
  return null;
}

async function resolveWebhookTenant(
  admin: Admin,
  provider: string,
  identity: string | null,
): Promise<string | null> {
  if (!identity) return null;
  const keys =
    provider === "vapi"
      ? ["assistant_id", "phone_number_id"]
      : provider === "twilio"
        ? ["account_sid"]
        : [];
  for (const key of keys) {
    const { data } = await admin
      .from("provider_connections")
      .select("tenant_id")
      .eq("provider", provider)
      .contains("non_secret_config", { [key]: identity })
      .limit(2);
    if (data?.length === 1) return data[0].tenant_id as string;
    if ((data?.length ?? 0) > 1) return null;
  }
  return null;
}

async function recordSignal(admin: Admin, tenantId: string, signal: PhoneSignal): Promise<void> {
  const { error: healthError } = await admin.rpc("serviceos_record_health_check", {
    p_tenant: tenantId,
    p_component: signal.component,
    p_status: signal.status,
    p_error: signal.status === "healthy" ? null : signal.detail,
    p_metadata: safeAlertMetadata(signal.metadata),
  });
  if (healthError) throw new Error(`health_write_failed:${healthError.message}`);

  if (!signal.alertKey || !signal.severity || !signal.title) return;
  const { data: existing } = await admin
    .from("phone_alert_events")
    .select("id, occurrence_count")
    .eq("tenant_id", tenantId)
    .eq("provider", signal.provider)
    .eq("alert_key", signal.alertKey)
    .in("status", ["open", "acknowledged"])
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin
      .from("phone_alert_events")
      .update({
        status: "open",
        severity: signal.severity,
        title: signal.title,
        detail: signal.detail,
        provider_event_ref: signal.providerEventRef,
        occurrence_count: Number(existing.occurrence_count ?? 0) + 1,
        last_seen_at: new Date().toISOString(),
        metadata: safeAlertMetadata(signal.metadata),
      })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(`alert_update_failed:${error.message}`);
    return;
  }

  const { error } = await admin.from("phone_alert_events").insert({
    tenant_id: tenantId,
    provider: signal.provider,
    alert_key: signal.alertKey,
    severity: signal.severity,
    title: signal.title,
    detail: signal.detail,
    provider_event_ref: signal.providerEventRef,
    metadata: safeAlertMetadata(signal.metadata),
  });
  if (error) throw new Error(`alert_insert_failed:${error.message}`);
}

async function webhook(req: Request, admin: Admin): Promise<Response> {
  const expected = Deno.env.get("PHONE_OPERATIONS_WEBHOOK_SECRET") ?? "";
  const provided = req.headers.get("x-phone-operations-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return failResponse("forbidden", "Invalid phone operations webhook secret", 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await parseBody(req);
  } catch {
    return failResponse("invalid_json", "Webhook body could not be parsed", 400);
  }

  const provider = text(req.headers.get("x-phone-provider"))?.toLowerCase();
  if (provider !== "vapi" && provider !== "twilio") {
    return failResponse("invalid_provider", "x-phone-provider must be vapi or twilio", 400);
  }
  const identity = providerIdentity(provider, body);
  const tenantId = await resolveWebhookTenant(admin, provider, identity);
  if (!tenantId) {
    return failResponse("unmapped_provider", "Provider identity is not mapped to one tenant", 404);
  }

  const signal =
    provider === "vapi" ? classifyVapiServerMessage(body) : classifyTwilioAlarm(body);
  try {
    await recordSignal(admin, tenantId, signal);
  } catch (error) {
    return failResponse("phone_signal_write_failed", String(error), 500);
  }
  return jsonResponse({ success: true, accepted: true, status: signal.status }, 202);
}

async function status(admin: Admin, tenantId: string): Promise<Response> {
  const [health, alerts, assignments, policy, destinations] = await Promise.all([
    admin
      .from("system_health_checks")
      .select("component,status,last_success_at,last_failure_at,failure_count,last_error,metadata,updated_at")
      .eq("tenant_id", tenantId)
      .in("component", [
        "phone_ingress",
        "ai_receptionist",
        "phone_transfers",
        "phone_destinations",
        "phone_notifications",
      ])
      .order("component"),
    admin
      .from("phone_alert_events")
      .select("id,provider,alert_key,severity,status,title,detail,occurrence_count,first_seen_at,last_seen_at")
      .eq("tenant_id", tenantId)
      .in("status", ["open", "acknowledged"])
      .order("last_seen_at", { ascending: false })
      .limit(50),
    admin
      .from("phone_on_call_assignments")
      .select("id,role_key,display_label,team_member_id,destination_ref,provider,effective_from,version,change_reason,updated_at")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .is("effective_to", null)
      .order("role_key"),
    admin.from("phone_alert_policies").select("*").eq("tenant_id", tenantId).maybeSingle(),
    admin
      .from("communication_endpoints")
      .select("id,endpoint_kind,normalized_value,display_value,provider,provider_external_ref,is_shared")
      .eq("tenant_id", tenantId)
      .eq("channel", "phone")
      .eq("status", "active")
      .in("endpoint_kind", ["ddi", "extension", "sip"])
      .order("display_value"),
  ]);
  const error =
    health.error ?? alerts.error ?? assignments.error ?? policy.error ?? destinations.error;
  if (error) return failResponse("db_error", error.message, 500);
  return jsonResponse({
    success: true,
    health: health.data ?? [],
    alerts: alerts.data ?? [],
    assignments: assignments.data ?? [],
    policy: policy.data ?? null,
    destinations: destinations.data ?? [],
  });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);
  const admin = createSupabaseAdmin();
  if (!admin) return failResponse("config_error", "Supabase admin client is not configured", 500);

  if (req.headers.has("x-phone-provider")) return webhook(req, admin);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);

  let body: Record<string, unknown>;
  try {
    body = await parseBody(req);
  } catch {
    return failResponse("invalid_json", "Body must be JSON", 400);
  }
  const action = text(body.action) ?? "status";
  if (action === "status") return status(admin, auth.ctx.tenantId);

  if (!["owner", "admin"].includes(auth.ctx.role)) {
    return failResponse("forbidden", "Owner or admin access is required", 403);
  }

  if (action === "set_on_call") {
    const roleKey = text(body.role_key);
    const displayLabel = text(body.display_label);
    const destinationRef = text(body.destination_ref);
    const provider = text(body.provider);
    const reason = text(body.reason);
    if (!roleKey || !displayLabel || !destinationRef || !provider || !reason) {
      return failResponse(
        "invalid_assignment",
        "role_key, display_label, destination_ref, provider and reason are required",
        400,
      );
    }
    const { data, error } = await admin.rpc("phone_operations_set_on_call", {
      p_tenant_id: auth.ctx.tenantId,
      p_actor_user_id: auth.ctx.userId,
      p_actor_label: auth.ctx.email ?? auth.ctx.userId,
      p_role_key: roleKey,
      p_display_label: displayLabel,
      p_team_member_id: text(body.team_member_id),
      p_destination_ref: destinationRef,
      p_provider: provider,
      p_reason: reason,
      p_metadata: record(body.metadata),
    });
    if (error) return failResponse("assignment_failed", error.message, 400);
    return jsonResponse({ success: true, assignment: data });
  }

  if (action === "update_policy") {
    const allowed = {
      tenant_id: auth.ctx.tenantId,
      enabled: body.enabled === true,
      slack_enabled: body.slack_enabled === true,
      email_enabled: body.email_enabled === true,
      escalation_enabled: body.escalation_enabled === true,
      consecutive_failures: Number(body.consecutive_failures ?? 2),
      reminder_minutes: Number(body.reminder_minutes ?? 15),
      daily_digest_time: text(body.daily_digest_time) ?? "08:00",
      timezone: text(body.timezone) ?? "Europe/London",
      non_secret_config: record(body.non_secret_config),
    };
    const { data, error } = await admin
      .from("phone_alert_policies")
      .upsert(allowed, { onConflict: "tenant_id" })
      .select("*")
      .single();
    if (error) return failResponse("policy_update_failed", error.message, 400);
    return jsonResponse({ success: true, policy: data });
  }

  if (action === "acknowledge_alert") {
    const id = text(body.id);
    if (!id) return failResponse("invalid_alert", "id is required", 400);
    const { error } = await admin
      .from("phone_alert_events")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: auth.ctx.userId,
      })
      .eq("tenant_id", auth.ctx.tenantId)
      .eq("id", id)
      .eq("status", "open");
    if (error) return failResponse("alert_update_failed", error.message, 400);
    return jsonResponse({ success: true });
  }

  return failResponse("invalid_action", `Unknown action: ${action}`, 400);
});
