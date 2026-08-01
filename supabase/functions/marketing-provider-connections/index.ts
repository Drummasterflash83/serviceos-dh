// ServiceOS — Marketing Provider Connections API (Phase 9 — platform seams).
//
// AUTHORITY MODEL (identical to the other marketing-* functions):
// requireTenantUser derives tenant + actor from the JWT (never the body);
// every action passes the DOUBLE GATE — an Edge role/permission check AND the
// canonical SQL gate inside every mutating RPC.
//
//   reads (catalogue/list):              marketing.view
//   account_create/connect/credential_set/revoke/sync_request:
//                                        owner/admin role + marketing.ads.manage
//                                        (the STRUCTURAL ceiling is ALSO
//                                        enforced inside every RPC)
//
// HONESTY: zero connection adapters exist in this build. A connect attempt is
// recorded as facts and lands in error/'no_adapter' (the SQL bakes the same
// truth); sync refuses for every non-connected account; the catalogue states
// implemented:false plainly. Nothing here can contact a provider.
//
// CREDENTIALS: an operator-supplied provider credential goes STRAIGHT into
// the tenant Vault broker after the idempotency mark commits — it is never
// persisted outside the Vault, never echoed back, and never logged. A
// replayed request id stores nothing and rotates nothing (the mark verdict
// arrives BEFORE any Vault write — the Phase-8 F3 contract). A rotation
// preserves the outgoing credential as credential_key_previous for the
// bounded 86400 s overlap only.
//
// Stable error contract: INVALID_REQUEST / NOT_FOUND / FORBIDDEN /
// VERSION_CONFLICT / REQUEST_MISMATCH / UNSUPPORTED / DUPLICATE / INTERNAL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireTenantUser } from "../_shared/authz.ts";
import {
  connectionVaultProvider,
  PROVIDER_CONNECTION_CATALOGUE,
} from "../_shared/marketing_provider_connections.ts";
import {
  getProviderAdapter,
  SERVICEOS_TEST_PROVIDER,
} from "../_shared/marketing_provider_adapter_contract.ts";

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
      return fail("DUPLICATE", "A sync is already queued or running for this connection", 409);
    case "23000":
    case "23503":
    case "23514":
      return fail("INVALID_REQUEST", "The request violated a data rule", 400);
    default:
      return fail("INTERNAL", "The operation failed", 500);
  }
}

const ACTION_KEYS: Record<string, string[]> = {
  catalogue: ["action"],
  list: ["action"],
  account_create: [
    "action",
    "provider",
    "display_name",
    "stale_after_seconds",
    "sync_cadence_minutes",
    "request_id",
  ],
  connect: ["action", "account_id", "expected_version", "request_id"],
  external_select: ["action", "account_id", "expected_version", "external_ref", "request_id"],
  credential_set: ["action", "account_id", "expected_version", "credential", "request_id"],
  revoke: ["action", "account_id", "expected_version", "request_id"],
  sync_request: ["action", "account_id", "request_id"],
  report: ["action", "account_id"],
  runs: ["action", "account_id"],
};
const MANAGE_ACTIONS = new Set([
  "account_create",
  "connect",
  "external_select",
  "credential_set",
  "revoke",
  "sync_request",
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
    return fail("INVALID_REQUEST", "marketing-provider-connections is a user-facing endpoint", 400);
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
  if (MANAGE_ACTIONS.has(action)) {
    if (!["owner", "admin"].includes(auth.ctx.role)) {
      return fail("FORBIDDEN", "Connection management requires owner/admin", 403);
    }
    if (!permissionSet.includes("marketing.ads.manage")) {
      return fail("FORBIDDEN", "Requires marketing.ads.manage", 403);
    }
  }

  try {
    switch (action) {
      case "catalogue": {
        // the TRUTHFUL connection catalogue — implemented flags are facts
        return json({ ok: true, data: { providers: PROVIDER_CONNECTION_CATALOGUE } });
      }
      case "list": {
        const r = await admin.rpc("marketing_provider_connection_list", {
          p_tenant: tenantId,
          p_args: {},
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "account_create": {
        // the deterministic test identity is REFUSED unless the environment
        // explicitly enables it — production keeps exactly the real choices
        if (
          body.provider === SERVICEOS_TEST_PROVIDER &&
          Deno.env.get("MARKETING_TEST_PROVIDER") !== "enabled"
        ) {
          return fail("INVALID_REQUEST", "The test provider is not available", 400);
        }
        const args: Row = { request_id: body.request_id };
        for (const k of [
          "provider",
          "display_name",
          "stale_after_seconds",
          "sync_cadence_minutes",
        ]) {
          if (body[k] !== undefined) args[k] = body[k];
        }
        const r = await admin.rpc("marketing_provider_account_create", {
          p_tenant: tenantId,
          p_actor: userId,
          p_args: args,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "connect": {
        if (!isUuid(body.account_id)) {
          return fail("INVALID_REQUEST", "account_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        // Adapter-aware: this layer states truthfully whether it holds an
        // adapter for the account's provider (real providers: never in this
        // build). With an adapter the account enters 'connecting' and the
        // WORKER performs genuine validation; without one the SQL authority
        // records the honest error/'no_adapter'. Nothing here can fabricate
        // a connected state.
        const acctRow = await admin
          .from("marketing_provider_accounts")
          .select("provider")
          .eq("tenant_id", tenantId)
          .eq("id", body.account_id)
          .maybeSingle();
        if (acctRow.error || !acctRow.data) return fail("NOT_FOUND", "Not found", 404);
        const adapterImplemented =
          getProviderAdapter(acctRow.data.provider, {
            testProviderEnabled: Deno.env.get("MARKETING_TEST_PROVIDER") === "enabled",
          }) !== null;
        const r = await admin.rpc("marketing_provider_account_connect_start", {
          p_tenant: tenantId,
          p_actor: userId,
          p_account: body.account_id,
          p_args: {
            request_id: body.request_id,
            expected_version: body.expected_version,
            adapter_implemented: adapterImplemented,
          },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "external_select": {
        if (!isUuid(body.account_id)) {
          return fail("INVALID_REQUEST", "account_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const r = await admin.rpc("marketing_provider_account_external_select", {
          p_tenant: tenantId,
          p_actor: userId,
          p_account: body.account_id,
          p_args: {
            request_id: body.request_id,
            expected_version: body.expected_version,
            external_ref: body.external_ref,
          },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "report": {
        if (!isUuid(body.account_id)) {
          return fail("INVALID_REQUEST", "account_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_provider_account_report", {
          p_tenant: tenantId,
          p_account: body.account_id,
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "runs": {
        if (!isUuid(body.account_id)) {
          return fail("INVALID_REQUEST", "account_id must be a uuid", 400);
        }
        const r = await admin
          .from("marketing_provider_sync_runs")
          .select("id, kind, status, attempts, error_class, created_at, started_at, finished_at")
          .eq("tenant_id", tenantId)
          .eq("account_id", body.account_id)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(20);
        if (r.error) return fail("INTERNAL", "The operation failed", 500);
        return json({ ok: true, data: { runs: r.data ?? [] } });
      }
      case "credential_set": {
        if (!isUuid(body.account_id)) {
          return fail("INVALID_REQUEST", "account_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const credential = body.credential;
        if (
          typeof credential !== "string" ||
          credential.length < 8 ||
          credential.length > 4096 ||
          // deno-lint-ignore no-control-regex
          /[\u0000-\u001f\u007f]/.test(credential)
        ) {
          return fail(
            "INVALID_REQUEST",
            "credential must be 8..4096 characters with no control characters",
            400,
          );
        }
        const provider = connectionVaultProvider(body.account_id);
        // IDEMPOTENCY FIRST: the mark commits the request-id verdict and the
        // rotation clock BEFORE any Vault write. A replay stores nothing.
        const marked = await admin.rpc("marketing_provider_account_credential_mark", {
          p_tenant: tenantId,
          p_actor: userId,
          p_account: body.account_id,
          p_args: { request_id: body.request_id },
          p_expected_version: body.expected_version,
        });
        if (marked.error) return mapDbError(marked.error);
        const markData = (marked.data ?? {}) as Row;
        if (markData.replayed === true) {
          return json({
            ok: true,
            data: {
              ...markData,
              stored: false,
              note: "This credential request was already completed; nothing was rotated or stored again.",
            },
          });
        }
        // fresh: preserve the outgoing credential as `previous` (rotation
        // only — honoured downstream for at most the bounded 86400 s overlap
        // after credential_rotated_at), then store the new one. If a Vault
        // write fails here the connection keeps failing closed (no consumer
        // can read a usable credential) until a re-rotation.
        if (markData.rotated === true) {
          const current = await admin.rpc("provider_secret_read", {
            p_tenant: tenantId,
            p_provider: provider,
            p_field: "credential_key",
          });
          if (!current.error && typeof current.data === "string" && current.data.length > 0) {
            const kept = await admin.rpc("provider_secret_store", {
              p_tenant: tenantId,
              p_provider: provider,
              p_field: "credential_key_previous",
              p_secret: current.data,
            });
            if (kept.error) return fail("INTERNAL", "Could not rotate the credential", 500);
          }
        }
        const stored = await admin.rpc("provider_secret_store", {
          p_tenant: tenantId,
          p_provider: provider,
          p_field: "credential_key",
          p_secret: credential,
        });
        if (stored.error) return fail("INTERNAL", "Could not store the credential", 500);
        const credAcct = await admin
          .from("marketing_provider_accounts")
          .select("provider")
          .eq("tenant_id", tenantId)
          .eq("id", body.account_id)
          .maybeSingle();
        const hasAdapter =
          getProviderAdapter(credAcct.data?.provider ?? "", {
            testProviderEnabled: Deno.env.get("MARKETING_TEST_PROVIDER") === "enabled",
          }) !== null;
        return json({
          ok: true,
          data: {
            ...markData,
            stored: true,
            note: hasAdapter
              ? "Credential stored in the tenant Vault broker. It is used only during adapter validation and sync — it is never shown again."
              : "Credential stored in the tenant Vault broker. No adapter exists for this provider in this build, so nothing can use it yet — the connection stays truthfully not connected.",
          },
        });
      }
      case "revoke": {
        if (!isUuid(body.account_id)) {
          return fail("INVALID_REQUEST", "account_id must be a uuid", 400);
        }
        if (typeof body.expected_version !== "number" || !Number.isInteger(body.expected_version)) {
          return fail("INVALID_REQUEST", "expected_version must be an integer", 400);
        }
        const r = await admin.rpc("marketing_provider_account_revoke", {
          p_tenant: tenantId,
          p_actor: userId,
          p_account: body.account_id,
          p_args: { request_id: body.request_id, expected_version: body.expected_version },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      case "sync_request": {
        if (!isUuid(body.account_id)) {
          return fail("INVALID_REQUEST", "account_id must be a uuid", 400);
        }
        const r = await admin.rpc("marketing_provider_sync_request", {
          p_tenant: tenantId,
          p_actor: userId,
          p_account: body.account_id,
          p_args: { request_id: body.request_id },
        });
        if (r.error) return mapDbError(r.error);
        return json({ ok: true, data: r.data });
      }
      default:
        return fail("INVALID_REQUEST", `unknown action '${action}'`, 400);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unexpected failure";
    console.error("marketing-provider-connections failed", { action, message });
    return fail("INTERNAL", "The operation failed", 500);
  }
});
