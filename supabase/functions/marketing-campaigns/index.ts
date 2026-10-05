// ServiceOS — Marketing Broadcasts API (Phase 5).
//
// AUTHORITY MODEL (identical to marketing-senders): requireTenantUser derives
// tenant + actor from the JWT (never the body); every action then passes the
// DOUBLE GATE — an Edge role/permission check AND the canonical SQL resolver
// inside every RPC (a hostile raw grant can never bypass the owner/admin
// launch ceiling; explicit deny defeats role defaults).
//
//   read (list/detail):            marketing.view
//   report / recipient_page:       marketing.reporting.view
//   create/revise/duplicate/
//   audience_preview/submit_review: operational role + marketing.campaigns.draft
//   test_send:                     operational role + marketing.campaigns.test
//   approve/request_changes/preflight/launch/schedule/pause/resume/cancel/
//   archive:                       owner/admin + marketing.campaigns.launch
//
// Delivery boundary: this function NEVER calls Gmail and NEVER renders a
// recipient send. Launch creates governed lineage in SQL and enqueues the
// platform dispatch job; each recipient executes only through the untouched
// Automation Engine + the registered Gmail Marketing adapter.
//
// Stable error contract: INVALID_REQUEST / NOT_FOUND / FORBIDDEN /
// VERSION_CONFLICT / REQUEST_MISMATCH / GUARDRAIL / DST_INVALID /
// DST_AMBIGUOUS / CONFIRMATION_EXPIRED / CONFIG_REQUIRED / RATE_LIMITED /
// INTERNAL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";
import { enqueueJob } from "../_shared/platform_queue.ts";
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
    case "MK413":
      return fail("GUARDRAIL", "The audience exceeds the tenant recipient guardrail", 422);
    case "MK414":
      return fail("DST_INVALID", "That local time does not exist (daylight-saving gap)", 422);
    case "MK415":
      return fail(
        "DST_AMBIGUOUS",
        "That local time occurs twice — resolve it with fold: earlier or later",
        422,
      );
    case "MK416":
      return fail("CONFIRMATION_EXPIRED", "The launch confirmation expired — preflight again", 409);
    case "MK423":
      return fail("LOCKOUT", "The work item is leased elsewhere", 409);
    case "MK428":
      return fail("CONFIG_REQUIRED", "The Marketing public base URL is not configured", 422);
    case "MK429":
      return fail("RATE_LIMITED", "Rate limit reached — try again later", 429);
    case "42501":
      return fail("FORBIDDEN", "You do not have permission for that", 403);
    case "22023":
    case "22P02":
      return fail("INVALID_REQUEST", "The request was not valid", 400);
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

// per-action TOP-LEVEL key allowlists — unknown keys are rejected, never ignored
const ACTION_KEYS: Record<string, string[]> = {
  list: ["action", "limit"],
  detail: ["action", "campaign_id"],
  create: [
    "action",
    "name",
    "description",
    "sender_id",
    "segment_id",
    "subject",
    "preview_text",
    "body_authored",
    "token_fallbacks",
  ],
  revise: ["action", "campaign_id", "expected_version", "changes"],
  duplicate: ["action", "campaign_id"],
  submit_review: ["action", "campaign_id", "expected_version", "note"],
  request_changes: ["action", "campaign_id", "expected_version", "note"],
  approve: ["action", "campaign_id", "expected_version", "note"],
  audience_preview: ["action", "campaign_id"],
  preflight: ["action", "campaign_id", "expected_version"],
  test_send: ["action", "campaign_id", "recipient_profile_id", "request_id"],
  launch: ["action", "campaign_id", "confirmation_id", "challenge", "request_id"],
  schedule: [
    "action",
    "campaign_id",
    "confirmation_id",
    "challenge",
    "request_id",
    "schedule_local",
    "timezone",
    "fold",
  ],
  pause: ["action", "campaign_id", "expected_version", "note"],
  resume: ["action", "campaign_id", "expected_version", "note"],
  cancel: ["action", "campaign_id", "expected_version", "note"],
  archive: ["action", "campaign_id", "expected_version", "note"],
  report: ["action", "campaign_id"],
  recipient_page: ["action", "campaign_id", "limit", "cursor"],
  health: ["action"],
};
const DRAFT_ACTIONS = new Set([
  "create",
  "revise",
  "duplicate",
  "submit_review",
  "audience_preview",
]);
const LAUNCH_ACTIONS = new Set([
  "request_changes",
  "approve",
  "preflight",
  "launch",
  "schedule",
  "pause",
  "resume",
  "cancel",
  "archive",
]);
const TRANSITION_ACTIONS = new Set([
  "submit_review",
  "request_changes",
  "approve",
  "pause",
  "resume",
  "cancel",
  "archive",
]);

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
    return fail("INVALID_REQUEST", "marketing-campaigns is a user-facing endpoint", 400);
  }

  let body: Row;
  try {
    const parsed = await req.json();
    if (!isPlainObject(parsed)) return fail("INVALID_REQUEST", "Body must be an object", 400);
    body = parsed;
  } catch {
    return fail("INVALID_REQUEST", "Body must be valid JSON", 400);
  }
  const action = typeof body.action === "string" ? body.action : "list";
  const allowed = ACTION_KEYS[action];
  if (!allowed) return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
  for (const k of Object.keys(body)) {
    if (!allowed.includes(k)) {
      return fail("INVALID_REQUEST", `unknown key '${k}' for action '${action}'`, 400);
    }
  }

  // canonical effective permissions — role gates are necessary, never sufficient
  const perms = await admin.rpc("marketing_effective_permissions", { p_profile_id: userId });
  if (perms.error) return fail("INTERNAL", "Could not resolve permissions", 500);
  const verdict = (perms.data ?? {}) as Row;
  const permissionSet: string[] = Array.isArray(verdict.permissions) ? verdict.permissions : [];
  if (verdict.enabled !== true || !permissionSet.includes("marketing.view")) {
    return fail("FORBIDDEN", "Requires Marketing access", 403);
  }
  if (DRAFT_ACTIONS.has(action)) {
    if (!["owner", "admin", "ops"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Drafting requires an operational role", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.draft")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.draft", 403);
    }
  }
  if (action === "test_send") {
    if (!["owner", "admin", "ops"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Test sends require an operational role", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.test")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.test", 403);
    }
  }
  if (LAUNCH_ACTIONS.has(action)) {
    if (!["owner", "admin"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Launch authority requires owner/admin", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.launch")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.launch", 403);
    }
  }
  if (
    ["report", "recipient_page"].includes(action) &&
    !permissionSet.includes("marketing.reporting.view")
  ) {
    return fail("FORBIDDEN", "Requires marketing.reporting.view", 403);
  }

  const auditRejected = async (auditAction: string, code: string, detail: Row) => {
    try {
      await writeAudit(admin, {
        tenantId,
        actor: auth.ctx.email ?? userId,
        action: auditAction,
        resourceType: "marketing_campaign",
        status: "denied",
        detail: { code, ...detail },
      });
    } catch {
      // auditing a rejection must never mask the rejection
    }
  };

  try {
    switch (action) {
      case "list": {
        const args: Row = {};
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        const r = await admin.rpc("marketing_campaign_list", { p_tenant: tenantId, p_args: args });
        if (r.error) return mapDbError(r.error);
        return json({
          ok: true,
          data: {
            ...(r.data ?? {}),
            can_draft:
              ["owner", "admin", "ops"].includes(auth.ctx.role) &&
              permissionSet.includes("marketing.campaigns.draft"),
            can_test:
              ["owner", "admin", "ops"].includes(auth.ctx.role) &&
              permissionSet.includes("marketing.campaigns.test"),
            can_launch:
              ["owner", "admin"].includes(auth.ctx.role) &&
              permissionSet.includes("marketing.campaigns.launch"),
            can_report: permissionSet.includes("marketing.reporting.view"),
            unsubscribe_configured: Boolean(Deno.env.get("MARKETING_PUBLIC_BASE_URL")),
          },
        });
      }
      case "detail": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const r = await admin.rpc("marketing_campaign_detail", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "create": {
        const args: Row = {};
        for (const k of [
          "name",
          "description",
          "sender_id",
          "segment_id",
          "subject",
          "preview_text",
          "body_authored",
        ]) {
          if (body[k] !== undefined) {
            if (typeof body[k] !== "string") {
              return fail("INVALID_REQUEST", `${k} must be a string`, 400);
            }
            args[k] = body[k];
          }
        }
        if (body.token_fallbacks !== undefined) {
          if (!isPlainObject(body.token_fallbacks)) {
            return fail("INVALID_REQUEST", "token_fallbacks must be an object", 400);
          }
          args.token_fallbacks = body.token_fallbacks;
        }
        const r = await admin.rpc("marketing_campaign_create", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error?.code === "P0002") {
          return fail(
            "STALE_REFERENCE",
            "The selected sender or segment is no longer available. Reload the form and choose again.",
            409,
          );
        }
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "revise": {
        if (
          !isUuid(body.campaign_id) ||
          !Number.isInteger(body.expected_version) ||
          !isPlainObject(body.changes)
        ) {
          return fail("INVALID_REQUEST", "campaign_id, expected_version and changes required", 400);
        }
        const r = await admin.rpc("marketing_campaign_revise", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: body.changes,
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "duplicate": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const r = await admin.rpc("marketing_campaign_duplicate", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "audience_preview": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const r = await admin.rpc("marketing_campaign_preview_audience", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "preflight": {
        if (!isUuid(body.campaign_id) || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "campaign_id and expected_version required", 400);
        }
        const baseUrl = Deno.env.get("MARKETING_PUBLIC_BASE_URL") ?? null;
        if (!baseUrl) {
          // honest configuration failure — launching is impossible without a
          // public unsubscribe path, and we never fabricate one
          return fail(
            "CONFIG_REQUIRED",
            "MARKETING_PUBLIC_BASE_URL is not configured — unsubscribe links cannot be built",
            422,
          );
        }
        const r = await admin.rpc("marketing_campaign_preflight", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_expected_version: body.expected_version,
          p_public_base_url: baseUrl,
        });
        if (r.error) {
          if (["42501", "22023", "MK409", "MK413", "MK428"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.campaign.preflight", r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "launch":
      case "schedule": {
        if (
          !isUuid(body.campaign_id) ||
          !isUuid(body.confirmation_id) ||
          typeof body.challenge !== "string" ||
          typeof body.request_id !== "string"
        ) {
          return fail(
            "INVALID_REQUEST",
            "campaign_id, confirmation_id, challenge and request_id required",
            400,
          );
        }
        const args: Row = {
          confirmation_id: body.confirmation_id,
          challenge: body.challenge,
          request_id: body.request_id,
          mode: action === "launch" ? "immediate" : "scheduled",
        };
        if (action === "schedule") {
          if (typeof body.schedule_local !== "string" || typeof body.timezone !== "string") {
            return fail("INVALID_REQUEST", "schedule_local and timezone required", 400);
          }
          args.schedule_local = body.schedule_local;
          args.timezone = body.timezone;
          if (body.fold !== undefined) {
            if (body.fold !== "earlier" && body.fold !== "later") {
              return fail("INVALID_REQUEST", "fold must be earlier|later", 400);
            }
            args.fold = body.fold;
          }
        }
        const r = await admin.rpc("marketing_campaign_launch", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: args,
        });
        if (r.error) {
          if (
            ["42501", "22023", "MK409", "MK412", "MK414", "MK415", "MK416"].includes(
              r.error.code ?? "",
            )
          ) {
            await auditRejected(
              action === "launch" ? "marketing.campaign.launched" : "marketing.campaign.scheduled",
              r.error.code ?? "",
              { campaign_id: body.campaign_id },
            );
          }
          return mapDbError(r.error);
        }
        const out = (r.data ?? {}) as Row;
        // immediate launches start the bounded dispatch worker; scheduled ones
        // wait for the secret-gated scheduler to discover them
        if (out.status === "active") {
          await enqueueJob(admin, {
            tenantId,
            jobType: "marketing.broadcast_dispatch",
            jobKey: `marketing.broadcast_dispatch:${tenantId}`,
            moduleId: "marketing.campaigns",
            payload: {},
          });
        }
        return json({ ok: true, data: out });
      }
      case "submit_review":
      case "request_changes":
      case "approve":
      case "pause":
      case "resume":
      case "cancel":
      case "archive": {
        if (!isUuid(body.campaign_id) || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "campaign_id and expected_version required", 400);
        }
        const args: Row = {};
        if (body.note !== undefined) {
          if (typeof body.note !== "string") {
            return fail("INVALID_REQUEST", "note must be a string", 400);
          }
          args.note = body.note;
        }
        const r = await admin.rpc("marketing_campaign_transition", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_action: action,
          p_expected_version: body.expected_version,
          p_args: args,
        });
        if (r.error) {
          if (["42501", "22023", "MK409"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.campaign." + action, r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        const out = (r.data ?? {}) as Row;
        if (action === "resume") {
          await enqueueJob(admin, {
            tenantId,
            jobType: "marketing.broadcast_dispatch",
            jobKey: `marketing.broadcast_dispatch:${tenantId}`,
            moduleId: "marketing.campaigns",
            payload: {},
          });
        }
        return json({ ok: true, data: out });
      }
      case "test_send": {
        if (
          !isUuid(body.campaign_id) ||
          !isUuid(body.recipient_profile_id) ||
          typeof body.request_id !== "string"
        ) {
          return fail(
            "INVALID_REQUEST",
            "campaign_id, recipient_profile_id and request_id required",
            400,
          );
        }
        // the campaign's CURRENT authored content, test-rendered with explicit
        // fallbacks only ({{tokens}} without a fallback stay visible — a test
        // shows the truth, it never invents recipient data)
        const detail = await admin.rpc("marketing_campaign_detail", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
        });
        if (detail.error) return mapDbError(detail.error);
        const revision = (detail.data as Row | null)?.revision as Row | null;
        if (!revision) return fail("NOT_FOUND", "Campaign has no revision", 404);
        const fallbacks = isPlainObject(revision.token_fallbacks)
          ? (revision.token_fallbacks as Record<string, string>)
          : {};
        const testRender = (v: string) =>
          v
            .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, t: string) => fallbacks[t] ?? `[${t}]`)
            .replace(
              /\[([^\][]{1,200})\]\((https?:\/\/[^\s()<>]+)\)/g,
              (_m, label: string, url: string) => `${label} (${url})`,
            );
        const subject = `[TEST] ${testRender(String(revision.subject ?? ""))}`.slice(0, 300);
        const bodyText =
          testRender(String(revision.body_authored ?? "")).slice(0, 9500) +
          "\n\n— Campaign test send: personalisation shows configured fallbacks or [token]; no unsubscribe link is included because this is not a broadcast delivery.";
        const r = await admin.rpc("marketing_test_send_request", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: {
            sender_id: revision.sender_profile_id,
            recipient_profile_id: body.recipient_profile_id,
            subject,
            body_text: bodyText,
            request_id: body.request_id,
          },
        });
        if (r.error) {
          if (["42501", "22023", "MK429"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.test_send.requested", r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        const out = (r.data ?? {}) as Row;
        if (out.intent_id && out.idempotent !== true) {
          await enqueueAutomationExecution(admin, {
            tenantId,
            automationIntentId: out.intent_id as string,
            triggeredBy: "intent_created",
            correlationId: (out.correlation_id as string) ?? null,
          });
        }
        await enqueueJob(admin, {
          tenantId,
          jobType: "marketing.delivery_sync",
          jobKey: `marketing.delivery_sync:${tenantId}`,
          moduleId: "marketing.senders",
          payload: { ttl: 30 },
        });
        return json({ ok: true, data: out });
      }
      case "report": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const r = await admin.rpc("marketing_campaign_report", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "recipient_page": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const args: Row = {};
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        if (body.cursor !== undefined) args.cursor = body.cursor;
        const r = await admin.rpc("marketing_campaign_recipient_page", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "health": {
        const r = await admin.rpc("marketing_broadcast_health", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch {
    return fail("INTERNAL", "Unexpected failure", 500);
  }
});
