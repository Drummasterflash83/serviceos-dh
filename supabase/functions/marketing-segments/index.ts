// ServiceOS — Edge Function: marketing-segments (versioned dynamic segments).
//
// A THIN shell over the service-role-only segment RPCs (migration
// 20260831120000). The filter AST is validated IN THE DATABASE against an
// explicit field/operator allowlist with bounded depth/nodes/arrays/strings —
// no raw SQL fragments ever come from the browser, and unsupported concepts
// (campaign engagement, ad attribution, card state) return a clear
// INVALID_REQUEST and stay Preview in the builder.
//
// Actions → required permission (canonical resolver, never re-implemented):
//   list                         → marketing.view
//   create | update | archive |
//   reactivate | evaluate        → marketing.tags.manage  (vocabulary: "Manage
//                                  tags and segments")
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";

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
      return fail("VERSION_CONFLICT", "The segment changed elsewhere — reload and retry", 409);
    case "22023":
    case "22P02":
      // the DB message for unsupported/invalid filters is safe and useful
      return fail("INVALID_REQUEST", err?.message ?? "A supplied value is invalid", 400);
    case "P0002":
      return fail("NOT_FOUND", "Segment not found", 404);
    default:
      return fail("INTERNAL", "The operation failed", 500);
  }
}

const PERMISSION_BY_ACTION: Record<string, string> = {
  list: "marketing.view",
  create: "marketing.tags.manage",
  update: "marketing.tags.manage",
  archive: "marketing.tags.manage",
  reactivate: "marketing.tags.manage",
  evaluate: "marketing.tags.manage",
};

const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && !Number.isNaN(Date.parse(v));

// Per-action top-level and nested key allowlists: unknown keys are rejected.
const ACTION_KEYS: Record<string, string[]> = {
  list: ["action"],
  create: ["action", "args"],
  update: ["action", "args"],
  archive: ["action", "args"],
  reactivate: ["action", "args"],
  evaluate: ["action", "segment_id", "definition", "limit", "cursor", "expected_version"],
};
const ARGS_KEYS: Record<string, string[]> = {
  create: ["name", "description", "definition"],
  update: ["segment_id", "expected_version", "name", "description", "definition"],
  archive: ["segment_id", "expected_updated_at"],
  reactivate: ["segment_id", "expected_updated_at"],
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("INVALID_REQUEST", "Use POST", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const admin = url && key ? createClient(url, key) : null;
  if (!admin) return fail("INTERNAL", "Service is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId } = auth.ctx;
  if (userId === "service") {
    return fail("INVALID_REQUEST", "marketing-segments is a user-facing endpoint", 400);
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
  const action = (body.action as string | undefined) ?? "list";
  const required = PERMISSION_BY_ACTION[action];
  if (!required) return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
  for (const k of Object.keys(body)) {
    if (!ACTION_KEYS[action].includes(k))
      return fail("INVALID_REQUEST", `unknown key '${k}' for action '${action}'`, 400);
  }

  const resolved = await admin.rpc("marketing_effective_permissions", { p_profile_id: userId });
  if (resolved.error || !resolved.data) {
    return fail("INTERNAL", "Could not resolve Marketing access", 500);
  }
  const verdict = resolved.data as Row;
  const permissions: string[] = Array.isArray(verdict.permissions) ? verdict.permissions : [];
  if (verdict.enabled !== true || !permissions.includes("marketing.view")) {
    return fail("FORBIDDEN", "Marketing access required", 403);
  }
  if (!permissions.includes(required)) {
    return fail("FORBIDDEN", `Requires ${required}`, 403);
  }

  try {
    switch (action) {
      case "list": {
        const r = await admin
          .from("marketing_segments")
          .select(
            "id,name,description,definition,definition_version,status,estimated_count,evaluated_at,updated_at",
          )
          .eq("tenant_id", tenantId)
          .order("status")
          .order("name")
          .limit(200);
        if (r.error) return fail("INTERNAL", "Could not load segments", 500);
        return json({ ok: true, data: { segments: r.data ?? [] } });
      }
      case "create":
      case "update":
      case "archive":
      case "reactivate": {
        if (!isPlainObject(body.args))
          return fail("INVALID_REQUEST", "args must be an object", 400);
        for (const k of Object.keys(body.args)) {
          if (!ARGS_KEYS[action].includes(k))
            return fail("INVALID_REQUEST", `unknown args key '${k}' for '${action}'`, 400);
        }
        if (action !== "create" && !isUuid(body.args.segment_id))
          return fail("INVALID_REQUEST", "segment_id required", 400);
        if (action === "update" && !Number.isInteger(body.args.expected_version))
          return fail("INVALID_REQUEST", "invalid expected_version", 400);
        if (
          (action === "archive" || action === "reactivate") &&
          !isIsoDate(body.args.expected_updated_at)
        )
          return fail("INVALID_REQUEST", "expected_updated_at required", 400);
        if (
          (action === "create" || (action === "update" && body.args.definition !== undefined)) &&
          !isPlainObject(body.args.definition)
        )
          return fail("INVALID_REQUEST", "definition must be an object", 400);
        const r = await admin.rpc("marketing_segment_mutate", {
          p_tenant: tenantId,
          p_actor: userId,
          p_op: action,
          p_args: body.args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "evaluate": {
        const args: Row = {};
        if (body.segment_id !== undefined) {
          if (!isUuid(body.segment_id)) return fail("INVALID_REQUEST", "invalid segment_id", 400);
          args.segment_id = body.segment_id;
        }
        if (body.definition !== undefined) {
          if (!isPlainObject(body.definition))
            return fail("INVALID_REQUEST", "definition must be an object", 400);
          args.definition = body.definition;
        }
        if (args.segment_id === undefined && args.definition === undefined)
          return fail("INVALID_REQUEST", "segment_id or definition required", 400);
        if (body.limit !== undefined) {
          if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 50)
            return fail("INVALID_REQUEST", "limit must be an integer 1-50", 400);
          args.limit = body.limit;
        }
        // saved-evaluation VERSION CAPTURE: pin the definition version the
        // caller believes it is evaluating (stale → VERSION_CONFLICT)
        if (body.expected_version !== undefined) {
          if (!Number.isInteger(body.expected_version))
            return fail("INVALID_REQUEST", "invalid expected_version", 400);
          args.expected_version = body.expected_version;
        }
        // strict typed cursor: EXACTLY {v, id} — unknown nested keys are
        // rejected, never silently normalized away
        if (body.cursor !== undefined && body.cursor !== null) {
          const c = body.cursor as Row;
          if (
            !isPlainObject(c) ||
            Object.keys(c).length !== 2 ||
            !isUuid(c.id) ||
            typeof c.v !== "string"
          )
            return fail("INVALID_REQUEST", "invalid cursor", 400);
          args.cursor = { v: c.v, id: c.id };
        }
        const r = await admin.rpc("marketing_segment_evaluate", {
          p_tenant: tenantId,
          p_actor: userId,
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
