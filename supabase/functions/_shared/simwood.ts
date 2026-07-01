// ServiceOS — shared Simwood/Sipcentric helpers for Edge Functions (Deno).
//
// Reusable building blocks for the Phone Input functions: response/CORS
// helpers, input validation, credential loading, a Supabase admin client, and
// a classified GET against the Simwood/Sipcentric v1 API. URL imports only —
// no npm dependencies / lockfile impact.
//
// Base URL, endpoints and rate-limit header per docs/PHONE_INPUT_SIMWOOD_SPEC.md.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const SIMWOOD_API_BASE = "https://pbx.sipcentric.com/api/v1";
export const PROVIDER = "simwood";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/** Flat error envelope: { success:false, error:{ code, message, ...extra } }. */
export function failResponse(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ success: false, error: { code, message }, ...extra }, status);
}

export interface SimwoodCredentials {
  username: string;
  password: string;
}

/** Read Simwood Basic-Auth credentials from Supabase secrets (server-side only). */
export function getSimwoodCredentials(): SimwoodCredentials | null {
  const username = Deno.env.get("SIMWOOD_USERNAME");
  const password = Deno.env.get("SIMWOOD_PASSWORD");
  if (!username || !password) return null;
  return { username, password };
}

export function basicAuthHeader(creds: SimwoodCredentials): string {
  return "Basic " + btoa(`${creds.username}:${creds.password}`);
}

/** Service-role Supabase client (bypasses RLS). Null if env is missing. */
export function createSupabaseAdmin(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
}

/** Coerce common list-wrapper shapes into an array of records. */
export function extractItems(payload: unknown): Record<string, unknown>[] {
  const raw =
    payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : Array.isArray(payload)
        ? (payload as unknown[])
        : [payload];
  return raw.filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object");
}

export type SimwoodGetResult =
  | { ok: true; data: unknown; headers: Headers }
  | {
      ok: false;
      code: string;
      message: string;
      httpStatus: number;
      extra?: Record<string, unknown>;
    };

/**
 * GET a Simwood API path (relative to the base) with Basic Auth, classifying
 * the common failure modes into stable codes: network_error, rate_limited,
 * auth_failed, upstream_error, parse_error.
 */
export async function simwoodGet(
  path: string,
  creds: SimwoodCredentials,
): Promise<SimwoodGetResult> {
  let resp: Response;
  try {
    resp = await fetch(`${SIMWOOD_API_BASE}${path}`, {
      method: "GET",
      headers: { Authorization: basicAuthHeader(creds), Accept: "application/json" },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "network failure";
    return {
      ok: false,
      code: "network_error",
      message: `Could not reach the Simwood API: ${message}`,
      httpStatus: 502,
    };
  }

  if (resp.status === 429) {
    const reset = resp.headers.get("X-RateLimit-Reset");
    return {
      ok: false,
      code: "rate_limited",
      message: "Simwood API rate limit reached",
      httpStatus: 429,
      extra: { retryAfter: reset },
    };
  }
  if (resp.status === 401 || resp.status === 403) {
    return {
      ok: false,
      code: "auth_failed",
      message: "Simwood authentication failed — check credentials",
      httpStatus: 401,
    };
  }
  if (!resp.ok) {
    return {
      ok: false,
      code: "upstream_error",
      message: `Simwood API returned an error (${resp.status})`,
      httpStatus: 502,
    };
  }

  try {
    return { ok: true, data: await resp.json(), headers: resp.headers };
  } catch {
    return {
      ok: false,
      code: "parse_error",
      message: "Unexpected response from the Simwood API",
      httpStatus: 502,
    };
  }
}

/** Resolve the account/customer id via GET /customers (used when not supplied). */
export async function discoverCustomerId(
  creds: SimwoodCredentials,
): Promise<
  | { ok: true; customerId: string }
  | { ok: false; code: string; message: string; httpStatus: number }
> {
  const result = await simwoodGet("/customers", creds);
  if (!result.ok) return result;
  const first = extractItems(result.data)[0];
  const id = first?.id ?? first?.customerId;
  if (id === undefined || id === null || id === "") {
    return {
      ok: false,
      code: "no_customer",
      message: "No Simwood customer found for these credentials",
      httpStatus: 502,
    };
  }
  return { ok: true, customerId: String(id) };
}
