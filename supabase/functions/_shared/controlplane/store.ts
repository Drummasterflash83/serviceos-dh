import { resolveCheckedOwnership } from "./ownership_inventory.ts";
import {
  loadIdentityInventory,
  buildEmailIdentityResolution,
  type IdentityInventory,
} from "./identity_inventory.ts";
import {
  loadOperatorHealth,
  operatorHealthCounts,
  operatorHealthIssues,
  type OperatorHealthInventory,
} from "./health.ts";
import { loadRoster } from "./roster.ts";
// ServiceOS — OpenFolk Control Plane: impure store (service-role reads + resolver bridge).
//
// Loads the effective-dated Control Plane data and runs the pure ownership resolver;
// builds the OpenFolk workspace view and the data-quality queue. Writes go ONLY through
// the atomic cp_* RPCs (mutation + change_log in one transaction) — this module never
// writes ownership directly, and the discovery adapter (discovery.ts) never writes
// ownership at all.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { type EndpointEvidence, type OwnershipResolution } from "./resolver.ts";
import {
  type IdentitySuggestion,
  type OperationalClass,
  type ProviderMailboxType,
} from "./identity_resolution.ts";
import { computeTelephonyIdentityResolution } from "./telephony_discovery.ts";

const ASG_COLS =
  "id, endpoint_id, owner_kind, owner_member_id, owner_org_unit_id, owner_role, assignment_role, effective_from, effective_to, confidence, review_state, updated_at";

/** Resolve endpoint ownership for one interaction's evidence at a point in time. */
export async function resolveForEvidence(
  admin: SupabaseClient,
  tenantId: string,
  evidence: EndpointEvidence,
  nowMs: number,
  opts: { subjectRef?: string | null; subjectType?: string | null } = {},
): Promise<OwnershipResolution> {
  return resolveCheckedOwnership(admin, tenantId, evidence, nowMs, opts);
}

export interface TenantSummary {
  tenant_id: string;
  slug: string | null;
  display_name: string | null;
  people: number;
  endpoints_total: number;
  endpoints_unmapped: number;
  identities_unverified: number;
  ambiguous_assignments: number;
}

/** OpenFolk customer-list summary for one tenant. */
export async function loadTenantSummary(
  admin: SupabaseClient,
  tenantId: string,
  inventory?: OperatorHealthInventory,
): Promise<TenantSummary> {
  const [{ data: tenant, error }, health] = await Promise.all([
    admin.from("tenants").select("slug, display_name").eq("id", tenantId).maybeSingle(),
    inventory ?? loadOperatorHealth(admin, tenantId),
  ]);
  if (error || !tenant) throw new Error("Client summary could not be read");
  return {
    tenant_id: tenantId,
    slug: (tenant.slug as string | null) ?? null,
    display_name: (tenant.display_name as string | null) ?? null,
    ...operatorHealthCounts(health),
  };
}

export interface DataQualityItem {
  kind: string;
  detail: string;
  ref: string | null;
}

export interface EmailClassification {
  endpoint_id: string;
  email: string;
  provider_mailbox_type: ProviderMailboxType;
  operational_class: OperationalClass;
  operational_reviewed: boolean;
  provider_display_name: string | null;
  evidence: string;
  status: string | null;
}
export interface IdentityResolution {
  classifications: EmailClassification[];
  suggestions: (IdentitySuggestion & { endpoint_id: string })[];
  reviews: {
    endpoint_id: string;
    decision: string;
    team_member_id: string | null;
    created_at: string;
  }[];
}

/**
 * Compute email classification + review-only identity suggestions for the tenant's email
 * endpoints. Suggestions never auto-confirm; existing decisions are surfaced so the
 * operator sees what has already been reviewed. Identity is NOT ownership.
 */
export async function computeIdentityResolution(
  admin: SupabaseClient,
  tenantId: string,
  inventory?: IdentityInventory,
): Promise<IdentityResolution> {
  return buildEmailIdentityResolution(inventory ?? (await loadIdentityInventory(admin, tenantId)));
}

/** The data-quality queue: unmapped endpoints, unresolved identities, stale/inactive owners. */
export async function computeDataQuality(
  admin: SupabaseClient,
  tenantId: string,
): Promise<DataQualityItem[]> {
  return operatorHealthIssues(await loadOperatorHealth(admin, tenantId));
}

/** Full tenant workspace for the OpenFolk UI. */
/**
 * Provider connections + raw telephony evidence for the Connections/Phone sections.
 * Shows the boundary between a provider CONNECTION, the tenant-APPROVED domain, and
 * discovered INVENTORY — and telephony capability (truthfully) from the provider registry.
 * Never returns secrets: only status, non-secret account refs and capability declarations.
 */
// ── Connection lifecycle (SAFE — never returns secret refs / Vault ids / tokens) ──
export { loadConnectionsAndEvidence } from "./connection_inventory.ts";
import { loadConnectionsAndEvidence } from "./connection_inventory.ts";

export { loadDiscoveryHistory } from "./discovery_history.ts";

export async function loadTenantWorkspace(admin: SupabaseClient, tenantId: string) {
  const health = await loadOperatorHealth(admin, tenantId);
  const [{ members, responsibilities, authorityGrants: authority }, summary] = await Promise.all([
    loadRoster(admin, tenantId),
    loadTenantSummary(admin, tenantId, health),
  ]);
  const { identities, endpoints, ownership } = health;
  const dataQuality = operatorHealthIssues(health);
  // Ended (historical) ownership — kept separate so `ownership` stays "currently active".
  const { data: ownershipHistory } = await admin
    .from("endpoint_ownership_assignments")
    .select(ASG_COLS + ", endpoint_id")
    .eq("tenant_id", tenantId)
    .not("effective_to", "is", null)
    .order("effective_to", { ascending: false })
    .limit(200);
  const identityInventory = await loadIdentityInventory(admin, tenantId);
  const [conn, identityResolution, telephonyIdentityResolution] = await Promise.all([
    loadConnectionsAndEvidence(admin, tenantId),
    computeIdentityResolution(admin, tenantId, identityInventory),
    computeTelephonyIdentityResolution(admin, tenantId, identityInventory),
  ]);
  return {
    summary,
    members: members ?? [],
    identities: identities ?? [],
    endpoints: endpoints ?? [],
    ownership: ownership ?? [],
    ownershipHistory: ownershipHistory ?? [],
    responsibilities: responsibilities ?? [],
    authorityGrants: authority ?? [],
    dataQuality,
    connections: conn.connections,
    phoneEvidence: conn.phoneEvidence,
    identityResolution,
    // Telephony extension candidates (Discover→Review→Confirm), parallel to the email
    // identityResolution above. Provider-neutral suggestions with evidence + confidence.
    telephonyIdentityResolution,
  };
}
