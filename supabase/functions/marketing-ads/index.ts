// ServiceOS — Marketing Ads management/read API (Phase 8).
//
// AUTHORITY MODEL (identical to the other marketing-* functions):
// requireTenantUser derives tenant + actor from the JWT (never the body);
// every action passes the DOUBLE GATE — an Edge role/permission check AND the
// canonical SQL gate inside every mutating RPC.
//
//   reads (overview/source_list/source_detail/lead_feed/lead_detail/
//          attribution/metrics/health):                     marketing.view
//   source_create/revise/status/webhook_setup/manual_sync/
//   event_retry:            owner/admin role + marketing.ads.manage
//                           (the STRUCTURAL ceiling is ALSO enforced inside
//                           every RPC — a hostile grant cannot reach it)
//
// The webhook signing secret is generated SERVER-SIDE, stored straight into
// the tenant Vault broker and returned exactly ONCE in the webhook_setup
// response — it is never persisted outside the Vault, never readable again,
// and never logged. Ads captures and attributes leads; it does not create or
// edit advertisements — and this API cannot contact any ad provider.
//
// Stable error contract: INVALID_REQUEST / NOT_FOUND / FORBIDDEN /
// VERSION_CONFLICT / REQUEST_MISMATCH / UNSUPPORTED / INTERNAL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { ADS_ADAPTER_CATALOGUE } from "../_shared/marketing_ads_adapters.ts";

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
    case "MK430":
      return fail("UNSUPPORTED", err.message ?? "This provider does not support that", 422);
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
  overview: ["action"],
  catalogue: ["action"],
  source_list: ["action", "status"],
  source_detail: ["action", "source_id"],
  source_create: [
    "action",
    "provider",
    "name",
    "description",
    "account_ref",
    "campaign_ref",
    "ad_ref",
    "form_ref",
    "default_tag_id",
    "default_relationship_type",
    "default_lifecycle_stage_key",
    "default_owner_id",
    "notify_attention",
    "timezone",
    "request_id",
  ],
  source_revise: ["action", "source_id", "expected_version", "changes", "request_id"],
  source_status: ["action", "source_id", "expected_version", "status", "request_id"],
  webhook_setup: ["action", "source_id", "expected_version", "request_id"],
  manual_sync: ["action", "source_id", "request_id"],
  event_retry: ["action", "event_id", "request_id"],
  lead_feed: ["action", "window", "source_id", "state", "limit", "cursor"],
  lead_detail: ["action", "event_id"],
  attribution: ["action", "person_id"],
  metrics: ["action", "source_id", "from", "to"],
  health: ["action"],
};
const MANAGE_ACTIONS = new Set([
  "source_create",
  "source_revise",
  "source_status",
  "webhook_setup",
  "manual_sync",
  "event_retry",
]);

function randomSecretHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
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
    return fail("INVALID_REQUEST", "marketing-ads is a user-facing endpoint", 400);
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
  if (MANAGE_ACTIONS.has(action)) {
    if (!["owner", "admin"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Ad source management requires owner/admin", 403);
    }
    if (!permissionSet.includes("marketing.ads.manage")) {
      return fail("FORBIDDEN", "Requires marketing.ads.manage", 403);
    }
  }

  try {
    switch (action) {
      case "overview": {
        const r = await admin.rpc("marketing_ads_overview", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "catalogue": {
        // the TRUTHFUL provider catalogue — implemented flags are facts
        return json({ ok: true, data: { providers: ADS_ADAPTER_CATALOGUE } });
      }
      case "source_list": {
        const args: Row = {};
        if (body.status !== undefined) args.status = body.status;
        const r = await admin.rpc("marketing_ad_source_list", {
          p_tenant: tenantId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "source_detail": {
        if (!isUuid(body.source_id)) {
          return fail("INVALID_REQUEST", "source_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ad_source_detail", {
          p_tenant: tenantId,
          p_source: body.source_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "source_create": {
        const args: Row = {};
        for (const k of ACTION_KEYS.source_create) {
          if (k !== "action" && body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_ad_source_create", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "source_revise": {
        if (!isUuid(body.source_id)) {
          return fail("INVALID_REQUEST", "source_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        if (!isPlainObject(body.changes)) {
          return fail("INVALID_REQUEST", "changes must be an object", 400);
        }
        const r = await admin.rpc("marketing_ad_source_revise", {
          p_tenant: tenantId,
          p_actor: userId,
          p_source: body.source_id,
          p_args: { ...body.changes, request_id: body.request_id },
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "source_status": {
        if (!isUuid(body.source_id)) {
          return fail("INVALID_REQUEST", "source_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const r = await admin.rpc("marketing_ad_source_set_status", {
          p_tenant: tenantId,
          p_actor: userId,
          p_source: body.source_id,
          p_args: { status: body.status, request_id: body.request_id },
          p_expected_version: body.expected_version,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "webhook_setup": {
        // Generate/rotate the per-source signing secret. IDEMPOTENCY-FIRST: the
        // governed credential mark (request-id gated) runs BEFORE any Vault
        // write, so a replayed request_id can NEVER rotate twice and NEVER
        // re-reveals a secret — it converges on the stored (secret-less)
        // result. Only a genuinely fresh mark performs the Vault side effects:
        // current → previous (bounded overlap), new secret in, returned ONCE.
        if (!isUuid(body.source_id)) {
          return fail("INVALID_REQUEST", "source_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const srcRes = await admin
          .from("marketing_ad_sources")
          .select("id, mode, status, public_key")
          .eq("tenant_id", tenantId)
          .eq("id", body.source_id)
          .maybeSingle();
        if (srcRes.error || !srcRes.data) return fail("NOT_FOUND", "Not found", 404);
        if (srcRes.data.mode !== "webhook") {
          return fail("UNSUPPORTED", "Only a signed-webhook source carries a signing secret", 422);
        }
        const provider = `ads-src-${body.source_id}`;
        const marked = await admin.rpc("marketing_ad_source_credential_mark", {
          p_tenant: tenantId,
          p_actor: userId,
          p_source: body.source_id,
          p_args: { request_id: body.request_id },
          p_expected_version: body.expected_version,
        });
        if (marked.error) return mapDbError(marked.error);
        const markData = (marked.data ?? {}) as Row;
        const publicMeta = {
          public_key: srcRes.data.public_key,
          endpoint_path: `/functions/v1/marketing-ad-webhook/${srcRes.data.public_key}`,
        };
        if (markData.replayed === true) {
          // a repeat of an already-completed setup: no rotation, no secret. The
          // one-time secret from the original call cannot be retrieved again.
          return json({
            ok: true,
            data: {
              ...markData,
              ...publicMeta,
              shown_once: false,
              note: "This setup request was already completed; the signing secret is shown only once and cannot be retrieved again. Rotate to obtain a new secret.",
            },
          });
        }
        // fresh: preserve the outgoing secret as `previous` (rotation only), then
        // store the new one. The mark already committed the version + rotation
        // clock; if a Vault write fails here the source keeps failing closed
        // (the webhook reads no usable secret → generic 401) until a re-rotation.
        if (markData.rotated === true) {
          const current = await admin.rpc("provider_secret_read", {
            p_tenant: tenantId,
            p_provider: provider,
            p_field: "signing_key",
          });
          if (!current.error && typeof current.data === "string" && current.data.length > 0) {
            const kept = await admin.rpc("provider_secret_store", {
              p_tenant: tenantId,
              p_provider: provider,
              p_field: "signing_key_previous",
              p_secret: current.data,
            });
            if (kept.error) return fail("INTERNAL", "Could not rotate the credential", 500);
          }
        }
        const secret = randomSecretHex(32);
        const stored = await admin.rpc("provider_secret_store", {
          p_tenant: tenantId,
          p_provider: provider,
          p_field: "signing_key",
          p_secret: secret,
        });
        if (stored.error) return fail("INTERNAL", "Could not store the credential", 500);
        return json({
          ok: true,
          data: {
            ...markData,
            ...publicMeta,
            signing_secret: secret,
            shown_once: true,
            note: "Store this secret now — it is kept only in the tenant Vault and can never be read again, only rotated.",
          },
        });
      }
      case "manual_sync": {
        if (!isUuid(body.source_id)) {
          return fail("INVALID_REQUEST", "source_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ad_manual_sync", {
          p_tenant: tenantId,
          p_actor: userId,
          p_source: body.source_id,
          p_args: { request_id: body.request_id },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "event_retry": {
        if (!isUuid(body.event_id)) {
          return fail("INVALID_REQUEST", "event_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ad_event_retry", {
          p_tenant: tenantId,
          p_actor: userId,
          p_event: body.event_id,
          p_args: { request_id: body.request_id },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "lead_feed": {
        const args: Row = {};
        for (const k of ["window", "source_id", "state", "cursor"]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          args.limit = body.limit;
        }
        const r = await admin.rpc("marketing_ad_lead_feed", {
          p_tenant: tenantId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "lead_detail": {
        if (!isUuid(body.event_id)) {
          return fail("INVALID_REQUEST", "event_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ad_event_detail", {
          p_tenant: tenantId,
          p_event: body.event_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "attribution": {
        if (!isUuid(body.person_id)) {
          return fail("INVALID_REQUEST", "person_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_ad_attribution", {
          p_tenant: tenantId,
          p_args: { person_id: body.person_id },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "metrics": {
        const args: Row = {};
        for (const k of ["source_id", "from", "to"]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_ad_metrics", {
          p_tenant: tenantId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "health": {
        const r = await admin.rpc("marketing_ad_source_health", { p_tenant: tenantId });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch (e) {
    console.error("marketing-ads error", e instanceof Error ? e.message : e);
    return fail("INTERNAL", "The operation failed", 500);
  }
});
