// ServiceOS — Edge Function: simwood-test-connection (Phase Phone-0)
//
// Verifies that the configured Simwood/Sipcentric credentials can reach the
// provider API, and returns SAFE account metadata only. Credentials are read
// from Supabase secrets server-side and are NEVER returned to the caller.
//
// Runtime: Supabase Edge Functions (Deno). Imports are URL-based and do NOT
// touch the project's npm dependencies / lockfile.
//
// Behaviour:
//   * POST { tenant_id: uuid }
//   * Reads SIMWOOD_USERNAME / SIMWOOD_PASSWORD from secrets (Basic Auth).
//   * Calls GET https://pbx.sipcentric.com/api/v1/customers.
//   * Returns { ok, data:{ provider, customers:[{id,name,type}], customerCount } }.
//   * Logs the outcome to phone_sync_runs AND audit_logs.
//   * Handles invalid input, missing config, auth failure, rate limiting and
//     network failure with distinct, safe error codes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SIMWOOD_API_BASE = "https://pbx.sipcentric.com/api/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function fail(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return json({ ok: false, error: { code, message, ...extra } }, status);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST", 405);

  const startedAt = new Date().toISOString();

  // --- input validation ---------------------------------------------------
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return fail("invalid_json", "Request body must be valid JSON", 400);
  }
  const tenantId = (parsed as { tenant_id?: unknown } | null)?.tenant_id;
  if (typeof tenantId !== "string" || !UUID_RE.test(tenantId)) {
    return fail("invalid_tenant_id", "tenant_id is required and must be a UUID", 400);
  }
  // Optional: when supplied, verify a specific account (/customers/{id});
  // otherwise fall back to the /customers collection for discovery.
  const rawCustomerId = (parsed as { provider_customer_id?: unknown } | null)?.provider_customer_id;
  const providerCustomerId =
    typeof rawCustomerId === "string" && rawCustomerId.trim() !== "" ? rawCustomerId.trim() : null;

  // --- environment ---------------------------------------------------------
  const username = Deno.env.get("SIMWOOD_USERNAME");
  const password = Deno.env.get("SIMWOOD_PASSWORD");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  // Best-effort logging to phone_sync_runs + audit_logs. Never throws.
  async function logOutcome(
    status: "success" | "failed",
    recordsProcessed: number,
    errorMessage: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!supabase) return;
    try {
      await supabase.from("phone_sync_runs").insert({
        tenant_id: tenantId,
        provider: "simwood",
        sync_type: "test_connection",
        status,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        records_processed: recordsProcessed,
        error_message: errorMessage,
        metadata,
      });
      await supabase.from("audit_logs").insert({
        tenant_id: tenantId,
        actor: "edge:simwood-test-connection",
        action: "simwood.test_connection",
        resource_type: "phone_account",
        status,
        detail: metadata,
      });
    } catch (_logErr) {
      // Logging must never mask the real result; swallow.
    }
  }

  if (!username || !password) {
    await logOutcome("failed", 0, "Missing SIMWOOD_USERNAME/SIMWOOD_PASSWORD secret", {
      reason: "config",
    });
    return fail("config_error", "Simwood credentials are not configured", 500);
  }

  // --- call provider -------------------------------------------------------
  const authHeader = "Basic " + btoa(`${username}:${password}`);
  const path = providerCustomerId
    ? `/customers/${encodeURIComponent(providerCustomerId)}`
    : "/customers";
  let resp: Response;
  try {
    resp = await fetch(`${SIMWOOD_API_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "network failure";
    await logOutcome("failed", 0, `network: ${message}`, { reason: "network" });
    return fail("network_error", "Could not reach the Simwood API", 502);
  }

  if (resp.status === 429) {
    const reset = resp.headers.get("X-RateLimit-Reset");
    await logOutcome("failed", 0, "rate limited", { reason: "rate_limit", reset });
    return fail("rate_limited", "Simwood API rate limit reached", 429, { retryAfter: reset });
  }
  if (resp.status === 401 || resp.status === 403) {
    await logOutcome("failed", 0, `auth ${resp.status}`, {
      reason: "auth",
      status: resp.status,
      provider_customer_id: providerCustomerId,
    });
    return fail(
      "auth_failed",
      "Simwood authentication failed — invalid credentials or insufficient API permission",
      401,
    );
  }
  if (!resp.ok) {
    await logOutcome("failed", 0, `upstream ${resp.status}`, {
      reason: "upstream",
      status: resp.status,
    });
    return fail("upstream_error", `Simwood API returned an error (${resp.status})`, 502);
  }

  let payload: unknown;
  try {
    payload = await resp.json();
  } catch {
    await logOutcome("failed", 0, "unparseable response", { reason: "parse" });
    return fail("parse_error", "Unexpected response from the Simwood API", 502);
  }

  // --- safe metadata only (whitelist; never echo credentials) --------------
  const rows =
    payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [payload];

  const customers = rows
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((c) => ({
      id: (c.id ?? c.customerId ?? null) as string | null,
      name: (c.name ?? c.shortName ?? null) as string | null,
      type: (c.type ?? null) as string | null,
    }));

  await logOutcome("success", customers.length, null, { customerCount: customers.length });

  return json(
    { ok: true, data: { provider: "simwood", customers, customerCount: customers.length } },
    200,
  );
});
