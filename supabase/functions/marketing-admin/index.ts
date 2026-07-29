// ServiceOS — Edge Function: marketing-admin (OWNER/ADMIN-ONLY administration).
//
// Settings, lifecycle-stage administration, Marketing access administration and
// the tenant Marketing audit view. A THIN shell: every mutation is a
// service-role-only SQL RPC (migration 20260831120000); tenant and actor come
// from the authenticated server context only.
//
// AUTHORITY: requireTenantUser restricts every action to owner/admin ROLES;
// the RPCs additionally require effective marketing.access.manage through the
// canonical resolver — EXCEPT when the tenant has disabled Marketing, where the
// owner/admin role alone suffices (the governed re-enable path; anything
// stricter would make disabling the module an unrecoverable lockout).
//
// Actions:
//   settings_get | settings_update | history_list
//   lifecycle  (op: add|rename|set_tone|set_terminal|set_default|reorder|
//               retire|retire_preview|reactivate)
//   access_overview | access_set
//   audit_list
//
// ERROR CONTRACT (stable, no raw DB messages): INVALID_REQUEST / NOT_FOUND /
// FORBIDDEN / VERSION_CONFLICT / LOCKOUT / INTERNAL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
const isPlainObject = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function mapDbError(err: { code?: string; message?: string } | null): Response {
  switch (err?.code ?? "") {
    case "MK409":
      return fail("VERSION_CONFLICT", "The record changed elsewhere — reload and retry", 409);
    case "MK423":
      return fail("LOCKOUT", "This change would remove the last Marketing access manager", 409);
    case "42501":
      return fail("FORBIDDEN", "You do not hold the required Marketing authority", 403);
    case "22023":
    case "22P02":
      return fail("INVALID_REQUEST", "A supplied value is invalid", 400);
    case "P0002":
      return fail("NOT_FOUND", "Record not found", 404);
    case "23505":
      return fail("DUPLICATE", "This value already exists", 409);
    case "23000":
    case "23503":
    case "23514":
      return fail("INVALID_REQUEST", "The change violates a data rule", 400);
    default:
      return fail("INTERNAL", "The operation failed", 500);
  }
}

const LIFECYCLE_OPS = new Set([
  "add",
  "rename",
  "set_tone",
  "set_terminal",
  "set_default",
  "reorder",
  "retire",
  "retire_preview",
  "reactivate",
]);

// Per-action top-level key allowlists: unknown keys are rejected, never ignored.
const ACTION_KEYS: Record<string, string[]> = {
  settings_get: ["action"],
  settings_update: ["action", "changes", "expected_version"],
  history_list: ["action", "limit"],
  lifecycle: ["action", "op", "args"],
  lifecycle_list: ["action"],
  access_overview: ["action"],
  access_set: ["action", "profile_id", "permission", "mode", "expected"],
  audit_list: ["action", "limit", "action_prefix", "cursor"],
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("INVALID_REQUEST", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("INTERNAL", "Service is not configured", 500);

  // owner/admin ROLE is the outer gate for every administration action
  const auth = await requireTenantUser(req, admin, ["owner", "admin"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId } = auth.ctx;
  if (userId === "service") {
    return fail("INVALID_REQUEST", "marketing-admin is a user-facing endpoint", 400);
  }

  let body: Row = {};
  try {
    const parsed = (await req.json()) as unknown;
    if (!isPlainObject(parsed)) {
      return fail("INVALID_REQUEST", "Request body must be a JSON object", 400);
    }
    body = parsed;
  } catch {
    // malformed JSON is a 400 — never silently treated as an empty read request
    return fail("INVALID_REQUEST", "Request body must be valid JSON", 400);
  }
  if (body.action !== undefined && typeof body.action !== "string") {
    return fail("INVALID_REQUEST", "action must be a string", 400);
  }
  const action = (body.action as string | undefined) ?? "settings_get";
  const allowedKeys = ACTION_KEYS[action];
  if (!allowedKeys) return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
  for (const k of Object.keys(body)) {
    if (!allowedKeys.includes(k))
      return fail("INVALID_REQUEST", `unknown key '${k}' for action '${action}'`, 400);
  }

  // A REJECTED sensitive administration attempt is audited from here (a
  // separate statement AFTER the failed transaction, so the rejection audit
  // can never be rolled back with it). Safe detail only — no payloads.
  async function auditRejected(auditAction: string, code: string, detail: Row) {
    try {
      await writeAudit(admin!, {
        tenantId,
        actor: auth.ok ? (auth.ctx.email ?? userId) : userId,
        action: auditAction,
        resourceType: "marketing_admin",
        resourceId: String(detail.resource_id ?? action),
        status: "denied",
        detail: { code, ...detail },
      });
    } catch {
      // auditing a rejection must never mask the rejection itself
    }
  }

  try {
    switch (action) {
      case "settings_get": {
        const r = await admin
          .from("marketing_settings")
          .select("*")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (r.error) return fail("INTERNAL", "Could not load settings", 500);
        return json({ ok: true, data: { settings: r.data } });
      }
      case "settings_update": {
        if (!isPlainObject(body.changes))
          return fail("INVALID_REQUEST", "changes must be an object", 400);
        if (!Number.isInteger(body.expected_version))
          return fail("INVALID_REQUEST", "expected_version is required", 400);
        const r = await admin.rpc("marketing_update_settings", {
          p_tenant: tenantId,
          p_actor: userId,
          p_changes: body.changes,
          p_expected_version: body.expected_version,
        });
        if (r.error) {
          if (["42501", "MK409"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.settings.update_rejected", r.error.code ?? "", {
              changed_keys: Object.keys(body.changes as Row),
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "history_list": {
        const limit = Number.isInteger(body.limit)
          ? Math.min(Math.max(body.limit as number, 1), 50)
          : 25;
        const r = await admin
          .from("marketing_settings_history")
          .select("id,version,snapshot,changed,changed_by,created_at")
          .eq("tenant_id", tenantId)
          .order("version", { ascending: false })
          .limit(limit);
        if (r.error) return fail("INTERNAL", "Could not load history", 500);
        return json({ ok: true, data: { history: r.data ?? [] } });
      }
      case "lifecycle": {
        const op = String(body.op ?? "");
        if (!LIFECYCLE_OPS.has(op)) return fail("INVALID_REQUEST", "unknown lifecycle op", 400);
        if (!isPlainObject(body.args))
          return fail("INVALID_REQUEST", "args must be an object", 400);
        const r = await admin.rpc("marketing_lifecycle_admin", {
          p_tenant: tenantId,
          p_actor: userId,
          p_op: op,
          p_args: body.args,
        });
        if (r.error) {
          if (
            ["retire", "set_default", "reorder"].includes(op) &&
            ["42501", "MK409"].includes(r.error.code ?? "")
          ) {
            await auditRejected("marketing.lifecycle.rejected", r.error.code ?? "", { op });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "lifecycle_list": {
        const r = await admin
          .from("marketing_lifecycle_stages")
          .select(
            "id,stage_key,label,tone,sort_order,active,terminal_outcome,is_default,updated_at",
          )
          .eq("tenant_id", tenantId)
          .order("sort_order");
        if (r.error) return fail("INTERNAL", "Could not load stages", 500);
        return json({ ok: true, data: { stages: r.data ?? [] } });
      }
      case "access_overview": {
        // RPC gate first: an owner/admin without effective access.manage (and
        // with Marketing enabled) must not read grants.
        const gate = await admin.rpc("marketing_effective_permissions", {
          p_profile_id: userId,
        });
        if (gate.error) return fail("INTERNAL", "Could not resolve access", 500);
        const verdict = gate.data as Row;
        if (
          verdict.enabled === true &&
          !(verdict.permissions as string[]).includes("marketing.access.manage")
        ) {
          return fail("FORBIDDEN", "Requires marketing.access.manage", 403);
        }
        const r = await admin.rpc("marketing_access_overview", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "access_set": {
        if (!isUuid(body.profile_id)) return fail("INVALID_REQUEST", "profile_id required", 400);
        if (typeof body.permission !== "string" || body.permission.length > 60)
          return fail("INVALID_REQUEST", "permission required", 400);
        if (!["grant", "deny", "clear"].includes(body.mode))
          return fail("INVALID_REQUEST", "mode must be grant|deny|clear", 400);
        if (!["granted", "denied", "none"].includes(body.expected))
          return fail("INVALID_REQUEST", "expected state is required", 400);
        const r = await admin.rpc("marketing_access_set", {
          p_tenant: tenantId,
          p_actor: userId,
          p_profile: body.profile_id,
          p_permission: body.permission,
          p_mode: body.mode,
          p_expected: body.expected,
        });
        if (r.error) {
          // rejected access administration is SENSITIVE — audit the denial
          // (restricted/viewer grant refusals, lockout blocks, stale state)
          if (["22023", "42501", "MK409", "MK423"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.access.change_rejected", r.error.code ?? "", {
              resource_id: body.profile_id,
              permission: body.permission,
              mode: body.mode,
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "audit_list": {
        const args: Row = {};
        if (body.limit !== undefined) {
          if (!Number.isInteger(body.limit)) return fail("INVALID_REQUEST", "invalid limit", 400);
          args.limit = body.limit;
        }
        if (body.action_prefix !== undefined) {
          if (typeof body.action_prefix !== "string" || body.action_prefix.length > 60)
            return fail("INVALID_REQUEST", "invalid action_prefix", 400);
          args.action_prefix = body.action_prefix;
        }
        // TRUE keyset cursor: EXACTLY {t, id} — unknown nested keys are
        // rejected, never silently normalized away
        if (body.cursor !== undefined && body.cursor !== null) {
          const c = body.cursor as Row;
          if (
            !isPlainObject(c) ||
            Object.keys(c).length !== 2 ||
            typeof c.t !== "string" ||
            Number.isNaN(Date.parse(c.t)) ||
            !isUuid(c.id)
          )
            return fail("INVALID_REQUEST", "invalid audit cursor", 400);
          args.cursor = { t: c.t, id: c.id };
        }
        const r = await admin.rpc("marketing_audit_list", {
          p_tenant: tenantId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch {
    return fail("INTERNAL", "The operation failed", 500);
  }
});
