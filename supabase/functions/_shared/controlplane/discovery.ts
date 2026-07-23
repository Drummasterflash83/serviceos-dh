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

/**
 * Tenant email-domain boundary (DEFAULT-DENY).
 *
 * A connected directory may legitimately be a shared administrative connection that can
 * see identities for several domains. Tenant membership must therefore NEVER be inferred
 * from the authorising account, the operator's email, or merely from the mailbox living on
 * a connection. Only an explicitly approved domain, recorded as governed tenant config,
 * makes an identity eligible. Missing configuration means import NOTHING.
 *
 * Config lives in the existing governed model (no bespoke table):
 *   operating_profile_entries(tenant_id, scope_kind='tenant', namespace='controlplane',
 *                             key='email.approved_domains', value=jsonb)
 *   value: { approved_domains: string[], connection_ids?: string[], note?: string }
 * versioned through config_versions (provenance + lifecycle).
 */
export async function loadApprovedEmailDomains(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data } = await admin
    .from("operating_profile_entries")
    .select("value")
    .eq("tenant_id", tenantId)
    .eq("scope_kind", "tenant")
    .eq("namespace", "controlplane")
    .eq("key", "email.approved_domains")
    .limit(1)
    .maybeSingle();
  const raw = (data?.value ?? {}) as Record<string, unknown>;
  const list = Array.isArray(raw.approved_domains) ? (raw.approved_domains as unknown[]) : [];
  return list.map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
}

/** Domain of an email address, lowercased ("" when unparseable). */
export function emailDomain(addr: string): string {
  const at = addr.lastIndexOf("@");
  return at === -1 ? "" : addr.slice(at + 1).trim().toLowerCase();
}

export type EmailBoundaryReason =
  | "no_address"
  | "no_approved_domains"
  | "outside_approved_domain";

export type EmailBoundary =
  | { eligible: true; domain: string }
  | { eligible: false; reason: EmailBoundaryReason; domain: string };

/**
 * PURE default-deny boundary decision for one directory identity. Eligibility depends
 * ONLY on the address matching an explicitly approved tenant domain — never on the
 * connection, the authorising account, or the operator.
 */
export function emailBoundaryDecision(
  addr: string | null | undefined,
  approved: string[],
): EmailBoundary {
  const a = (addr ?? "").trim().toLowerCase();
  if (!a) return { eligible: false, reason: "no_address", domain: "" };
  const domain = emailDomain(a);
  if (approved.length === 0) return { eligible: false, reason: "no_approved_domains", domain };
  if (!approved.includes(domain)) return { eligible: false, reason: "outside_approved_domain", domain };
  return { eligible: true, domain };
}

export interface EmailDiscoveryResult extends DiscoveryResult {
  approved_domains: string[];
  default_denied: boolean;
  excluded: number;
  excluded_domains: Record<string, number>;
  ambiguous: { email: string; reason: string }[];
}

/**
 * Idempotently mirror APPROVED-DOMAIN Google Workspace mailboxes into
 * communication_endpoints. Identities outside the tenant's approved domains are excluded
 * and reported — never imported, never silently cleaned up afterwards.
 */
export async function discoverEmailEndpoints(
  admin: SupabaseClient,
  tenantId: string,
  actor: string,
): Promise<EmailDiscoveryResult> {
  const approved = await loadApprovedEmailDomains(admin, tenantId);
  const excluded_domains: Record<string, number> = {};
  const ambiguous: { email: string; reason: string }[] = [];

  const { data: mailboxes } = await admin
    .from("google_workspace_mailboxes")
    .select("id, email_address, display_name, mailbox_type")
    .eq("tenant_id", tenantId);

  let scanned = 0;
  let upserted = 0;
  let skipped = 0;
  let excluded = 0;

  // DEFAULT-DENY: with no approved domain configured we import nothing at all.
  if (approved.length === 0) {
    for (const m of mailboxes ?? []) {
      scanned++;
      excluded++;
      const d = emailDomain(String(m.email_address ?? "")) || "(unparseable)";
      excluded_domains[d] = (excluded_domains[d] ?? 0) + 1;
    }
    return {
      scanned,
      upserted: 0,
      skipped,
      excluded,
      excluded_domains,
      ambiguous,
      approved_domains: approved,
      default_denied: true,
    };
  }

  for (const m of mailboxes ?? []) {
    scanned++;
    const addr = ((m.email_address as string | null) ?? "").toLowerCase();
    // Boundary check on the PRIMARY address. (This directory source exposes no alias
    // column; when aliases become available, an out-of-domain primary with an in-domain
    // alias must surface here as an ambiguous suggestion for review, never an auto-import.)
    const decision = emailBoundaryDecision(addr, approved);
    if (!decision.eligible) {
      if (decision.reason === "no_address") {
        skipped++;
      } else {
        excluded++;
        const d = decision.domain || "(unparseable)";
        excluded_domains[d] = (excluded_domains[d] ?? 0) + 1;
      }
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
  return {
    scanned,
    upserted,
    skipped,
    excluded,
    excluded_domains,
    ambiguous,
    approved_domains: approved,
    default_denied: false,
  };
}
