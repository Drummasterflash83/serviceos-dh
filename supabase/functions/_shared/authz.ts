// ServiceOS — shared Edge Function authorization (Deno).
//
// Verifies the caller's Supabase Auth JWT, loads their profile, and binds the
// tenant server-side. Functions MUST NOT trust a client-supplied tenant_id —
// use the returned ctx.tenantId, and (optionally) assertSameTenant() to reject
// a mismatched body value.
//
// Stable error codes: missing_auth, invalid_auth, profile_not_found,
// tenant_mismatch, forbidden.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type Role = "owner" | "admin" | "ops" | "viewer";
const ROLES: Role[] = ["owner", "admin", "ops", "viewer"];

export interface AuthContext {
  userId: string;
  email: string | null;
  tenantId: string;
  role: Role;
}

export interface AuthzError {
  code: string;
  message: string;
  httpStatus: number;
}

export type AuthzResult = { ok: true; ctx: AuthContext } | { ok: false; error: AuthzError };

function authzError(code: string, message: string, httpStatus: number): AuthzError {
  return { code, message, httpStatus };
}

/** Extract the raw bearer token from a request, or null. */
export function getBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/**
 * Verify the bearer JWT, load the profile, enforce role, and require a tenant.
 * `supabaseAdmin` must be a service-role client (used to verify the token and
 * read the profile). Returns a bound AuthContext or a typed error.
 */
export async function requireTenantUser(
  req: Request,
  supabaseAdmin: SupabaseClient,
  allowedRoles?: Role[],
): Promise<AuthzResult> {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false, error: authzError("missing_auth", "Missing bearer token", 401) };
  }

  let userId: string;
  let email: string | null;
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return { ok: false, error: authzError("invalid_auth", "Invalid or expired session", 401) };
    }
    userId = data.user.id;
    email = data.user.email ?? null;
  } catch {
    return { ok: false, error: authzError("invalid_auth", "Could not verify session", 401) };
  }

  const { data: profile, error: pErr } = await supabaseAdmin
    .from("profiles")
    .select("tenant_id, role, email")
    .eq("id", userId)
    .maybeSingle();
  if (pErr) {
    return { ok: false, error: authzError("profile_not_found", "Could not load profile", 403) };
  }
  if (!profile) {
    return { ok: false, error: authzError("profile_not_found", "No profile for this user", 403) };
  }

  const role: Role = ROLES.includes(profile.role as Role) ? (profile.role as Role) : "viewer";
  if (allowedRoles && !allowedRoles.includes(role)) {
    return {
      ok: false,
      error: authzError("forbidden", "Your role cannot perform this action", 403),
    };
  }

  const tenantId = (profile.tenant_id as string | null) ?? null;
  if (!tenantId) {
    return { ok: false, error: authzError("forbidden", "No tenant assigned to your profile", 403) };
  }

  return {
    ok: true,
    ctx: { userId, email: email ?? (profile.email as string | null) ?? null, tenantId, role },
  };
}

/**
 * If the request body carries a tenant_id, reject it unless it matches the
 * authenticated profile's tenant. Returns null when there is nothing to check
 * or it matches. Callers should still USE ctx.tenantId for all writes.
 */
export function assertSameTenant(ctx: AuthContext, requestedTenantId: unknown): AuthzError | null {
  if (requestedTenantId === undefined || requestedTenantId === null) return null;
  if (typeof requestedTenantId !== "string" || requestedTenantId !== ctx.tenantId) {
    return authzError("tenant_mismatch", "tenant_id does not match your profile", 403);
  }
  return null;
}
