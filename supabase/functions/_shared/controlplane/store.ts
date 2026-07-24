// ServiceOS — OpenFolk Control Plane: impure store (service-role reads + resolver bridge).
//
// Loads the effective-dated Control Plane data and runs the pure ownership resolver;
// builds the OpenFolk workspace view and the data-quality queue. Writes go ONLY through
// the atomic cp_* RPCs (mutation + change_log in one transaction) — this module never
// writes ownership directly, and the discovery adapter (discovery.ts) never writes
// ownership at all.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  type AssignmentRow,
  type EndpointEvidence,
  type EndpointRow,
  type HandoffRow,
  type OwnershipResolution,
  resolveEndpointOwnership,
} from "./resolver.ts";
import { providerCapabilities } from "../telephony/capabilities.ts";
import { emailDomain, loadApprovedEmailDomains } from "./discovery.ts";

const EP_COLS =
  "id, tenant_id, channel, endpoint_kind, normalized_value, display_value, provider, provider_external_ref, is_shared, status";
const ASG_COLS =
  "id, endpoint_id, owner_kind, owner_member_id, owner_org_unit_id, owner_role, assignment_role, effective_from, effective_to, confidence, review_state";

/** Resolve endpoint ownership for one interaction's evidence at a point in time. */
export async function resolveForEvidence(
  admin: SupabaseClient,
  tenantId: string,
  evidence: EndpointEvidence,
  nowMs: number,
  opts: { subjectRef?: string | null } = {},
): Promise<OwnershipResolution> {
  const { data: endpoints } = await admin
    .from("communication_endpoints")
    .select(EP_COLS)
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  const epIds = (endpoints ?? []).map((e) => e.id as string);
  const { data: assignments } = epIds.length
    ? await admin.from("endpoint_ownership_assignments").select(ASG_COLS).in("endpoint_id", epIds)
    : { data: [] as AssignmentRow[] };
  let handoffs: HandoffRow[] = [];
  if (opts.subjectRef) {
    const { data: h } = await admin
      .from("responsibility_handoffs")
      .select("to_party, occurred_at, observed_state")
      .eq("tenant_id", tenantId)
      .eq("subject_ref", opts.subjectRef);
    handoffs = (h ?? []) as HandoffRow[];
  }
  return resolveEndpointOwnership({
    evidence,
    endpoints: (endpoints ?? []) as EndpointRow[],
    assignments: (assignments ?? []) as AssignmentRow[],
    handoffs,
    nowMs,
  });
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
): Promise<TenantSummary> {
  const [{ data: tenant }, members, endpoints, ownership, identities] = await Promise.all([
    admin.from("tenants").select("slug, display_name").eq("id", tenantId).maybeSingle(),
    admin.from("team_members").select("id").eq("tenant_id", tenantId).is("effective_to", null),
    admin
      .from("communication_endpoints")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
    admin
      .from("endpoint_ownership_assignments")
      .select("endpoint_id, assignment_role, review_state")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
    admin
      .from("member_integration_identities")
      .select("id, verification_state")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
  ]);
  const epIds = new Set((endpoints.data ?? []).map((e) => e.id as string));
  const accountableEndpoints = new Set(
    (ownership.data ?? [])
      .filter((o) => o.assignment_role === "accountable" && o.review_state !== "rejected")
      .map((o) => o.endpoint_id as string),
  );
  const unmapped = [...epIds].filter((id) => !accountableEndpoints.has(id)).length;
  const conflicted = (ownership.data ?? []).filter((o) => o.review_state === "conflicted").length;
  return {
    tenant_id: tenantId,
    slug: (tenant?.slug as string | null) ?? null,
    display_name: (tenant?.display_name as string | null) ?? null,
    people: (members.data ?? []).length,
    endpoints_total: epIds.size,
    endpoints_unmapped: unmapped,
    identities_unverified: (identities.data ?? []).filter(
      (i) => i.verification_state !== "verified",
    ).length,
    ambiguous_assignments: conflicted,
  };
}

export interface DataQualityItem {
  kind: string;
  detail: string;
  ref: string | null;
}

/** The data-quality queue: unmapped endpoints, unresolved identities, stale/inactive owners. */
export async function computeDataQuality(
  admin: SupabaseClient,
  tenantId: string,
): Promise<DataQualityItem[]> {
  const items: DataQualityItem[] = [];
  const [{ data: endpoints }, { data: ownership }, { data: identities }, { data: members }] =
    await Promise.all([
      admin
        .from("communication_endpoints")
        .select("id, endpoint_kind, normalized_value")
        .eq("tenant_id", tenantId)
        .eq("status", "active"),
      admin
        .from("endpoint_ownership_assignments")
        .select("endpoint_id, assignment_role, owner_member_id, review_state, confidence")
        .eq("tenant_id", tenantId)
        .is("effective_to", null),
      admin
        .from("member_integration_identities")
        .select("id, provider, external_ref, verification_state")
        .eq("tenant_id", tenantId)
        .is("effective_to", null),
      admin.from("team_members").select("id, effective_to").eq("tenant_id", tenantId),
    ]);

  const accountable = new Map<
    string,
    { owner_member_id: string | null; confidence: number | null }
  >();
  for (const o of ownership ?? []) {
    if (o.assignment_role === "accountable" && o.review_state !== "rejected") {
      accountable.set(o.endpoint_id as string, {
        owner_member_id: (o.owner_member_id as string | null) ?? null,
        confidence: (o.confidence as number | null) ?? null,
      });
    }
  }
  const inactiveMembers = new Set(
    (members ?? []).filter((m) => m.effective_to !== null).map((m) => m.id as string),
  );

  for (const e of endpoints ?? []) {
    const acc = accountable.get(e.id as string);
    if (!acc) {
      items.push({
        kind: "unmapped_endpoint",
        detail: `${e.endpoint_kind} ${e.normalized_value} has no accountable owner`,
        ref: e.id as string,
      });
    } else {
      if (acc.owner_member_id && inactiveMembers.has(acc.owner_member_id)) {
        items.push({
          kind: "owner_inactive",
          detail: `${e.endpoint_kind} ${e.normalized_value} owned by an inactive member`,
          ref: e.id as string,
        });
      }
      if (acc.confidence != null && acc.confidence < 0.5) {
        items.push({
          kind: "low_confidence",
          detail: `${e.endpoint_kind} ${e.normalized_value} owner confidence ${acc.confidence}`,
          ref: e.id as string,
        });
      }
    }
  }
  for (const i of identities ?? []) {
    if (i.verification_state !== "verified") {
      items.push({
        kind: "unverified_identity",
        detail: `${i.provider} ${i.external_ref} unverified`,
        ref: i.id as string,
      });
    }
  }
  return items;
}

/** Full tenant workspace for the OpenFolk UI. */
/**
 * Provider connections + raw telephony evidence for the Connections/Phone sections.
 * Shows the boundary between a provider CONNECTION, the tenant-APPROVED domain, and
 * discovered INVENTORY — and telephony capability (truthfully) from the provider registry.
 * Never returns secrets: only status, non-secret account refs and capability declarations.
 */
export async function loadConnectionsAndEvidence(admin: SupabaseClient, tenantId: string) {
  const [gw, prov, mailboxes, telInv] = await Promise.all([
    admin
      .from("google_workspace_connections")
      .select("id, domain, status, created_at")
      .eq("tenant_id", tenantId),
    admin
      .from("provider_connections")
      .select("provider, status, auth_mode, account_ref, verified_at")
      .eq("tenant_id", tenantId),
    admin.from("google_workspace_mailboxes").select("email_address, status").eq("tenant_id", tenantId),
    admin
      .from("telephony_inventory")
      .select("id, provider, provider_object_id, canonical_type, label, status, discovery_source")
      .eq("tenant_id", tenantId),
  ]);

  const approved = await loadApprovedEmailDomains(admin, tenantId);
  const mb = mailboxes.data ?? [];
  let emailImported = 0;
  const excluded_domains: Record<string, number> = {};
  for (const m of mb) {
    const d = emailDomain(String(m.email_address ?? ""));
    if (approved.includes(d)) emailImported++;
    else excluded_domains[d || "(unparseable)"] = (excluded_domains[d || "(unparseable)"] ?? 0) + 1;
  }
  const excluded = mb.length - emailImported;

  const telProv =
    (prov.data ?? []).find((p) =>
      ["sipcentric", "birchills", "simwood"].includes(String(p.provider)),
    ) ?? (prov.data ?? [])[0] ?? null;
  const caps = providerCapabilities(telProv?.provider ?? null);

  return {
    connections: {
      google_workspace: {
        status: (gw.data ?? []).some((c) => c.status === "active") ? "connected" : "not_connected",
        connections: (gw.data ?? []).map((c) => ({ domain: c.domain, status: c.status })),
        approved_domains: approved,
        imported: emailImported,
        excluded,
        excluded_domains,
        read_only: true,
      },
      telephony: {
        commercial_provider: "Birchills",
        underlying_provider: telProv?.provider ?? "sipcentric",
        account_ref: telProv?.account_ref ?? "3950",
        status: telProv?.status ?? "manual",
        credentials: "configured (never displayed)",
        capabilities: caps?.capabilities ?? null,
        external_write: "disabled",
        evidence_count: (telInv.data ?? []).length,
      },
      slack: { status: "not_connected", note: "Identity model ready — ingestion not connected" },
    },
    phoneEvidence: (telInv.data ?? []).map((r) => ({
      id: r.id,
      provider: r.provider,
      external_ref: r.provider_object_id,
      canonical_type: r.canonical_type,
      label: r.label,
      status: r.status,
      discovery_source: r.discovery_source,
    })),
  };
}

export async function loadTenantWorkspace(admin: SupabaseClient, tenantId: string) {
  const [
    { data: members },
    { data: identities },
    { data: endpoints },
    { data: ownership },
    summary,
    dataQuality,
  ] = await Promise.all([
    admin
      .from("team_members")
      .select("id, display_name, formal_role, org_unit_id, effective_to")
      .eq("tenant_id", tenantId)
      .order("display_name"),
    admin
      .from("member_integration_identities")
      .select(
        "id, team_member_id, provider, identity_kind, external_ref, display, primary_login, verification_state",
      )
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
    admin
      .from("communication_endpoints")
      .select(EP_COLS)
      .eq("tenant_id", tenantId)
      .order("channel"),
    admin
      .from("endpoint_ownership_assignments")
      .select(ASG_COLS + ", endpoint_id")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
    loadTenantSummary(admin, tenantId),
    computeDataQuality(admin, tenantId),
  ]);
  const conn = await loadConnectionsAndEvidence(admin, tenantId);
  return {
    summary,
    members: members ?? [],
    identities: identities ?? [],
    endpoints: endpoints ?? [],
    ownership: ownership ?? [],
    dataQuality,
    connections: conn.connections,
    phoneEvidence: conn.phoneEvidence,
  };
}
