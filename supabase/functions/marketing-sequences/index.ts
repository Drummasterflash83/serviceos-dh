// ServiceOS — Marketing Sequences API (Phase 6).
//
// AUTHORITY MODEL (identical to marketing-campaigns): requireTenantUser
// derives tenant + actor from the JWT (never the body); every action then
// passes the DOUBLE GATE — an Edge role/permission check AND the canonical SQL
// resolver inside every RPC, so a hostile raw grant can never bypass the
// owner/admin ceiling and an explicit deny always wins.
//
//   read (list/detail/enrolment_list/enrolment_detail):  marketing.view
//   report:                                              marketing.reporting.view
//   create/revise/validate:            operational role + marketing.campaigns.draft
//   approve/request_changes/activate/preflight_enrolment/confirm_enrolment/
//   pause/resume/cancel/close/archive/enrolment_pause/enrolment_resume/
//   enrolment_exit:                    owner/admin  + marketing.campaigns.launch
//
// Delivery boundary: this function NEVER calls Gmail and NEVER renders a
// recipient send. It creates governed lineage in SQL and enqueues the platform
// job; every step executes only through the untouched Automation Engine and
// the ONE registered Gmail adapter (email) or the registered internal
// marketing.contact_action adapter (tag/lifecycle/owner/follow-up).
//
// Stable error contract: INVALID_REQUEST / NOT_FOUND / FORBIDDEN /
// VERSION_CONFLICT / REQUEST_MISMATCH / GUARDRAIL / CONFIRMATION_EXPIRED /
// CONFIG_REQUIRED / LOCKOUT / RATE_LIMITED / INTERNAL.

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
      return fail("GUARDRAIL", "The enrolment audience exceeds the tenant guardrail", 422);
    case "MK416":
      return fail("CONFIRMATION_EXPIRED", "The confirmation expired — preflight again", 409);
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
    "timezone",
    "quiet_hours_start",
    "quiet_hours_end",
    "entry_policy",
    "reenrolment_policy",
    "exit_rules",
    "policy_block_action",
    "steps",
  ],
  revise: ["action", "campaign_id", "expected_version", "changes"],
  validate: ["action", "steps"],
  test_send: ["action", "campaign_id", "step_order", "recipient_profile_id", "request_id"],
  submit_review: ["action", "campaign_id", "expected_version", "note"],
  request_changes: ["action", "campaign_id", "expected_version", "note"],
  approve: ["action", "campaign_id", "expected_version", "note"],
  preflight_activation: ["action", "campaign_id", "expected_version"],
  activate: ["action", "campaign_id", "confirmation_id", "challenge", "request_id"],
  pause: ["action", "campaign_id", "expected_version", "note"],
  resume: ["action", "campaign_id", "expected_version", "note"],
  cancel: ["action", "campaign_id", "expected_version", "note"],
  close: ["action", "campaign_id", "expected_version", "note"],
  archive: ["action", "campaign_id", "expected_version", "note"],
  preflight_enrolment: ["action", "campaign_id", "source", "person_ids", "segment_id"],
  confirm_enrolment: ["action", "campaign_id", "confirmation_id", "challenge", "request_id"],
  enrolment_list: ["action", "campaign_id", "limit", "cursor", "status"],
  enrolment_pause: ["action", "enrolment_id", "note"],
  enrolment_resume: ["action", "enrolment_id", "note"],
  enrolment_exit: ["action", "enrolment_id", "note"],
  report: ["action", "campaign_id"],
  health: ["action"],
};
const DRAFT_ACTIONS = new Set(["create", "revise", "validate"]);
const LAUNCH_ACTIONS = new Set([
  "submit_review",
  "request_changes",
  "approve",
  "preflight_activation",
  "activate",
  "pause",
  "resume",
  "cancel",
  "close",
  "archive",
  "preflight_enrolment",
  "confirm_enrolment",
  "enrolment_pause",
  "enrolment_resume",
  "enrolment_exit",
]);
const TRANSITIONS: Record<string, string> = {
  submit_review: "submit_review",
  request_changes: "request_changes",
  approve: "approve",
  pause: "pause",
  resume: "resume",
  cancel: "cancel",
  close: "close",
  archive: "archive",
};

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
    return fail("INVALID_REQUEST", "marketing-sequences is a user-facing endpoint", 400);
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
      return fail("FORBIDDEN", "Testing requires an operational role", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.test")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.test", 403);
    }
  }
  if (LAUNCH_ACTIONS.has(action)) {
    if (!["owner", "admin"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Sequence launch authority requires owner/admin", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.launch")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.launch", 403);
    }
  }
  if (action === "report" && !permissionSet.includes("marketing.reporting.view")) {
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
        const r = await admin.rpc("marketing_sequence_list", { p_tenant: tenantId, p_args: args });
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
            scheduler_configured: Boolean(Deno.env.get("MARKETING_SEQUENCE_SECRET")),
          },
        });
      }
      case "detail": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const r = await admin.rpc("marketing_sequence_detail", {
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
          "timezone",
          "entry_policy",
          "reenrolment_policy",
          "policy_block_action",
        ]) {
          if (body[k] !== undefined) {
            if (typeof body[k] !== "string") {
              return fail("INVALID_REQUEST", `${k} must be a string`, 400);
            }
            args[k] = body[k];
          }
        }
        for (const k of ["quiet_hours_start", "quiet_hours_end"]) {
          if (body[k] !== undefined && body[k] !== null) {
            if (typeof body[k] !== "number" || !Number.isInteger(body[k])) {
              return fail("INVALID_REQUEST", `${k} must be an integer hour`, 400);
            }
            args[k] = String(body[k]);
          }
        }
        if (body.exit_rules !== undefined) {
          if (!isPlainObject(body.exit_rules)) {
            return fail("INVALID_REQUEST", "exit_rules must be an object", 400);
          }
          args.exit_rules = body.exit_rules;
        }
        if (!Array.isArray(body.steps) || body.steps.length === 0) {
          return fail("INVALID_REQUEST", "steps must be a non-empty array", 400);
        }
        if (body.steps.length > 40) {
          return fail("INVALID_REQUEST", "a sequence supports at most 40 steps", 400);
        }
        args.steps = body.steps;
        const r = await admin.rpc("marketing_sequence_create", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
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
        if (body.changes.steps !== undefined) {
          if (!Array.isArray(body.changes.steps) || body.changes.steps.length > 40) {
            return fail("INVALID_REQUEST", "steps must be an array of at most 40 items", 400);
          }
        }
        const r = await admin.rpc("marketing_sequence_revise", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: body.changes,
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "validate": {
        if (!Array.isArray(body.steps)) {
          return fail("INVALID_REQUEST", "steps must be an array", 400);
        }
        if (body.steps.length > 40) {
          return fail("INVALID_REQUEST", "a sequence supports at most 40 steps", 400);
        }
        const r = await admin.rpc("marketing_sequence_validate", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: { steps: body.steps },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "test_send": {
        if (
          !isUuid(body.campaign_id) ||
          !Number.isInteger(body.step_order) ||
          body.step_order < 1 ||
          !isUuid(body.recipient_profile_id) ||
          typeof body.request_id !== "string"
        ) {
          return fail(
            "INVALID_REQUEST",
            "campaign_id, step_order, recipient_profile_id and request_id required",
            400,
          );
        }
        const detail = await admin.rpc("marketing_sequence_detail", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
        });
        if (detail.error) return mapDbError(detail.error);
        const sequence = (detail.data ?? null) as Row | null;
        const revision = sequence?.revision as Row | null;
        const steps = Array.isArray(sequence?.steps) ? (sequence!.steps as Row[]) : [];
        const step = steps.find((candidate) => candidate.order === body.step_order);
        if (!revision || !step || step.type !== "send_email" || !isPlainObject(step.config)) {
          return fail("NOT_FOUND", "That email step is no longer available", 404);
        }
        const config = step.config as Row;
        const fallbacks = isPlainObject(config.token_fallbacks)
          ? (config.token_fallbacks as Record<string, string>)
          : {};
        const render = (value: string) =>
          value
            .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, token: string) =>
              fallbacks[token] ? fallbacks[token] : `[${token}]`,
            )
            .replace(
              /\[([^\][]{1,200})\]\((https?:\/\/[^\s()<>]+)\)/g,
              (_match, label: string, url: string) => `${label} (${url})`,
            );
        const subject =
          `[TEST] Sequence step ${body.step_order} · ${render(String(config.subject ?? ""))}`.slice(
            0,
            300,
          );
        const bodyText =
          render(String(config.body_authored ?? "")).slice(0, 9200) +
          "\n\n— Sequence test send. Personalisation shows configured fallbacks or [token]. This does not enrol anyone or advance the sequence.";
        const requested = await admin.rpc("marketing_test_send_request", {
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
        if (requested.error) return mapDbError(requested.error);
        const out = (requested.data ?? {}) as Row;
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
      case "submit_review":
      case "request_changes":
      case "approve":
      case "pause":
      case "resume":
      case "cancel":
      case "close":
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
        const r = await admin.rpc("marketing_sequence_transition", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_action: TRANSITIONS[action],
          p_expected_version: body.expected_version,
          p_args: args,
        });
        if (r.error) {
          if (["42501", "22023", "MK409"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.sequence." + action, r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "preflight_activation": {
        if (!isUuid(body.campaign_id) || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "campaign_id and expected_version required", 400);
        }
        const baseUrl = Deno.env.get("MARKETING_PUBLIC_BASE_URL") ?? null;
        const r = await admin.rpc("marketing_sequence_preflight_activation", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_expected_version: body.expected_version,
          p_public_base_url: baseUrl,
        });
        if (r.error) {
          if (["42501", "22023", "MK409", "MK428"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.sequence.activation_preflight", r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "activate": {
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
        const r = await admin.rpc("marketing_sequence_activate", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: {
            confirmation_id: body.confirmation_id,
            challenge: body.challenge,
            request_id: body.request_id,
          },
        });
        if (r.error) {
          if (["42501", "22023", "MK409", "MK412", "MK416"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.sequence.activated", r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        await enqueueJob(admin, {
          tenantId,
          jobType: "marketing.sequence_advance",
          jobKey: `marketing.sequence_advance:${tenantId}`,
          moduleId: "marketing.sequences",
          payload: {},
        });
        return json({ ok: true, data: r.data });
      }
      case "preflight_enrolment": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        if (body.source !== "manual" && body.source !== "segment") {
          return fail("INVALID_REQUEST", "source must be manual|segment", 400);
        }
        const args: Row = { source: body.source };
        if (body.source === "manual") {
          if (!Array.isArray(body.person_ids) || body.person_ids.length === 0) {
            return fail("INVALID_REQUEST", "person_ids must be a non-empty array", 400);
          }
          if (body.person_ids.length > 10000) {
            return fail("INVALID_REQUEST", "too many person_ids", 400);
          }
          if (!body.person_ids.every((p: unknown) => isUuid(p))) {
            return fail("INVALID_REQUEST", "person_ids must all be uuids", 400);
          }
          args.person_ids = body.person_ids;
        } else {
          if (!isUuid(body.segment_id)) {
            return fail("INVALID_REQUEST", "segment_id required for segment enrolment", 400);
          }
          args.segment_id = body.segment_id;
        }
        const r = await admin.rpc("marketing_sequence_preflight_enrolment", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: args,
        });
        if (r.error) {
          if (["42501", "22023", "MK409", "MK413"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.sequence.enrolment_preflight", r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "confirm_enrolment": {
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
        const r = await admin.rpc("marketing_sequence_confirm_enrolment", {
          p_tenant: tenantId,
          p_actor: userId,
          p_campaign: body.campaign_id,
          p_args: {
            confirmation_id: body.confirmation_id,
            challenge: body.challenge,
            request_id: body.request_id,
          },
        });
        if (r.error) {
          if (["42501", "22023", "MK409", "MK412", "MK416"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.sequence.enrolment_confirmed", r.error.code ?? "", {
              campaign_id: body.campaign_id,
            });
          }
          return mapDbError(r.error);
        }
        await enqueueJob(admin, {
          tenantId,
          jobType: "marketing.sequence_advance",
          jobKey: `marketing.sequence_advance:${tenantId}`,
          moduleId: "marketing.sequences",
          payload: {},
        });
        return json({ ok: true, data: r.data });
      }
      case "enrolment_list": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const args: Row = {};
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        if (body.status !== undefined) {
          if (typeof body.status !== "string") {
            return fail("INVALID_REQUEST", "status must be a string", 400);
          }
          args.status = body.status;
        }
        if (body.cursor !== undefined) args.cursor = body.cursor;
        const r = await admin.rpc("marketing_sequence_enrolment_page", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "enrolment_pause":
      case "enrolment_resume":
      case "enrolment_exit": {
        if (!isUuid(body.enrolment_id)) {
          return fail("INVALID_REQUEST", "enrolment_id required", 400);
        }
        const args: Row = {};
        if (body.note !== undefined) {
          if (typeof body.note !== "string") {
            return fail("INVALID_REQUEST", "note must be a string", 400);
          }
          args.note = body.note;
        }
        const r = await admin.rpc("marketing_sequence_enrolment_control", {
          p_tenant: tenantId,
          p_actor: userId,
          p_enrolment: body.enrolment_id,
          p_action: action.replace("enrolment_", ""),
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "report": {
        if (!isUuid(body.campaign_id)) return fail("INVALID_REQUEST", "campaign_id required", 400);
        const r = await admin.rpc("marketing_sequence_report", {
          p_tenant: tenantId,
          p_campaign: body.campaign_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "health": {
        const r = await admin.rpc("marketing_sequence_health", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({
          ok: true,
          data: {
            ...(r.data ?? {}),
            scheduler_configured: Boolean(Deno.env.get("MARKETING_SEQUENCE_SECRET")),
            unsubscribe_configured: Boolean(Deno.env.get("MARKETING_PUBLIC_BASE_URL")),
          },
        });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch {
    return fail("INTERNAL", "Unexpected failure", 500);
  }
});
