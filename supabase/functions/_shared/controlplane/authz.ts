// ServiceOS — OpenFolk Control Plane: platform-operator authorization.
//
// Platform authority is DECOUPLED from profiles.role (see migration
// 20260822120000_platform_authority_decoupled_from_role.sql): access requires an
// authenticated user, an EXISTING profile, and an ACTIVE platform.controlplane grant
// (admin ⇒ view). profiles.role is tenant-facing only, so a tenant `owner` can hold
// platform authority without surrendering their tenant role. A platform grant confers
// Control Plane access ONLY — never tenant data access (is_openfolk() is untouched).
// Reads require view; writes require admin AND no active View-As context (View-As can
// never configure). Machine callers (discovery workers) use a DEDICATED Control Plane
// secret (OPENFOLK_CONTROLPLANE_KEY) in the x-openfolk-machine-key header plus an explicit
// x-openfolk-actor — never the Supabase service-role key.
// The real authenticated actor is always retained. Machine callers (discovery workers)
// use the service-role key plus an explicit x-openfolk-actor header.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { getBearerToken } from "../authz.ts";

export interface PlatformCtx {
  userId: string;
  actor: string; // real actor (email|id|machine label) — never a View-As subject
  role: string;
  isAdmin: boolean;
  viewAsActive: boolean;
}
export interface PlatformError {
  code: string;
  message: string;
  httpStatus: number;
}
export type PlatformResult = { ok: true; ctx: PlatformCtx } | { ok: false; error: PlatformError };

export interface ActiveGrant {
  permission: string;
  effective_from?: string | null;
  effective_to?: string | null;
}

/** PURE decision: given role, grants, whether a write is requested, and View-As state,
 * decide access. Returns a granted context patch or a typed error. Deterministic. */
export function decidePlatformAccess(input: {
  /** Tenant-facing role, informational only — it NEVER decides platform access. */
  role: string | null;
  /** A profile row exists for the authenticated user. */
  profileExists: boolean;
  grants: ActiveGrant[];
  requireAdmin: boolean;
  viewAsActive: boolean;
  nowMs: number;
}):
  | { allow: true; isAdmin: boolean }
  | { allow: false; code: string; message: string; httpStatus: number } {
  if (!input.profileExists) {
    return {
      allow: false,
      code: "forbidden",
      message: "No profile for the authenticated user",
      httpStatus: 403,
    };
  }
  const active = input.grants.filter((g) => {
    const from = g.effective_from ? Date.parse(g.effective_from) : -Infinity;
    const to = g.effective_to ? Date.parse(g.effective_to) : Infinity;
    return from <= input.nowMs && input.nowMs < to;
  });
  const isAdmin = active.some((g) => g.permission === "platform.controlplane.admin");
  const hasView = isAdmin || active.some((g) => g.permission === "platform.controlplane.view");
  if (!hasView) {
    return {
      allow: false,
      code: "forbidden",
      message: "No active platform.controlplane grant",
      httpStatus: 403,
    };
  }
  if (input.requireAdmin && !isAdmin) {
    return {
      allow: false,
      code: "forbidden",
      message: "platform.controlplane.admin is required to configure",
      httpStatus: 403,
    };
  }
  if (input.requireAdmin && input.viewAsActive) {
    // View-As can NEVER carry configuration authority (mirrors the work-transition block).
    return {
      allow: false,
      code: "read_only_view_active",
      message: "Exit your View-As context before configuring the Control Plane",
      httpStatus: 409,
    };
  }
  return { allow: true, isAdmin };
}

/**
 * Constant-time comparison of a provided machine key against the configured dedicated
 * secret. Fails closed when either is missing (so an unset OPENFOLK_CONTROLPLANE_KEY
 * disables machine mode) or the lengths differ. This is a dedicated per-function secret,
 * never the Supabase service-role/publishable key — so a service-role or publishable key
 * presented here does not authenticate.
 */
export function verifyMachineKey(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

const err = (code: string, message: string, httpStatus: number): PlatformResult => ({
  ok: false,
  error: { code, message, httpStatus },
});

/** Authenticate + authorize a platform operator against the real actor. */
export async function requirePlatformOperator(
  req: Request,
  admin: SupabaseClient,
  opts: { requireAdmin?: boolean } = {},
): Promise<PlatformResult> {
  const requireAdmin = opts.requireAdmin === true;
  const now = Date.now();

  // ── Machine/internal path (discovery workers) ────────────────────────────
  // A DEDICATED Control Plane secret in the x-openfolk-machine-key header — NEVER the
  // Supabase service-role key (reusing it broke on the project's API-key rotation and
  // conflated DB access with a caller credential). Validated constant-time against
  // OPENFOLK_CONTROLPLANE_KEY, a secret scoped to this function. Fails closed when the
  // secret is unset, the key is wrong, or the actor label is missing. Checked before the
  // user path so a machine caller needs no user JWT.
  const machineKey = req.headers.get("x-openfolk-machine-key");
  if (machineKey !== null) {
    if (!verifyMachineKey(machineKey, Deno.env.get("OPENFOLK_CONTROLPLANE_KEY"))) {
      return err("invalid_machine_key", "Invalid Control Plane machine key", 401);
    }
    const actor = req.headers.get("x-openfolk-actor");
    if (!actor)
      return err("forbidden", "Internal Control Plane call missing x-openfolk-actor", 403);
    return {
      ok: true,
      ctx: { userId: "machine", actor, role: "machine", isAdmin: true, viewAsActive: false },
    };
  }

  // ── Interactive user path (unchanged authority model) ────────────────────
  const token = getBearerToken(req);
  if (!token) return err("missing_auth", "Missing bearer token", 401);

  let userId: string;
  let email: string | null;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return err("invalid_auth", "Invalid or expired session", 401);
    userId = data.user.id;
    email = data.user.email ?? null;
  } catch {
    return err("invalid_auth", "Could not verify session", 401);
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  const { data: grants } = await admin
    .from("platform_authority_grants")
    .select("permission, effective_from, effective_to")
    .eq("profile_id", userId);

  // Active View-As context for the real actor?
  let viewAsActive = false;
  const { data: va } = await admin
    .from("view_as_context")
    .select("id, expires_at")
    .eq("actor_user_id", userId)
    .is("ended_at", null)
    .maybeSingle();
  if (va && (!va.expires_at || Date.parse(va.expires_at as string) > now)) viewAsActive = true;

  const decision = decidePlatformAccess({
    role: (profile?.role as string | undefined) ?? null,
    profileExists: !!profile,
    grants: (grants ?? []) as ActiveGrant[],
    requireAdmin,
    viewAsActive,
    nowMs: now,
  });
  if (!decision.allow) return err(decision.code, decision.message, decision.httpStatus);

  return {
    ok: true,
    ctx: {
      userId,
      actor: email ?? userId,
      // The operator's real tenant-facing role (e.g. 'owner') — platform authority came
      // from the grant, not from this value.
      role: (profile?.role as string | undefined) ?? "unknown",
      isAdmin: decision.isAdmin,
      viewAsActive,
    },
  };
}
