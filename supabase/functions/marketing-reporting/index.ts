// ServiceOS — Marketing Reporting & Objectives API (Phase 7).
//
// ONE REPORTING TRUTH: every campaign number this function returns is COMPOSED
// from the canonical per-type report authorities
// (marketing_campaign_report / marketing_sequence_report) — no status truth is
// re-derived here, so totals always reconcile with the existing per-campaign
// drill-downs (recipient/enrolment pages stay on marketing-campaigns and
// marketing-sequences — this surface delegates to them). Unknown/unavailable
// metrics stay null with a reason, never zero.
//
// OBJECTIVES: a Campaign↔Objective link records INTENT through the canonical
// objective_links model (target_kind marketing_campaign). It never fabricates
// contribution: verified contribution is displayed ONLY from the Objective
// engine's own append-only assessments.
//
//   overview / campaign_report / objective_context:  marketing.reporting.view
//   objective_search:                                marketing.view
//   link_objective / unlink_objective:  owner/admin + marketing.campaigns.launch
//
// Stable error contract: INVALID_REQUEST / NOT_FOUND / FORBIDDEN /
// VERSION_CONFLICT / REQUEST_MISMATCH / INTERNAL.

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
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const isPlainObject = (v: unknown): v is Row =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function mapDbError(err: { code?: string; message?: string }): Response {
  switch (err.code) {
    case "MK409":
      return fail("VERSION_CONFLICT", "The record changed since it was read — reload", 409);
    case "MK412":
      return fail("REQUEST_MISMATCH", "That request id was already used differently", 409);
    case "42501":
      return fail("FORBIDDEN", "You do not have permission for that", 403);
    case "22023":
    case "22P02":
      return fail("INVALID_REQUEST", err.message ?? "The request was not valid", 400);
    case "P0002":
      return fail("NOT_FOUND", "Not found", 404);
    case "23505":
      return fail("DUPLICATE", "That record already exists", 409);
    case "23000":
    case "23503":
    case "23514":
      return fail("INVALID_REQUEST", "The request violated a data rule", 400);
    default:
      return fail("INTERNAL", "The operation failed", 500);
  }
}

const ACTION_KEYS: Record<string, string[]> = {
  overview: [
    "action",
    "limit",
    "cursor",
    "campaign_type",
    "status",
    "objective_id",
    "created_from",
    "created_to",
    "search",
  ],
  campaign_report: ["action", "campaign_id"],
  objective_search: ["action", "search", "limit"],
  objective_context: ["action", "campaign_id"],
  link_objective: [
    "action",
    "campaign_id",
    "expected_version",
    "objective_id",
    "relation",
    "expected_contribution",
    "rationale",
    "request_id",
  ],
  unlink_objective: ["action", "campaign_id", "expected_version", "rationale"],
};
const REPORT_ACTIONS = new Set(["overview", "campaign_report", "objective_context"]);
const LINK_ACTIONS = new Set(["link_objective", "unlink_objective"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("INVALID_REQUEST", "Use POST", 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return fail("INTERNAL", "Service is not configured", 500);
  const admin = createClient(supabaseUrl, serviceKey);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops", "viewer"]);
  if (!auth.ok) return fail(auth.error.code, auth.error.message, auth.error.httpStatus);
  const { tenantId, userId } = auth.ctx;
  if (userId === "service") {
    return fail("INVALID_REQUEST", "marketing-reporting is a user-facing endpoint", 400);
  }

  let body: Row;
  try {
    const parsed = await req.json();
    if (!isPlainObject(parsed)) return fail("INVALID_REQUEST", "Body must be an object", 400);
    body = parsed;
  } catch {
    return fail("INVALID_REQUEST", "Body must be valid JSON", 400);
  }
  const action = typeof body.action === "string" ? body.action : "overview";
  const allowed = ACTION_KEYS[action];
  if (!allowed) return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) {
      return fail("INVALID_REQUEST", `unknown key '${k}' for action '${action}'`, 400);
    }
  }

  const perms = await admin.rpc("marketing_effective_permissions", { p_profile_id: userId });
  if (perms.error) return fail("INTERNAL", "Could not resolve permissions", 500);
  const verdict = (perms.data ?? {}) as Row;
  const permissionSet: string[] = Array.isArray(verdict.permissions) ? verdict.permissions : [];
  if (verdict.enabled !== true || !permissionSet.includes("marketing.view")) {
    return fail("FORBIDDEN", "Requires Marketing access", 403);
  }
  if (REPORT_ACTIONS.has(action) && !permissionSet.includes("marketing.reporting.view")) {
    return fail("FORBIDDEN", "Requires marketing.reporting.view", 403);
  }
  if (LINK_ACTIONS.has(action)) {
    if (!["owner", "admin"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Objective linking requires owner/admin", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.launch")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.launch", 403);
    }
  }

  try {
    switch (action) {
      case "overview": {
        const args: Row = {};
        for (const k of [
          "campaign_type",
          "status",
          "objective_id",
          "created_from",
          "created_to",
          "search",
          "cursor",
        ]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        const r = await admin.rpc("marketing_reporting_overview", {
          p_tenant: tenantId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "campaign_report": {
        if (!isUuid(body.campaign_id)) {
          return fail("INVALID_REQUEST", "campaign_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_reporting_campaign", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "objective_search": {
        const args: Row = {};
        if (body.search !== undefined) args.search = body.search;
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        const r = await admin.rpc("marketing_objective_search", {
          p_tenant: tenantId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "objective_context": {
        if (!isUuid(body.campaign_id)) {
          return fail("INVALID_REQUEST", "campaign_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_campaign_objective_context", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "link_objective": {
        if (!isUuid(body.campaign_id)) {
          return fail("INVALID_REQUEST", "campaign_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const args: Row = {};
        for (const k of [
          "objective_id",
          "relation",
          "expected_contribution",
          "rationale",
          "request_id",
        ]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_campaign_objective_link", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: args,
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "unlink_objective": {
        if (!isUuid(body.campaign_id)) {
          return fail("INVALID_REQUEST", "campaign_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const args: Row = {};
        if (body.rationale !== undefined) args.rationale = body.rationale;
        const r = await admin.rpc("marketing_campaign_objective_unlink", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: args,
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch (e) {
    console.error("marketing-reporting error", e instanceof Error ? e.message : e);
    return fail("INTERNAL", "The operation failed", 500);
  }
});
