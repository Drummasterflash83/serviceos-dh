// ServiceOS — Secure credential broker (Vault-backed, tenant-scoped).
//
// The one place provider credentials are written, resolved, and revoked. Secrets go ONLY to
// Vault via the SECURITY DEFINER RPCs (provider_secret_store/read/revoke); the metadata row
// in provider_connections holds status + masked account ref + non-secret config + secret
// REFERENCES (never values). The client-facing status object is secret-free by construction.
//
// Invariants enforced here:
//   • secret values are never returned to any caller except resolveCredential (server-side)
//   • secret values are never logged (no console.* of secrets anywhere in this module)
//   • audit detail never contains secret values
//   • account references are masked before persistence/return
//   • all operations are scoped by the caller-verified tenantId
//
// Authorization (owner/admin) and tenant binding are done by the Edge Function via
// requireTenantUser + assertSameTenant BEFORE calling this module.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { ConnectionSnapshot } from "./adapter.ts";

export type ConnectionStatusValue = "not_configured" | "configured" | "manual" | "revoked" | "error";

export interface ConnectionStatus {
  provider: string;
  status: ConnectionStatusValue;
  authMode: string | null;
  accountRef: string | null; // masked
  configuredFields: string[]; // secret field names that ARE set (names only)
  nonSecretConfig: Record<string, unknown>;
  verifiedAt: string | null;
  lastTest: unknown | null;
  updatedAt: string | null;
}

/** Mask an account reference for display/storage: keep only a short suffix. */
export function maskAccountRef(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const s = String(ref);
  if (s.length <= 4) return "…" + s;
  return "…" + s.slice(-4);
}

interface ConnectionRow {
  provider: string;
  status: string;
  auth_mode: string | null;
  account_ref: string | null;
  non_secret_config: Record<string, unknown> | null;
  configured_fields: string[] | null;
  secret_refs: Record<string, string> | null;
  verified_at: string | null;
  last_test: unknown | null;
  updated_at: string | null;
}

function rowToStatus(row: ConnectionRow | null, provider: string): ConnectionStatus {
  if (!row) {
    return {
      provider,
      status: "not_configured",
      authMode: null,
      accountRef: null,
      configuredFields: [],
      nonSecretConfig: {},
      verifiedAt: null,
      lastTest: null,
      updatedAt: null,
    };
  }
  // account_ref is already stored masked; do not attempt to unmask.
  return {
    provider: row.provider,
    status: (row.status as ConnectionStatusValue) ?? "not_configured",
    authMode: row.auth_mode,
    accountRef: row.account_ref,
    configuredFields: row.configured_fields ?? [],
    nonSecretConfig: row.non_secret_config ?? {},
    verifiedAt: row.verified_at,
    lastTest: row.last_test ?? null,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS =
  "provider,status,auth_mode,account_ref,non_secret_config,configured_fields,secret_refs,verified_at,last_test,updated_at";

/** Read the tenant's connection status for a provider. Never returns secrets. */
export async function getConnectionStatus(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
): Promise<ConnectionStatus> {
  const { data } = await db
    .from("provider_connections")
    .select(SELECT_COLS)
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();
  return rowToStatus((data as ConnectionRow | null) ?? null, provider);
}

/** Non-secret snapshot for adapters (status + masked ref + non-secret config + which fields set). */
export async function connectionSnapshot(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
): Promise<ConnectionSnapshot> {
  const s = await getConnectionStatus(db, tenantId, provider);
  return {
    status: s.status,
    accountRef: s.accountRef,
    authMode: s.authMode,
    config: s.nonSecretConfig,
    configuredFields: s.configuredFields,
  };
}

/**
 * Resolve ONE secret field. SERVER-SIDE ONLY. Wire this into AdapterContext.resolveSecret.
 * Returns the plaintext or null. The value is never logged here.
 */
export async function resolveCredential(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
  field: string,
): Promise<string | null> {
  const { data, error } = await db.rpc("provider_secret_read", {
    p_tenant: tenantId,
    p_provider: provider,
    p_field: field,
  });
  if (error) return null;
  return (data as string | null) ?? null;
}

export interface StoreCredentialInput {
  authMode: string;
  /** Secret field values to encrypt into Vault (field -> plaintext). */
  secrets: Record<string, string>;
  /** Declared non-secret field values (field -> value). */
  nonSecret: Record<string, string>;
  /** Which field is the account reference to mask + display. */
  accountRefField?: string | null;
  /** Whether this is provider-assisted/manual (status = 'manual' with no secrets). */
  manual?: boolean;
  actorId: string | null;
}

/**
 * Create or replace a tenant's provider credentials. Encrypts each secret into Vault, stores
 * only references + non-secret metadata, and appends an audit event WITHOUT secret values.
 * Returns the secret-free ConnectionStatus.
 */
export async function storeCredential(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
  input: StoreCredentialInput,
): Promise<ConnectionStatus> {
  const existing = await getConnectionStatus(db, tenantId, provider);
  const isReplace = existing.status === "configured" || existing.configuredFields.length > 0;

  // 1. Encrypt each provided secret into Vault; collect references (uuids), not values.
  const secretRefs: Record<string, string> = {
    ...((await currentSecretRefs(db, tenantId, provider)) ?? {}),
  };
  for (const [field, value] of Object.entries(input.secrets)) {
    const { data: ref, error } = await db.rpc("provider_secret_store", {
      p_tenant: tenantId,
      p_provider: provider,
      p_field: field,
      p_secret: value, // sent to Postgres RPC only; never logged
    });
    if (error) throw new Error(`secret_store_failed:${field}`); // message carries no secret
    if (typeof ref === "string") secretRefs[field] = ref;
  }

  const configuredFields = Object.keys(secretRefs);
  const accountRaw = input.accountRefField ? input.nonSecret[input.accountRefField] : null;
  const accountRef = maskAccountRef(accountRaw ?? existing.accountRef);
  const status: ConnectionStatusValue = input.manual ? "manual" : "configured";

  // 2. Upsert the non-secret metadata row.
  const { error: upErr } = await db.from("provider_connections").upsert(
    {
      tenant_id: tenantId,
      provider,
      status,
      auth_mode: input.authMode,
      account_ref: accountRef,
      non_secret_config: input.nonSecret,
      configured_fields: configuredFields,
      secret_refs: secretRefs,
      updated_by: input.actorId,
      created_by: isReplace ? undefined : input.actorId,
      revoked_at: null,
      revoked_by: null,
    },
    { onConflict: "tenant_id,provider", ignoreDuplicates: false },
  );
  if (upErr) throw new Error("connection_metadata_write_failed");

  // 3. Audit — field NAMES only, never values.
  await logConnectionEvent(db, tenantId, provider, isReplace ? "credentials_replaced" : "credentials_configured", input.actorId, {
    auth_mode: input.authMode,
    fields_set: Object.keys(input.secrets),
    non_secret_keys: Object.keys(input.nonSecret),
    manual: !!input.manual,
  });

  return getConnectionStatus(db, tenantId, provider);
}

async function currentSecretRefs(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
): Promise<Record<string, string> | null> {
  const { data } = await db
    .from("provider_connections")
    .select("secret_refs")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .maybeSingle();
  return (data?.secret_refs as Record<string, string> | undefined) ?? null;
}

/**
 * Revoke/disconnect: delete all Vault secrets for the tenant+provider, mark the row revoked
 * (preserved as history — NOT deleted), and audit. Historical call/intelligence data and
 * mappings are untouched.
 */
export async function revokeCredential(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
  actorId: string | null,
): Promise<ConnectionStatus> {
  const { data: removed } = await db.rpc("provider_secret_revoke", {
    p_tenant: tenantId,
    p_provider: provider,
  });
  await db
    .from("provider_connections")
    .update({
      status: "revoked",
      configured_fields: [],
      secret_refs: {},
      verified_at: null,
      revoked_by: actorId,
      revoked_at: new Date().toISOString(),
      updated_by: actorId,
    })
    .eq("tenant_id", tenantId)
    .eq("provider", provider);
  await logConnectionEvent(db, tenantId, provider, "provider_disconnected", actorId, {
    secrets_removed: typeof removed === "number" ? removed : null,
  });
  return getConnectionStatus(db, tenantId, provider);
}

/** Record that a connection test ran (summary only — no secrets). */
export async function recordConnectionTest(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
  ok: boolean,
  summary: unknown,
  actorId: string | null,
): Promise<void> {
  await db
    .from("provider_connections")
    .update({ verified_at: ok ? new Date().toISOString() : null, last_test: summary, updated_by: actorId })
    .eq("tenant_id", tenantId)
    .eq("provider", provider);
  await logConnectionEvent(db, tenantId, provider, "connection_tested", actorId, { ok });
}

/** Append an audit event. `detail` MUST NOT contain secret values (caller responsibility + tests). */
export async function logConnectionEvent(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
  event: string,
  actorId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.from("provider_connection_events").insert({
    tenant_id: tenantId,
    provider,
    event,
    actor_id: actorId,
    detail,
  });
}

/** List recent audit events for a tenant+provider (secret-free by construction). */
export async function listConnectionEvents(
  db: SupabaseClient,
  tenantId: string,
  provider: string,
  limit = 50,
): Promise<Array<{ event: string; actor_id: string | null; detail: unknown; created_at: string }>> {
  const { data } = await db
    .from("provider_connection_events")
    .select("event,actor_id,detail,created_at")
    .eq("tenant_id", tenantId)
    .eq("provider", provider)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as Array<{ event: string; actor_id: string | null; detail: unknown; created_at: string }>) ?? [];
}
