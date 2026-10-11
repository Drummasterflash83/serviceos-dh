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
import { providerCapabilities } from "../telephony/capabilities.ts";
import { emailDomain, loadApprovedEmailDomains } from "./discovery.ts";
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
type Row = Record<string, unknown>;
function pickTs(v: unknown, ...keys: string[]): string | null {
  if (v && typeof v === "object")
    for (const k of keys) {
      const x = (v as Row)[k];
      if (typeof x === "string") return x;
    }
  return null;
}
function lastTestSummary(lt: unknown): { status: string | null; at: string | null } {
  if (!lt || typeof lt !== "object") return { status: null, at: null };
  const o = lt as Row;
  const status =
    o.ok === true ? "passed" : o.ok === false ? "failed" : ((o.status as string) ?? null);
  return { status, at: pickTs(o, "at", "tested_at", "verified_at", "completed_at") };
}

// Defensive wrapper: lifecycle is additive enrichment — a failure here must NEVER break the
// core workspace load, so it degrades to null rather than throwing.
function safeLifecycle(...args: Parameters<typeof buildLifecycle>) {
  try {
    return buildLifecycle(...args);
  } catch {
    return null;
  }
}

// Build the per-connection lifecycle object from provider_connections + latest events +
// last sync runs. `has_secrets` is a boolean only — the secret_refs object is NEVER returned.
function buildLifecycle(
  conn: Row | null,
  provider: string | null,
  events: Row[],
  syncRuns: Row[],
  fallback: { is_fallback: boolean; fallback_reason: string | null },
) {
  const forProvider = (rows: Row[]) =>
    provider ? rows.filter((r) => String(r.provider) === provider) : rows;
  const evs = forProvider(events);
  const latest = evs[0] ?? null;
  const isDiscoverySuccess = (e: Row) =>
    ["discovery_completed", "inventory_imported"].includes(String(e.event));
  const lastOk = evs.find(isDiscoverySuccess) ?? null;
  const lastFail = evs.find((e) => String(e.event) === "discovery_failed") ?? null;
  const runs = forProvider(syncRuns);
  const okRun = runs.find((r) => ["completed", "success", "succeeded"].includes(String(r.status)));
  const failRun = runs.find((r) => ["failed", "error"].includes(String(r.status)));
  const secretRefs = conn?.secret_refs;
  const hasSecrets =
    !!secretRefs && typeof secretRefs === "object" && Object.keys(secretRefs as Row).length > 0;
  const lt = lastTestSummary(conn?.last_test);
  return {
    connection_id: (conn?.id as string) ?? null,
    provider: provider,
    status: (conn?.status as string) ?? null,
    auth_mode: (conn?.auth_mode as string) ?? null,
    account_ref: (conn?.account_ref as string) ?? null,
    configured_fields: Array.isArray(conn?.configured_fields) ? conn!.configured_fields : [],
    has_secrets: hasSecrets, // boolean ONLY — never the refs
    verified_at: (conn?.verified_at as string) ?? null,
    last_test_status: lt.status,
    last_test_at: lt.at,
    revoked_at: (conn?.revoked_at as string) ?? null,
    latest_event: latest ? String(latest.event) : null,
    latest_event_at: latest ? String(latest.created_at) : null,
    last_successful_discovery:
      (lastOk?.created_at as string) ?? (okRun?.completed_at as string) ?? null,
    last_failed_discovery:
      (lastFail?.created_at as string) ?? (failRun?.completed_at as string) ?? null,
    discovery_counts: {
      last_run_processed:
        typeof runs[0]?.records_processed === "number"
          ? (runs[0].records_processed as number)
          : null,
    },
    is_fallback: fallback.is_fallback,
    fallback_reason: fallback.fallback_reason,
  };
}

// Commercial-name mapping (label only, not provider truth) — flagged is_fallback when used.
const COMMERCIAL_LABEL: Record<string, string> = { sipcentric: "Birchills", simwood: "Simwood" };

export async function loadConnectionsAndEvidence(admin: SupabaseClient, tenantId: string) {
  const [gw, prov, mailboxes, telInv, events, phoneRuns, emailRuns] = await Promise.all([
    admin
      .from("google_workspace_connections")
      .select("id, domain, status, created_at")
      .eq("tenant_id", tenantId),
    admin
      .from("provider_connections")
      // configured_fields + secret_refs are read to derive a boolean; secret_refs is NEVER returned.
      .select(
        "id, provider, status, auth_mode, account_ref, configured_fields, secret_refs, verified_at, last_test, revoked_at, created_at, updated_at",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("google_workspace_mailboxes")
      .select("email_address, status")
      .eq("tenant_id", tenantId),
    admin
      .from("telephony_inventory")
      .select("id, provider, provider_object_id, canonical_type, label, status, discovery_source")
      .eq("tenant_id", tenantId),
    admin
      .from("provider_connection_events")
      .select("provider, event, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("phone_sync_runs")
      .select("provider, status, started_at, completed_at, records_processed")
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(50),
    admin
      .from("email_sync_runs")
      .select("provider, status, started_at, completed_at, records_processed")
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(50),
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

  const evData = (events.data ?? []) as Row[];
  const telProv =
    ((prov.data ?? []).find((p) =>
      ["sipcentric", "birchills", "simwood"].includes(String(p.provider)),
    ) as Row | undefined) ??
    ((prov.data ?? [])[0] as Row | undefined) ??
    null;
  const caps = providerCapabilities((telProv?.provider as string) ?? null);
  const gwConn = ((gw.data ?? [])[0] as Row | undefined) ?? null;
  const gwConnected = (gw.data ?? []).some((c) => c.status === "active");

  // account_ref is a fallback ONLY when there is no stored provider connection at all.
  const telAccountFallback = !telProv;
  const commercial = telProv?.provider
    ? (COMMERCIAL_LABEL[String(telProv.provider)] ?? String(telProv.provider))
    : "Birchills";

  return {
    connections: {
      google_workspace: {
        status: gwConnected ? "connected" : "not_connected",
        connections: (gw.data ?? []).map((c) => ({ domain: c.domain, status: c.status })),
        approved_domains: approved,
        imported: emailImported,
        excluded,
        excluded_domains,
        read_only: true,
        lifecycle: safeLifecycle(gwConn, "google_workspace", [], (emailRuns.data ?? []) as Row[], {
          is_fallback: false,
          fallback_reason: null,
        }),
      },
      telephony: {
        commercial_provider: commercial,
        underlying_provider: (telProv?.provider as string) ?? "sipcentric",
        account_ref: (telProv?.account_ref as string) ?? "3950",
        status: (telProv?.status as string) ?? "manual",
        credentials: "configured (never displayed)",
        capabilities: caps?.capabilities ?? null,
        external_write: "disabled",
        evidence_count: (telInv.data ?? []).length,
        lifecycle: safeLifecycle(
          telProv,
          (telProv?.provider as string) ?? null,
          evData,
          (phoneRuns.data ?? []) as Row[],
          telAccountFallback
            ? {
                is_fallback: true,
                fallback_reason: "No stored provider connection; showing default account label",
              }
            : { is_fallback: false, fallback_reason: null },
        ),
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

// ── Generic discovery-history projection (union over existing run sources) ──
// Tenant-scoped, newest-first, server-paginated + provider/status filtered. Safe when any
// source table is empty. Returns normalised rows only — never a full inventory payload.
export async function loadDiscoveryHistory(
  admin: SupabaseClient,
  tenantId: string,
  opts: {
    page?: number;
    page_size?: number;
    provider?: string | null;
    status?: string | null;
  } = {},
) {
  const pageSize = Math.min(Math.max(opts.page_size ?? 25, 1), 100);
  const page = Math.max(opts.page ?? 0, 0);
  type Norm = {
    run_id: string;
    connection_id: string | null;
    provider: string | null;
    capability: string | null;
    source: string;
    trigger: string | null;
    actor: string | null;
    status: string | null;
    started_at: string | null;
    completed_at: string | null;
    scanned: number | null;
    created: number | null;
    updated: number | null;
    unchanged: number | null;
    excluded: number | null;
    ambiguous: number | null;
    failed: number | null;
    warnings: number | null;
    error: string | null;
    correlation_id: string | null;
  };
  const [phone, email, imports] = await Promise.all([
    admin
      .from("phone_sync_runs")
      .select(
        "id, provider, sync_type, status, started_at, completed_at, records_processed, error_message",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("email_sync_runs")
      .select(
        "id, provider, sync_type, status, started_at, completed_at, records_processed, error_message",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("data_imports")
      .select(
        "id, source_system, entity_type, status, started_at, completed_at, row_count, created_records, updated_records, skipped_records, duplicate_records, conflict_records, invalid_rows, uploaded_by",
      )
      .eq("tenant_id", tenantId),
  ]);
  const rows: Norm[] = [];
  for (const r of (phone.data ?? []) as Row[])
    rows.push({
      run_id: String(r.id),
      connection_id: null,
      provider: (r.provider as string) ?? "telephony",
      capability: (r.sync_type as string) ?? "call_history",
      source: "phone_sync_runs",
      trigger: (r.sync_type as string) ?? null,
      actor: null,
      status: (r.status as string) ?? null,
      started_at: (r.started_at as string) ?? null,
      completed_at: (r.completed_at as string) ?? null,
      scanned: (r.records_processed as number) ?? null,
      created: null,
      updated: null,
      unchanged: null,
      excluded: null,
      ambiguous: null,
      failed: null,
      warnings: null,
      error: (r.error_message as string) ?? null,
      correlation_id: null,
    });
  for (const r of (email.data ?? []) as Row[])
    rows.push({
      run_id: String(r.id),
      connection_id: null,
      provider: (r.provider as string) ?? "google_workspace",
      capability: (r.sync_type as string) ?? "email_metadata",
      source: "email_sync_runs",
      trigger: (r.sync_type as string) ?? null,
      actor: null,
      status: (r.status as string) ?? null,
      started_at: (r.started_at as string) ?? null,
      completed_at: (r.completed_at as string) ?? null,
      scanned: (r.records_processed as number) ?? null,
      created: null,
      updated: null,
      unchanged: null,
      excluded: null,
      ambiguous: null,
      failed: null,
      warnings: null,
      error: (r.error_message as string) ?? null,
      correlation_id: null,
    });
  for (const r of (imports.data ?? []) as Row[])
    rows.push({
      run_id: String(r.id),
      connection_id: null,
      provider: (r.source_system as string) ?? null,
      capability: (r.entity_type as string) ?? null,
      source: "data_imports",
      trigger: "import",
      actor: (r.uploaded_by as string) ?? null,
      status: (r.status as string) ?? null,
      started_at: (r.started_at as string) ?? null,
      completed_at: (r.completed_at as string) ?? null,
      scanned: (r.row_count as number) ?? null,
      created: (r.created_records as number) ?? null,
      updated: (r.updated_records as number) ?? null,
      unchanged: null,
      excluded: (r.skipped_records as number) ?? null,
      ambiguous: (r.conflict_records as number) ?? null,
      failed: (r.invalid_rows as number) ?? null,
      warnings: (r.duplicate_records as number) ?? null,
      error: null,
      correlation_id: null,
    });
  let filtered = rows;
  if (opts.provider) filtered = filtered.filter((r) => r.provider === opts.provider);
  if (opts.status) filtered = filtered.filter((r) => r.status === opts.status);
  filtered.sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  const total = filtered.length;
  const start = page * pageSize;
  return {
    runs: filtered.slice(start, start + pageSize),
    page,
    page_size: pageSize,
    total,
    has_more: start + pageSize < total,
  };
}

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
