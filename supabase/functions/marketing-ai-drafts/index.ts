// ServiceOS — Marketing AI Drafting API (Phase 7).
//
// GENERATION CREATES PROPOSALS ONLY. A request here freezes the brief into an
// immutable Automation Intent (`generate_marketing_draft` on the governed
// `ai.generate_marketing_draft` capability) and enqueues the untouched
// Automation Engine; the ONE registered AI adapter performs the single
// provider call and records the IMMUTABLE proposal. Nothing on this surface
// can send, approve, launch or silently replace campaign content — acceptance
// writes DRAFTS through the same canonical authoring RPCs a human edit uses,
// and revising an approved campaign structurally invalidates its approval.
//
//   status / request_status / request_list / proposal_detail:  marketing.view
//   request_generation / revise / accept / reject / cancel:
//       operational role + marketing.campaigns.draft
//   configure: owner/admin role + marketing.ai.manage (structural ceiling is
//       ALSO enforced inside the RPC — a hostile grant cannot reach it)
//
// The provider credential is written STRAIGHT into the tenant Vault broker
// (provider_secret_store) and only its opaque reference is kept in connector
// settings; no secret is ever returned, logged or echoed.
//
// Stable error contract: INVALID_REQUEST / NOT_FOUND / FORBIDDEN /
// VERSION_CONFLICT / REQUEST_MISMATCH / CONFIG_REQUIRED / RATE_LIMITED /
// INTERNAL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";
import { enqueueAutomationExecution } from "../_shared/automation_execution_enqueue.ts";

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
    case "MK428":
      return fail(
        "CONFIG_REQUIRED",
        "AI drafting is not configured — an owner/admin must connect a model provider",
        422,
      );
    case "MK429":
      return fail("RATE_LIMITED", "AI generation rate limit reached — try again later", 429);
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

const BRIEF_KEYS = [
  "destination_kind",
  "destination_template_id",
  "destination_campaign_id",
  "objective_id",
  "campaign_objective",
  "offer",
  "audience",
  "why_care",
  "objection",
  "tone",
  "sender_context",
  "call_to_action",
];
const ACTION_KEYS: Record<string, string[]> = {
  status: ["action"],
  configure: ["action", "model", "api_key", "enabled"],
  request_generation: ["action", ...BRIEF_KEYS, "request_id"],
  request_status: ["action", "ai_request_id"],
  request_list: ["action", "limit", "cursor"],
  proposal_detail: ["action", "proposal_id"],
  revise: ["action", "proposal_id", "changes"],
  accept: [
    "action",
    "proposal_id",
    "revision_id",
    "destination_kind",
    "request_id",
    "template_id",
    "template_name",
    "expected_version",
    "campaign_id",
    "name",
    "sender_id",
    "segment_id",
    "step_key",
    "append_step",
  ],
  reject: ["action", "ai_request_id", "reason"],
  cancel: ["action", "ai_request_id"],
};
const DRAFT_ACTIONS = new Set(["request_generation", "revise", "accept", "reject", "cancel"]);

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
    return fail("INVALID_REQUEST", "marketing-ai-drafts is a user-facing endpoint", 400);
  }

  let body: Row;
  try {
    const parsed = await req.json();
    if (!isPlainObject(parsed)) return fail("INVALID_REQUEST", "Body must be an object", 400);
    body = parsed;
  } catch {
    return fail("INVALID_REQUEST", "Body must be valid JSON", 400);
  }
  const action = typeof body.action === "string" ? body.action : "status";
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
  if (DRAFT_ACTIONS.has(action)) {
    if (!["owner", "admin", "ops"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "AI drafting requires an operational role", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.draft")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.draft", 403);
    }
  }
  if (action === "configure") {
    if (!["owner", "admin"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Provider configuration requires owner/admin", 403);
    }
    if (!permissionSet.includes("marketing.ai.manage")) {
      return fail("FORBIDDEN", "Requires marketing.ai.manage", 403);
    }
  }

  try {
    switch (action) {
      case "status": {
        const r = await admin.rpc("marketing_ai_provider_state", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "configure": {
        const args: Row = {};
        if (body.model !== undefined) args.model = body.model;
        if (body.enabled !== undefined) args.enabled = body.enabled;
        if (body.api_key !== undefined) {
          if (typeof body.api_key !== "string" || body.api_key.trim().length < 8) {
            return fail("INVALID_REQUEST", "api_key must be the provider API key", 400);
          }
          // straight into the tenant Vault broker; only the opaque reference
          // travels further — the key itself is never persisted or echoed
          const stored = await admin.rpc("provider_secret_store", {
            p_tenant: tenantId,
            p_provider: "openai",
            p_field: "api_key",
            p_secret: body.api_key.trim(),
          });
          if (stored.error || typeof stored.data !== "string") {
            return fail("INTERNAL", "Could not store the provider credential", 500);
          }
          args.secret_ref = stored.data;
        }
        const r = await admin.rpc("marketing_ai_configure", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "request_generation": {
        const args: Row = {};
        for (const k of [...BRIEF_KEYS, "request_id"]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_ai_generation_request", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        const data = (r.data ?? {}) as Row;
        // enqueue on the IDEMPOTENT REPLAY too: if the original enqueue was
        // lost after the RPC committed, the replay must still converge to an
        // executable intent. Safe — the job key de-dups one active job per
        // intent and the engine's claim RPC is the single-execution guard.
        if (data.intent_id) {
          await enqueueAutomationExecution(admin, {
            tenantId,
            automationIntentId: data.intent_id,
            triggeredBy: "intent_created",
            correlationId: data.correlation_id ?? undefined,
          });
        }
        return json({ ok: true, data });
      }
      case "request_status": {
        if (!isUuid(body.ai_request_id)) {
          return fail("INVALID_REQUEST", "ai_request_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ai_request_status", {
          p_tenant: tenantId,
          p_request: body.ai_request_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "request_list": {
        const args: Row = {};
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        if (body.cursor !== undefined) args.cursor = body.cursor;
        const r = await admin.rpc("marketing_ai_request_list", {
          p_tenant: tenantId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "proposal_detail": {
        if (!isUuid(body.proposal_id)) {
          return fail("INVALID_REQUEST", "proposal_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ai_proposal_detail", {
          p_tenant: tenantId,
          p_proposal: body.proposal_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "revise": {
        if (!isUuid(body.proposal_id)) {
          return fail("INVALID_REQUEST", "proposal_id must be a uuid", 400);
        }
        if (!isPlainObject(body.changes)) {
          return fail("INVALID_REQUEST", "changes must be an object", 400);
        }
        for (const k of Object.keys(body.changes)) {
          if (
            ![
              "subject",
              "preview_text",
              "body_authored",
              "token_fallbacks",
              "change_note",
            ].includes(k)
          ) {
            return fail("INVALID_REQUEST", `unknown change key '${k}'`, 400);
          }
        }
        const r = await admin.rpc("marketing_ai_revise", {
          p_tenant: tenantId,
          p_actor: userId,
          p_proposal: body.proposal_id,
          p_args: body.changes,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "accept": {
        const args: Row = {};
        for (const k of ACTION_KEYS.accept) {
          if (k !== "action" && body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_ai_accept", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "reject": {
        if (!isUuid(body.ai_request_id)) {
          return fail("INVALID_REQUEST", "ai_request_id must be a uuid", 400);
        }
        const args: Row = {};
        if (body.reason !== undefined) args.reason = body.reason;
        const r = await admin.rpc("marketing_ai_reject", {
          p_tenant: tenantId,
          p_actor: userId,
          p_request: body.ai_request_id,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "cancel": {
        if (!isUuid(body.ai_request_id)) {
          return fail("INVALID_REQUEST", "ai_request_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ai_cancel", {
          p_tenant: tenantId,
          p_actor: userId,
          p_request: body.ai_request_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch (e) {
    console.error("marketing-ai-drafts error", e instanceof Error ? e.message : e);
    await writeAudit(admin, {
      tenantId,
      actor: auth.ctx.email ?? userId,
      action: "marketing.ai.request_failed",
      resourceType: "marketing_ai_request",
      status: "error",
      detail: { action },
    }).catch(() => {});
    return fail("INTERNAL", "The operation failed", 500);
  }
});
