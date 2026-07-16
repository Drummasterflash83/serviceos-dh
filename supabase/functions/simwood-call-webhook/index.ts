// ServiceOS — Edge Function: simwood-call-webhook (Live Call Card v1)
//
// Receives real-time call events (ringing/answered/completed/…) and turns them
// into a live_call_session assigned to the mapped user, so the Live Call Card can
// surface to ONLY that logged-in user. Sipcentric's webhook payload shape isn't
// documented in-repo, so this is a FLEXIBLE receiver: it accepts many field-name
// variants and normalises them (see normalise()).
//
// Auth: NO user JWT. A shared secret header `x-simwood-webhook-secret` must match
// SIMWOOD_WEBHOOK_SECRET — arbitrary unauthenticated writes are rejected. Tenant is
// resolved server-side from connector config (never trusted from the payload). No
// secrets are logged.
//
// Runtime: Supabase Edge Functions (Deno). Deploy with verify_jwt=false.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, createSupabaseAdmin, jsonResponse, PROVIDER } from "../_shared/simwood.ts";
import { resolveWebhookTenant, type WebhookTenantResolution } from "../_shared/webhook_tenant.ts";

type Admin = SupabaseClient;

function fail(code: string, message: string, status: number): Response {
  return jsonResponse({ success: false, error: { code, message } }, status);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/** First present string among several candidate keys. */
function pick(body: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = str(body[k]);
    if (v) return v;
  }
  return null;
}

/** Map any of several raw event/status words to a canonical event_type. */
function normaliseEvent(raw: string | null): string {
  const e = (raw ?? "").toLowerCase();
  if (["initiated", "start", "started", "new"].includes(e)) return "initiated";
  if (["ringing", "ring", "alerting"].includes(e)) return "ringing";
  if (["answered", "answer", "connected", "inprogress", "in_progress"].includes(e))
    return "answered";
  if (["completed", "complete", "ended", "hangup", "finished"].includes(e)) return "completed";
  if (["missed", "noanswer", "no_answer", "abandoned"].includes(e)) return "missed";
  if (["failed", "error", "busy", "rejected"].includes(e)) return "failed";
  return e || "ringing";
}

interface Normalised {
  providerCallId: string;
  eventType: string;
  caller: string | null;
  callee: string | null;
  extension: string | null;
  direction: string | null;
  occurredAt: string;
  customerId: string | null;
}

function normalise(body: Record<string, unknown>): Normalised | null {
  const providerCallId = pick(body, ["provider_call_id", "call_id", "callId", "linkedId", "id"]);
  if (!providerCallId) return null;
  const occurredRaw = pick(body, ["occurred_at", "timestamp", "time", "created", "callStarted"]);
  const parsed = occurredRaw ? Date.parse(occurredRaw) : NaN;
  const occurredAt = Number.isNaN(parsed)
    ? new Date().toISOString()
    : new Date(parsed).toISOString();
  return {
    providerCallId,
    eventType: normaliseEvent(pick(body, ["event_type", "event", "status", "state"])),
    caller: pick(body, ["caller_number", "from", "caller", "cli", "source"]),
    callee: pick(body, ["callee_number", "to", "callee", "destination", "did"]),
    extension: pick(body, ["extension", "ext", "endpoint", "agent"]),
    direction: pick(body, ["direction"]),
    occurredAt,
    customerId: pick(body, ["customer_id", "customerId", "account", "account_id"]),
  };
}

/** Resolve the tenant from connector config; never trust or default from payload. */
async function resolveTenant(
  admin: Admin,
  customerId: string | null,
): Promise<WebhookTenantResolution> {
  const { data: tcs } = await admin
    .from("tenant_connectors")
    .select("id, tenant_id")
    .eq("connector_id", PROVIDER)
    .eq("enabled", true);
  const rows = (tcs ?? []) as { id: string; tenant_id: string }[];
  const ids = rows.map((r) => r.id);
  const { data: accts } = ids.length
    ? await admin
        .from("connector_accounts")
        .select("tenant_connector_id, account_key, settings")
        .in("tenant_connector_id", ids)
        .eq("status", "active")
    : { data: [] };
  return resolveWebhookTenant({
    customerId,
    connectors: rows.map((r) => ({ id: r.id, tenantId: r.tenant_id })),
    accounts: ((accts ?? []) as Record<string, unknown>[]).map((a) => ({
      connectorId: a.tenant_connector_id as string,
      accountKey: str(a.account_key),
      providerCustomerId: str((a.settings as Record<string, unknown> | null)?.provider_customer_id),
    })),
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Evidence-led matching: exact caller-number history only. No fake person match. */
async function buildMatch(
  admin: Admin,
  tenantId: string,
  caller: string | null,
): Promise<{
  matchStatus: string;
  confidence: number;
  evidence: unknown[];
  personId: string | null;
}> {
  const evidence: unknown[] = [];
  if (!caller) return { matchStatus: "unmatched", confidence: 0, evidence, personId: null };

  // Prior calls from/to this number.
  const { count: priorCalls } = await admin
    .from("phone_calls")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .or(`from_number.eq.${caller},to_number.eq.${caller}`);
  if (priorCalls && priorCalls > 0) {
    evidence.push({
      type: "prior_calls",
      detail: `${priorCalls} previous call(s) from this number`,
      count: priorCalls,
    });
  }

  // Prior interactions (calls/emails linked to this number).
  const { count: priorInteractions } = await admin
    .from("interactions")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .or(`phone_from.eq.${caller},phone_to.eq.${caller}`);
  if (priorInteractions && priorInteractions > 0) {
    evidence.push({
      type: "prior_interactions",
      detail: `${priorInteractions} previous interaction(s) with this number`,
      count: priorInteractions,
    });
  }

  // A real person record by exact phone (people table may be empty in v1).
  let personId: string | null = null;
  const { data: person } = await admin
    .from("people")
    .select("id, display_name")
    .eq("tenant_id", tenantId)
    .eq("primary_phone", caller)
    .limit(1)
    .maybeSingle();
  if (person?.id) {
    personId = person.id as string;
    evidence.push({
      type: "person_phone",
      detail: "Exact phone match to a known person",
      person_id: personId,
    });
  }

  // Levels: person match ⇒ likely; known-number history ⇒ possible; else unmatched.
  // "confirmed" is only ever set by an explicit user action, never here.
  if (personId) return { matchStatus: "likely", confidence: 70, evidence, personId };
  if (evidence.length > 0)
    return { matchStatus: "possible", confidence: 40, evidence, personId: null };
  return { matchStatus: "unmatched", confidence: 0, evidence, personId: null };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const expected = Deno.env.get("SIMWOOD_WEBHOOK_SECRET");
  if (!expected) return fail("config_error", "SIMWOOD_WEBHOOK_SECRET is not configured", 500);
  const provided = req.headers.get("x-simwood-webhook-secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return fail("forbidden", "Invalid or missing x-simwood-webhook-secret", 403);
  }

  const admin = createSupabaseAdmin();
  if (!admin) return fail("config_error", "Supabase admin client is not configured", 500);

  let raw: Record<string, unknown>;
  try {
    raw = ((await req.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return fail("invalid_json", "Body must be JSON", 400);
  }

  const n = normalise(raw);
  if (!n) return fail("invalid_payload", "Could not resolve a call id from the payload", 400);

  const payloadText = JSON.stringify(raw);
  const payloadHash = await sha256(payloadText);
  const deliveryKey = await sha256(
    [n.providerCallId, n.eventType, n.occurredAt, payloadHash].join("\n"),
  );
  const resolution = await resolveTenant(admin, n.customerId);
  if (resolution.kind === "quarantine") {
    const { error } = await admin.rpc("quarantine_inbound_webhook", {
      p_provider: PROVIDER,
      p_delivery_key: deliveryKey,
      p_provider_call_id: n.providerCallId,
      p_provider_customer_id: n.customerId,
      p_reason_code: resolution.reason,
      p_occurred_at: n.occurredAt,
      p_payload: raw,
      p_payload_sha256: payloadHash,
    });
    if (error) return fail("quarantine_failed", "Could not quarantine webhook delivery", 500);
    return jsonResponse(
      {
        success: true,
        accepted: false,
        quarantined: true,
        reason: resolution.reason,
        delivery_key: deliveryKey,
      },
      202,
    );
  }
  const tenantId = resolution.tenantId;

  // 2) Assign to the user mapped to this extension (Mary → 102).
  let assignedUserId: string | null = null;
  if (n.extension) {
    const { data: endpoint } = await admin
      .from("user_voice_endpoints")
      .select("user_id")
      .eq("tenant_id", tenantId)
      .eq("provider", PROVIDER)
      .eq("extension", n.extension)
      .eq("enabled", true)
      .limit(1)
      .maybeSingle();
    assignedUserId = (endpoint?.user_id as string | undefined) ?? null;
  }

  // 3) Evidence-led matching (only for live/inbound-relevant events).
  const match = await buildMatch(admin, tenantId, n.caller);

  // Persist immutable event + conditionally advance the session in one transaction.
  const { data: ingestRows, error: ingestErr } = await admin.rpc("ingest_live_call_webhook", {
    p_tenant_id: tenantId,
    p_provider: PROVIDER,
    p_delivery_key: deliveryKey,
    p_provider_call_id: n.providerCallId,
    p_event_type: n.eventType,
    p_caller_number: n.caller,
    p_callee_number: n.callee,
    p_extension: n.extension,
    p_direction: n.direction,
    p_occurred_at: n.occurredAt,
    p_raw_payload: raw,
    p_assigned_user_id: assignedUserId,
    p_match_status: match.matchStatus,
    p_matched_person_id: match.personId,
    p_confidence: match.confidence,
    p_evidence: match.evidence,
  });
  if (ingestErr) return fail("db_error", "Could not ingest live call event", 500);
  const ingest = (ingestRows ?? [])[0] as
    { duplicate?: boolean; session_updated?: boolean } | undefined;

  return jsonResponse({
    success: true,
    provider_call_id: n.providerCallId,
    event_type: n.eventType,
    duplicate: !!ingest?.duplicate,
    session_updated: !!ingest?.session_updated,
    assigned: Boolean(assignedUserId),
    match_status: match.matchStatus,
  });
});
