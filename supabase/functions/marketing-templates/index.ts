// ServiceOS — Marketing Templates API (Phase 7).
//
// AUTHORITY MODEL (identical to marketing-campaigns/-sequences):
// requireTenantUser derives tenant + actor from the JWT (never the body);
// every action passes the DOUBLE GATE — an Edge role/permission check AND the
// canonical SQL resolver inside every mutating RPC.
//
//   read (list/detail/preview/quality_check):            marketing.view
//   create/revise/duplicate/archive/restore/use_in_*:    operational role +
//                                                        marketing.campaigns.draft
//
// ONE CONTENT MODEL: every template write passes the canonical SQL validator
// (marketing_campaign_validate_content); preview renders through the ONE
// deterministic Marketing renderer with an explicitly-labelled SAMPLE context
// and placeholder unsubscribe URL — nothing here composes provider messages
// or sends anything. Quality guidance is deterministic and ADVISORY (clearly
// labelled; it never blocks a save and it is not AI).
//
// Stable error contract: INVALID_REQUEST / NOT_FOUND / FORBIDDEN /
// VERSION_CONFLICT / REQUEST_MISMATCH / DUPLICATE / CONFIG_REQUIRED /
// RATE_LIMITED / INTERNAL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { renderBroadcast } from "../_shared/marketing_email.ts";
import {
  DEFAULT_QUALITY_THRESHOLDS,
  evaluateContentQuality,
  MARKETING_QUALITY_VERSION,
} from "../_shared/marketing_quality.ts";

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
      return fail("CONFIG_REQUIRED", "A required configuration is missing", 422);
    case "MK429":
      return fail("RATE_LIMITED", "Rate limit reached — try again later", 429);
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

const CONTENT_KEYS = ["subject", "preview_text", "body_authored", "token_fallbacks"];
// every MUTATION carries a mandatory client request_id (validated + replayed
// through the canonical marketing_request_keys ledger inside the RPC)
const ACTION_KEYS: Record<string, string[]> = {
  list: ["action", "status", "search", "limit", "cursor"],
  detail: ["action", "template_id"],
  create: ["action", "name", "description", ...CONTENT_KEYS, "request_id"],
  revise: ["action", "template_id", "expected_version", "changes", "request_id"],
  duplicate: ["action", "template_id", "name", "request_id"],
  archive: ["action", "template_id", "expected_version", "request_id"],
  restore: ["action", "template_id", "expected_version", "request_id"],
  preview: ["action", "content"],
  quality_check: ["action", "content", "sender_id"],
  use_in_broadcast: [
    "action",
    "template_revision_id",
    "mode",
    "name",
    "description",
    "sender_id",
    "segment_id",
    "campaign_id",
    "expected_version",
    "request_id",
  ],
  use_in_sequence_step: [
    "action",
    "template_revision_id",
    "campaign_id",
    "expected_version",
    "step_key",
    "append_step",
    "request_id",
  ],
};
const DRAFT_ACTIONS = new Set([
  "create",
  "revise",
  "duplicate",
  "archive",
  "restore",
  "use_in_broadcast",
  "use_in_sequence_step",
]);

/** validate an inline content object for preview/quality (server-side shape gate) */
function readContent(v: unknown): { ok: true; c: Row } | { ok: false; msg: string } {
  if (!isPlainObject(v)) return { ok: false, msg: "content must be an object" };
  for (const k of Object.keys(v)) {
    if (!CONTENT_KEYS.includes(k)) return { ok: false, msg: `unknown content key '${k}'` };
  }
  if (typeof v.subject !== "string" || v.subject.length === 0 || v.subject.length > 300) {
    return { ok: false, msg: "subject must be a 1-300 char string" };
  }
  if (
    v.preview_text !== undefined &&
    v.preview_text !== null &&
    (typeof v.preview_text !== "string" || v.preview_text.length > 150)
  ) {
    return { ok: false, msg: "preview_text must be null or up to 150 chars" };
  }
  if (
    typeof v.body_authored !== "string" ||
    v.body_authored.length === 0 ||
    v.body_authored.length > 20000
  ) {
    return { ok: false, msg: "body_authored must be a 1-20000 char string" };
  }
  if (v.token_fallbacks !== undefined && !isPlainObject(v.token_fallbacks)) {
    return { ok: false, msg: "token_fallbacks must be an object" };
  }
  return { ok: true, c: v };
}

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
    return fail("INVALID_REQUEST", "marketing-templates is a user-facing endpoint", 400);
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

  const perms = await admin.rpc("marketing_effective_permissions", { p_profile_id: userId });
  if (perms.error) return fail("INTERNAL", "Could not resolve permissions", 500);
  const verdict = (perms.data ?? {}) as Row;
  const permissionSet: string[] = Array.isArray(verdict.permissions) ? verdict.permissions : [];
  if (verdict.enabled !== true || !permissionSet.includes("marketing.view")) {
    return fail("FORBIDDEN", "Requires Marketing access", 403);
  }
  if (DRAFT_ACTIONS.has(action)) {
    if (!["owner", "admin", "ops"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Template authoring requires an operational role", 403);
    }
    if (!permissionSet.includes("marketing.campaigns.draft")) {
      return fail("FORBIDDEN", "Requires marketing.campaigns.draft", 403);
    }
  }

  try {
    switch (action) {
      case "list": {
        const args: Row = {};
        if (body.status !== undefined) args.status = body.status;
        if (body.search !== undefined) args.search = body.search;
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        if (body.cursor !== undefined) args.cursor = body.cursor;
        const r = await admin.rpc("marketing_template_list", { p_tenant: tenantId, p_args: args });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "detail": {
        if (!isUuid(body.template_id)) {
          return fail("INVALID_REQUEST", "template_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_template_detail", {
          p_tenant: tenantId,
          p_template: body.template_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "create": {
        const args: Row = {};
        for (const k of ["name", "description", ...CONTENT_KEYS, "request_id"]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_template_create", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "revise": {
        if (!isUuid(body.template_id)) {
          return fail("INVALID_REQUEST", "template_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        if (!isPlainObject(body.changes)) {
          return fail("INVALID_REQUEST", "changes must be an object", 400);
        }
        for (const k of Object.keys(body.changes)) {
          // the browser can never plant AI/template lineage — lineage travels
          // only through the governed use/accept paths
          if (!["name", "description", ...CONTENT_KEYS].includes(k)) {
            return fail("INVALID_REQUEST", `unknown change key '${k}'`, 400);
          }
        }
        const r = await admin.rpc("marketing_template_revise", {
          p_tenant: tenantId,
          p_actor: userId,
          p_template: body.template_id,
          // the request id rides INSIDE p_args (the RPC's ledger contract);
          // the browser still cannot plant lineage — the changes allowlist
          // above stands
          p_args: { ...body.changes, request_id: body.request_id },
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "duplicate": {
        if (!isUuid(body.template_id)) {
          return fail("INVALID_REQUEST", "template_id must be a uuid", 400);
        }
        const args: Row = {};
        if (body.name !== undefined) args.name = body.name;
        if (body.request_id !== undefined) args.request_id = body.request_id;
        const r = await admin.rpc("marketing_template_duplicate", {
          p_tenant: tenantId,
          p_actor: userId,
          p_template: body.template_id,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "archive":
      case "restore": {
        if (!isUuid(body.template_id)) {
          return fail("INVALID_REQUEST", "template_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const r = await admin.rpc("marketing_template_set_status", {
          p_tenant: tenantId,
          p_actor: userId,
          p_template: body.template_id,
          p_args: {
            status: action === "archive" ? "archived" : "active",
            request_id: body.request_id,
          },
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "preview": {
        const c = readContent(body.content);
        if (!c.ok) return fail("INVALID_REQUEST", c.msg, 400);
        // deterministic render through the ONE canonical renderer, with an
        // explicitly-labelled SAMPLE persona and placeholder unsubscribe URL.
        // Nothing here is sent anywhere.
        try {
          const rendered = renderBroadcast({
            subject: c.c.subject,
            previewText: (c.c.preview_text as string | null) ?? null,
            bodyAuthored: c.c.body_authored,
            context: {
              first_name: "Sam",
              last_name: "Taylor",
              display_name: "Sam Taylor",
              company_name: "Sample Company Ltd",
            },
            fallbacks: (c.c.token_fallbacks as Record<string, string>) ?? {},
            signatureText: null,
            footerLines: ["(preview only — footer identity comes from tenant settings)"],
            unsubscribeUrl: "https://example.invalid/unsubscribe-preview",
          });
          return json({
            ok: true,
            data: {
              sample_context: {
                first_name: "Sam",
                last_name: "Taylor",
                display_name: "Sam Taylor",
                company_name: "Sample Company Ltd",
              },
              note: "Rendered with SAMPLE data and a placeholder unsubscribe link — the live footer, signature and unsubscribe URL come from the sending campaign.",
              subject: rendered.subject,
              text: rendered.text,
              html: rendered.html,
              preview_text: rendered.previewText,
            },
          });
        } catch (e) {
          return fail(
            "INVALID_REQUEST",
            e instanceof Error ? e.message.slice(0, 200) : "content did not render",
            400,
          );
        }
      }
      case "quality_check": {
        const c = readContent(body.content);
        if (!c.ok) return fail("INVALID_REQUEST", c.msg, 400);
        let senderSignaturePresent: boolean | undefined;
        if (body.sender_id !== undefined) {
          if (!isUuid(body.sender_id)) {
            return fail("INVALID_REQUEST", "sender_id must be a uuid", 400);
          }
          const s = await admin
            .from("marketing_sender_profiles")
            .select("signature_text")
            .eq("tenant_id", tenantId)
            .eq("id", body.sender_id)
            .maybeSingle();
          if (!s.error && s.data) {
            senderSignaturePresent = Boolean(
              (s.data.signature_text ?? "").toString().trim().length > 0,
            );
          }
        }
        // tenant-configurable thresholds via the forward-compatible settings bag
        const st = await admin
          .from("marketing_settings")
          .select("settings")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        const q = isPlainObject(st.data?.settings) ? (st.data?.settings as Row).quality : null;
        const thresholds: Row = {};
        if (isPlainObject(q)) {
          for (const key of ["subjectMax", "linkMax", "bodyMax", "paragraphMax"]) {
            if (typeof q[key] === "number" && Number.isInteger(q[key]) && q[key] > 0) {
              thresholds[key] = q[key];
            }
          }
        }
        const findings = evaluateContentQuality({
          subject: c.c.subject,
          previewText: (c.c.preview_text as string | null) ?? null,
          bodyAuthored: c.c.body_authored,
          tokenFallbacks: (c.c.token_fallbacks as Record<string, string>) ?? {},
          senderSignaturePresent,
          thresholds,
        });
        return json({
          ok: true,
          data: {
            version: MARKETING_QUALITY_VERSION,
            advisory: true,
            note: "Deterministic editorial guidance — not AI, never blocking. Technical safety is enforced by the canonical content validator.",
            thresholds: { ...DEFAULT_QUALITY_THRESHOLDS, ...thresholds },
            findings,
          },
        });
      }
      case "use_in_broadcast": {
        const args: Row = {};
        for (const k of [
          "template_revision_id",
          "mode",
          "name",
          "description",
          "sender_id",
          "segment_id",
          "campaign_id",
          "expected_version",
          "request_id",
        ]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_template_use_in_broadcast", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "use_in_sequence_step": {
        const args: Row = {};
        for (const k of [
          "template_revision_id",
          "campaign_id",
          "expected_version",
          "step_key",
          "append_step",
          "request_id",
        ]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_template_use_in_sequence_step", {
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
  } catch (e) {
    console.error("marketing-templates error", e instanceof Error ? e.message : e);
    return fail("INTERNAL", "The operation failed", 500);
  }
});
