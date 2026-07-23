// ServiceOS — OpenFolk Control Plane: discovery adapters (idempotent, endpoints-only).
//
// Provider discovery may create/refresh DISCOVERED endpoint metadata and update provider
// references — it must NEVER silently overwrite manually confirmed canonical OWNERSHIP.
// These adapters therefore write ONLY communication_endpoints (via the atomic
// cp_upsert_endpoint RPC, source='discovery'); they never touch
// endpoint_ownership_assignments. telephony_inventory / google_workspace_mailboxes remain
// the discovery source of truth; canonical ownership lives only in the Control Plane.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

/** Map a telephony_inventory.canonical_type to a Control Plane endpoint_kind (or null to skip). */
export function telephonyKind(canonicalType: string): string | null {
  switch (canonicalType) {
    case "ddi":
      return "ddi";
    case "extension":
      return "extension";
    case "queue":
      return "queue";
    case "ring_group":
    case "hunt_group":
      return "ring_group";
    case "voicemail_route":
      return "voicemail";
    case "sip_identity":
      return "sip";
    default:
      return null; // provider_account|trunk|device|user|pickup_group|transfer_route → not an addressable endpoint
  }
}

/** Normalise an endpoint value for matching (E.164 phone, digit-only extension, lower text). */
export function normalizeEndpointValue(kind: string, raw: string): string {
  const v = (raw ?? "").trim();
  if (kind === "ddi") {
    const digits = v.replace(/[^\d+]/g, "");
    if (digits.startsWith("+")) return digits;
    if (digits.startsWith("0")) return "+44" + digits.slice(1); // UK default
    return digits;
  }
  if (kind === "extension") return v.replace(/\D/g, "");
  return v.toLowerCase();
}

export interface DiscoveryResult {
  scanned: number;
  upserted: number;
  skipped: number;
}

/** Idempotently mirror discovered telephony endpoints into communication_endpoints.
 * Writes endpoints only — ownership is never created or modified here. */
export async function discoverTelephonyEndpoints(
  admin: SupabaseClient,
  tenantId: string,
  actor: string,
): Promise<DiscoveryResult> {
  const { data: inv } = await admin
    .from("telephony_inventory")
    .select("id, provider, provider_object_id, canonical_type, label, status")
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  let scanned = 0;
  let upserted = 0;
  let skipped = 0;
  for (const row of inv ?? []) {
    scanned++;
    const kind = telephonyKind(row.canonical_type as string);
    if (!kind) {
      skipped++;
      continue;
    }
    const raw = (row.label as string | null) ?? (row.provider_object_id as string);
    const normalized = normalizeEndpointValue(kind, raw);
    if (!normalized) {
      skipped++;
      continue;
    }
    const { error } = await admin.rpc("cp_upsert_endpoint", {
      p_tenant: tenantId,
      p_channel: "phone",
      p_endpoint_kind: kind,
      p_normalized: normalized,
      p_display: (row.label as string | null) ?? normalized,
      p_provider: row.provider,
      p_provider_ref: row.provider_object_id,
      p_is_shared: kind === "queue" || kind === "ring_group",
      p_source: "discovery",
      p_source_object_ref: row.id,
      p_metadata: {},
      p_actor: actor,
      p_reason: "telephony discovery refresh",
      p_correlation: null,
      p_view_as: false,
    });
    if (error) throw new Error(`discoverTelephonyEndpoints: ${error.message}`);
    upserted++;
  }
  return { scanned, upserted, skipped };
}

/** Idempotently mirror discovered Google Workspace mailboxes into communication_endpoints. */
export async function discoverEmailEndpoints(
  admin: SupabaseClient,
  tenantId: string,
  actor: string,
): Promise<DiscoveryResult> {
  const { data: mailboxes } = await admin
    .from("google_workspace_mailboxes")
    .select("id, email_address, display_name, mailbox_type")
    .eq("tenant_id", tenantId);

  let scanned = 0;
  let upserted = 0;
  let skipped = 0;
  for (const m of mailboxes ?? []) {
    scanned++;
    const addr = (m.email_address as string | null)?.toLowerCase();
    if (!addr) {
      skipped++;
      continue;
    }
    const kind =
      m.mailbox_type === "shared"
        ? "shared_mailbox"
        : m.mailbox_type === "group"
          ? "group_address"
          : "email";
    const { error } = await admin.rpc("cp_upsert_endpoint", {
      p_tenant: tenantId,
      p_channel: "email",
      p_endpoint_kind: kind,
      p_normalized: addr,
      p_display: (m.display_name as string | null) ?? addr,
      p_provider: "google_workspace",
      p_provider_ref: m.id,
      p_is_shared: kind !== "email",
      p_source: "discovery",
      p_source_object_ref: m.id,
      p_metadata: {},
      p_actor: actor,
      p_reason: "email discovery refresh",
      p_correlation: null,
      p_view_as: false,
    });
    if (error) throw new Error(`discoverEmailEndpoints: ${error.message}`);
    upserted++;
  }
  return { scanned, upserted, skipped };
}
