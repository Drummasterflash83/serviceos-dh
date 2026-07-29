// ServiceOS — Marketing sender configuration + governed test-send API (Phase 4).
//
// AUTHORITY MODEL (identical to marketing-admin): requireTenantUser derives
// tenant + actor from the JWT (never the body); sender administration demands
// an owner/admin role at the Edge AND canonical marketing.senders.manage from
// the SQL resolver inside every RPC; test sends demand marketing.campaigns.test
// from the resolver; reads demand marketing.view. A hostile raw grant row can
// never bypass the owner/admin ceiling (the resolver enforces the restricted
// set), and a wrong-tenant caller dies at requireTenantUser.
//
// Actions: overview · recipients · sender_create · sender_update ·
// sender_enable · sender_disable · sender_set_default · sender_verify ·
// test_send · test_status.
//
// Provider truth: sender send-scope state is derived ONLY here (server-side)
// from authoritative evidence — the STORED Gmail OAuth grant
// (email_oauth_tokens.scope) or a REAL minimal DWD gmail.send token mint —
// and recorded via marketing_sender_record_verification. No token, key or raw
// provider payload ever reaches the browser.
//
// Delivery boundary: this function NEVER calls Gmail to send. A test send
// creates the canonical immutable lineage in SQL and enqueues the untouched
// Automation Engine (automation.execute) plus the marketing.delivery_sync
// projection job. Stable error contract: INVALID_REQUEST / NOT_FOUND /
// FORBIDDEN / VERSION_CONFLICT / DUPLICATE / RATE_LIMITED / INTERNAL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import { writeAudit } from "../_shared/audit.ts";
import { enqueueAutomationExecution } from "../_shared/automation_execution_enqueue.ts";
import { enqueueJob } from "../_shared/platform_queue.ts";
import { evaluateGmailSendScope, GMAIL_SEND_SCOPE } from "../_shared/marketing_email.ts";
import { DelegationError, getDelegatedGmailSendToken } from "../_shared/google_workspace.ts";

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
    case "MK429":
      return fail("RATE_LIMITED", "Test-send rate limit reached — try again later", 429);
    case "MK412":
      return fail(
        "REQUEST_MISMATCH",
        "That request id was already used for a different request",
        409,
      );
    case "MK423":
      return fail("LOCKOUT", "That change would remove required access", 409);
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
  overview: ["action"],
  recipients: ["action"],
  sender_create: [
    "action",
    "source_kind",
    "source_id",
    "label",
    "from_name",
    "reply_to",
    "signature_text",
  ],
  sender_update: ["action", "sender_id", "changes", "expected_updated_at"],
  sender_enable: ["action", "sender_id", "expected_updated_at"],
  sender_disable: ["action", "sender_id", "expected_updated_at"],
  sender_set_default: ["action", "sender_id", "expected_updated_at"],
  sender_verify: ["action", "sender_id"],
  test_send: ["action", "sender_id", "recipient_profile_id", "subject", "body_text", "request_id"],
  test_status: ["action", "limit"],
};
const MANAGE_ACTIONS = new Set([
  "sender_create",
  "sender_update",
  "sender_enable",
  "sender_disable",
  "sender_set_default",
  "sender_verify",
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
    return fail("INVALID_REQUEST", "marketing-senders is a user-facing endpoint", 400);
  }

  let body: Row;
  try {
    const parsed = await req.json();
    if (!isPlainObject(parsed)) return fail("INVALID_REQUEST", "Body must be an object", 400);
    body = parsed;
  } catch {
    // malformed JSON is an error, never silently treated as an empty request
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

  // canonical effective permissions — role gates are necessary, never sufficient
  const perms = await admin.rpc("marketing_effective_permissions", { p_profile_id: userId });
  if (perms.error) return fail("INTERNAL", "Could not resolve permissions", 500);
  const verdict = (perms.data ?? {}) as Row;
  const permissionSet: string[] = Array.isArray(verdict.permissions) ? verdict.permissions : [];
  const enabled = verdict.enabled === true;
  if (!enabled || !permissionSet.includes("marketing.view")) {
    return fail("FORBIDDEN", "Requires Marketing access", 403);
  }
  if (MANAGE_ACTIONS.has(action)) {
    if (!["owner", "admin"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Sender administration requires owner/admin", 403);
    }
    if (!permissionSet.includes("marketing.senders.manage")) {
      return fail("FORBIDDEN", "Requires marketing.senders.manage", 403);
    }
  }

  const auditRejected = async (
    auditAction: string,
    code: string,
    detail: Record<string, unknown>,
  ) => {
    try {
      await writeAudit(admin, {
        tenantId,
        actor: auth.ctx.email ?? userId,
        action: auditAction,
        resourceType: "marketing_sender",
        status: "denied",
        detail: { code, ...detail },
      });
    } catch {
      // auditing a rejection must never mask the rejection
    }
  };

  try {
    switch (action) {
      // ── overview: sources + senders + readiness + capability + mode truth ──
      case "overview": {
        const [sources, senders, settings, mode] = await Promise.all([
          admin.rpc("marketing_sender_sources", { p_tenant: tenantId }),
          admin
            .from("marketing_sender_profiles")
            .select(
              "id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address, label, from_name, reply_to, signature_text, enabled, send_scope_state, scope_checked_at, last_verified_at, verification_note, created_at, updated_at",
            )
            .eq("tenant_id", tenantId)
            .order("created_at", { ascending: true }),
          admin
            .from("marketing_settings")
            .select("default_sender_profile_id, marketing_enabled")
            .eq("tenant_id", tenantId)
            .maybeSingle(),
          admin
            .from("operating_profile_entries")
            .select("tenant_id, value")
            .eq("namespace", "operational_mode")
            .eq("key", "current")
            .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`),
        ]);
        if (sources.error || senders.error) {
          return fail("INTERNAL", "Could not load sender overview", 500);
        }
        // SELF-HEALING boundary: re-derive capability truth from live source
        // state BEFORE reading it — the overview never reports a stale
        // capability row alongside fresh readiness. (Triggers on the source
        // tables already keep this current; the sync here is a belt-and-braces
        // floor and is skipped for tenants with no sender profile at all.)
        if ((senders.data ?? []).length > 0) {
          const sync = await admin.rpc("marketing_sender_capability_sync", {
            p_tenant: tenantId,
          });
          if (sync.error) {
            return fail("INTERNAL", "Could not derive capability state", 500);
          }
        }
        const [health, capability] = await Promise.all([
          admin.rpc("marketing_sender_health", { p_tenant: tenantId }),
          admin
            .from("tenant_connector_capabilities")
            .select("enabled")
            .eq("tenant_id", tenantId)
            .eq("connector_id", "google-gmail")
            .eq("capability_key", "email.send_marketing")
            .maybeSingle(),
        ]);
        // ONE canonical readiness derivation (SQL, live authoritative source
        // state — each DWD mailbox resolved against ITS OWN connection, so a
        // tenant with several Workspace connections reads each correctly)
        const readinessAll = await admin.rpc("marketing_sender_readiness_all", {
          p_tenant: tenantId,
        });
        if (readinessAll.error) {
          return fail("INTERNAL", "Could not derive sender readiness", 500);
        }
        const readinessById = new Map(
          ((readinessAll.data ?? []) as Row[]).map((r: Row) => [r.sender_id, r]),
        );
        const senderRows = (senders.data ?? []).map((s: Row) => ({
          ...s,
          readiness: readinessById.get(s.id) ?? { ready: false, state: "unknown" },
        }));
        // tenant-scoped mode override wins over the platform row
        const modeRows = (mode.data ?? []) as Row[];
        const tenantMode = modeRows.find((r) => r.tenant_id === tenantId) ?? modeRows[0] ?? null;
        const currentMode =
          typeof tenantMode?.value === "string"
            ? tenantMode.value
            : ((tenantMode?.value ?? null) as string | null);
        return json({
          ok: true,
          data: {
            sources: sources.data,
            senders: senderRows,
            default_sender_profile_id: settings.data?.default_sender_profile_id ?? null,
            marketing_enabled: settings.data?.marketing_enabled ?? true,
            capability_enabled: capability.data?.enabled === true,
            health: health.error ? null : health.data,
            operational_mode: currentMode,
            // honest: an irreversible external send executes only in a mode
            // that allows irreversible execution; otherwise intents park as
            // mode-blocked with the real reason
            mode_permits_send: currentMode === "trusted" || currentMode === "optimisation",
            required_send_scope: GMAIL_SEND_SCOPE,
            can_manage:
              ["owner", "admin"].includes(auth.ctx.role) &&
              permissionSet.includes("marketing.senders.manage"),
            can_test: permissionSet.includes("marketing.campaigns.test"),
          },
        });
      }

      // ── recipients: the SERVER-ISSUED test-recipient directory ──
      case "recipients": {
        if (!permissionSet.includes("marketing.campaigns.test")) {
          return fail("FORBIDDEN", "Requires marketing.campaigns.test", 403);
        }
        const r = await admin
          .from("profiles")
          .select("id, email, role")
          .eq("tenant_id", tenantId)
          .not("email", "is", null)
          .order("email", { ascending: true })
          .limit(50);
        if (r.error) return fail("INTERNAL", "Could not load recipients", 500);
        return json({ ok: true, data: { recipients: r.data ?? [] } });
      }

      // ── sender lifecycle (owner/admin + canonical senders.manage) ──
      case "sender_create": {
        const r = await admin.rpc("marketing_sender_create", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: {
            source_kind: body.source_kind,
            source_id: body.source_id,
            ...(body.label !== undefined ? { label: body.label } : {}),
            ...(body.from_name !== undefined ? { from_name: body.from_name } : {}),
            ...(body.reply_to !== undefined ? { reply_to: body.reply_to } : {}),
            ...(body.signature_text !== undefined ? { signature_text: body.signature_text } : {}),
          },
        });
        if (r.error) {
          if (["42501", "22023"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.sender.created", r.error.code ?? "", {
              source_kind: body.source_kind,
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "sender_update": {
        if (
          !isUuid(body.sender_id) ||
          !isPlainObject(body.changes) ||
          typeof body.expected_updated_at !== "string"
        ) {
          return fail(
            "INVALID_REQUEST",
            "sender_id, changes and expected_updated_at required",
            400,
          );
        }
        const r = await admin.rpc("marketing_sender_update", {
          p_tenant: tenantId,
          p_actor: userId,
          p_sender: body.sender_id,
          p_changes: body.changes,
          p_expected: body.expected_updated_at,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "sender_enable":
      case "sender_disable": {
        if (!isUuid(body.sender_id) || typeof body.expected_updated_at !== "string") {
          return fail("INVALID_REQUEST", "sender_id and expected_updated_at required", 400);
        }
        const r = await admin.rpc("marketing_sender_set_enabled", {
          p_tenant: tenantId,
          p_actor: userId,
          p_sender: body.sender_id,
          p_enabled: action === "sender_enable",
          p_expected: body.expected_updated_at,
        });
        if (r.error) {
          if (["42501", "22023", "MK409"].includes(r.error.code ?? "")) {
            await auditRejected(
              action === "sender_enable" ? "marketing.sender.enabled" : "marketing.sender.disabled",
              r.error.code ?? "",
              { sender_id: body.sender_id },
            );
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }
      case "sender_set_default": {
        if (!isUuid(body.sender_id) || typeof body.expected_updated_at !== "string") {
          return fail("INVALID_REQUEST", "sender_id and expected_updated_at required", 400);
        }
        const r = await admin.rpc("marketing_sender_set_default", {
          p_tenant: tenantId,
          p_actor: userId,
          p_sender: body.sender_id,
          p_expected: body.expected_updated_at,
        });
        if (r.error) {
          if (["42501", "22023", "MK409"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.sender.default_set", r.error.code ?? "", {
              sender_id: body.sender_id,
            });
          }
          return mapDbError(r.error);
        }
        return json({ ok: true, data: r.data });
      }

      // ── sender_verify: REAL provider evidence, derived server-side ──
      case "sender_verify": {
        if (!isUuid(body.sender_id)) {
          return fail("INVALID_REQUEST", "sender_id required", 400);
        }
        const sender = await admin
          .from("marketing_sender_profiles")
          .select("id, source_kind, email_account_id, workspace_mailbox_id, mailbox_address")
          .eq("tenant_id", tenantId)
          .eq("id", body.sender_id)
          .maybeSingle();
        if (!sender.data) return fail("NOT_FOUND", "Sender not found", 404);

        let state: "authorized" | "missing" | "unknown" = "unknown";
        let note: string;
        let verifiedAt: string | null = null;
        if (sender.data.source_kind === "gmail_oauth") {
          if (!sender.data.email_account_id) {
            state = "unknown";
            note = "Source mailbox is disconnected";
          } else {
            const token = await admin
              .from("email_oauth_tokens")
              .select("scope")
              .eq("email_account_id", sender.data.email_account_id)
              .eq("tenant_id", tenantId)
              .maybeSingle();
            if (!token.data) {
              state = "unknown";
              note = "No stored Gmail authorisation for this account";
            } else {
              state = evaluateGmailSendScope(token.data.scope ?? null);
              note =
                state === "authorized"
                  ? "gmail.send present in the stored OAuth grant"
                  : "Stored OAuth grant lacks gmail.send — re-authorisation required";
              if (state === "authorized") verifiedAt = new Date().toISOString();
            }
          }
        } else {
          // Workspace DWD: the ONLY honest proof is a real minimal token mint
          // (gmail.send only, impersonating exactly this mailbox). No email is
          // sent and no token is exposed.
          try {
            await getDelegatedGmailSendToken(sender.data.mailbox_address);
            state = "authorized";
            note = "Delegated gmail.send token minted for this mailbox";
            verifiedAt = new Date().toISOString();
          } catch (e) {
            if (e instanceof DelegationError) {
              state = e.permanent ? "missing" : "unknown";
              note = e.permanent
                ? `Workspace delegation refused gmail.send (${e.code}) — extend the DWD grant`
                : `Delegation temporarily unavailable (${e.code}) — try again`;
            } else {
              state = "unknown";
              note = "Verification failed unexpectedly — try again";
            }
          }
        }
        const r = await admin.rpc("marketing_sender_record_verification", {
          p_tenant: tenantId,
          p_sender: body.sender_id,
          p_state: state,
          p_note: note,
          p_verified_at: verifiedAt,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }

      // ── governed test send (explicit, bounded, idempotent) ──
      case "test_send": {
        if (!["owner", "admin", "ops"].includes(auth.ctx.role)) {
          return fail("FORBIDDEN", "Test sends require an operational role", 403);
        }
        if (!permissionSet.includes("marketing.campaigns.test")) {
          return fail("FORBIDDEN", "Requires marketing.campaigns.test", 403);
        }
        if (
          !isUuid(body.sender_id) ||
          !isUuid(body.recipient_profile_id) ||
          typeof body.subject !== "string" ||
          typeof body.body_text !== "string" ||
          typeof body.request_id !== "string"
        ) {
          return fail(
            "INVALID_REQUEST",
            "sender_id, recipient_profile_id, subject, body_text and request_id required",
            400,
          );
        }
        const r = await admin.rpc("marketing_test_send_request", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: {
            sender_id: body.sender_id,
            recipient_profile_id: body.recipient_profile_id,
            subject: body.subject,
            body_text: body.body_text,
            request_id: body.request_id,
          },
        });
        if (r.error) {
          if (["42501", "22023", "MK429"].includes(r.error.code ?? "")) {
            await auditRejected("marketing.test_send.requested", r.error.code ?? "", {
              sender_id: body.sender_id,
            });
          }
          return mapDbError(r.error);
        }
        const out = (r.data ?? {}) as Row;
        // hand the authorised intent to the UNTOUCHED engine + start the
        // bounded projection poller (idempotent job keys on both)
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

      // ── bounded status/history (with a lazy reconcile for freshness) ──
      case "test_status": {
        let limit = 20;
        if (body.limit !== undefined) {
          if (typeof body.limit !== "number" || !Number.isInteger(body.limit)) {
            return fail("INVALID_REQUEST", "limit must be an integer", 400);
          }
          limit = Math.min(Math.max(body.limit, 1), 50);
        }
        const pending = await admin
          .from("marketing_deliveries")
          .select("id")
          .eq("tenant_id", tenantId)
          .in("status", ["queued", "executing"])
          .limit(10);
        for (const row of pending.data ?? []) {
          await admin.rpc("marketing_delivery_reconcile", {
            p_tenant: tenantId,
            p_delivery: row.id,
          });
        }
        const r = await admin.rpc("marketing_test_send_status", {
          p_tenant: tenantId,
          p_args: { limit },
        });
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
