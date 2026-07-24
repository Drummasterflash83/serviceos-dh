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
import {
  classifyOperational,
  providerMailboxType,
  suggestIdentity,
  type IdentitySuggestion,
  type OperationalClass,
  type ProviderMailboxType,
  type ReviewDecision,
} from "./identity_resolution.ts";
import { computeTelephonyIdentityResolution } from "./telephony_discovery.ts";

const EP_COLS =
  "id, tenant_id, channel, endpoint_kind, normalized_value, display_value, provider, provider_external_ref, is_shared, status, source, updated_at";
const ASG_COLS =
  "id, endpoint_id, owner_kind, owner_member_id, owner_org_unit_id, owner_role, assignment_role, effective_from, effective_to, confidence, review_state, updated_at";

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
): Promise<IdentityResolution> {
  const [
    { data: endpoints },
    { data: members },
    { data: identities },
    { data: mailboxes },
    { data: reviews },
  ] = await Promise.all([
    admin
      .from("communication_endpoints")
      .select("id, endpoint_kind, normalized_value, provider")
      .eq("tenant_id", tenantId)
      .eq("channel", "email")
      .eq("status", "active"),
    admin
      .from("team_members")
      .select("id, display_name")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
    admin
      .from("member_integration_identities")
      .select("team_member_id, primary_login, external_ref, verification_state")
      .eq("tenant_id", tenantId)
      .is("effective_to", null),
    admin
      .from("google_workspace_mailboxes")
      .select("email_address, mailbox_type, status, display_name")
      .eq("tenant_id", tenantId),
    admin
      .from("endpoint_identity_reviews")
      .select("endpoint_id, decision, team_member_id, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  ]);

  const mbByEmail = new Map(
    (mailboxes ?? []).map((m) => [String(m.email_address).toLowerCase(), m]),
  );
  // Latest review decision per endpoint (rows are ordered newest-first).
  const latestReview = new Map<string, ReviewDecision>();
  for (const r of reviews ?? [])
    if (!latestReview.has(r.endpoint_id as string))
      latestReview.set(r.endpoint_id as string, r.decision as ReviewDecision);
  const confirmed = (identities ?? [])
    .filter((i) => i.verification_state === "verified")
    .map((i) => ({
      team_member_id: i.team_member_id as string,
      primary_login: i.primary_login as string | null,
      external_ref: i.external_ref as string | null,
    }));
  const memberList = (members ?? []).map((m) => ({
    id: m.id as string,
    display_name: m.display_name as string,
  }));

  const classifications: EmailClassification[] = [];
  const suggestions: (IdentitySuggestion & { endpoint_id: string })[] = [];
  for (const e of endpoints ?? []) {
    const email = String(e.normalized_value).toLowerCase();
    const mb = mbByEmail.get(email);
    const meta = {
      email,
      // PROVIDER type, from provider metadata (falling back to the endpoint kind the discovery
      // adapter recorded); NEVER inferred from the address text.
      mailbox_type:
        (mb?.mailbox_type as string | null) ??
        (e.endpoint_kind === "shared_mailbox"
          ? "shared"
          : e.endpoint_kind === "group_address"
            ? "group"
            : "user"),
      status: (mb?.status as string | null) ?? null,
      display_name: (mb?.display_name as string | null) ?? null,
    };
    // Operational classification is set ONLY from the operator's latest review (or an
    // unambiguous provider signal); a plain user box stays UNKNOWN until reviewed.
    const op = classifyOperational(meta, latestReview.get(e.id as string) ?? null);
    classifications.push({
      endpoint_id: e.id as string,
      email,
      provider_mailbox_type: providerMailboxType(meta),
      operational_class: op.class,
      operational_reviewed: op.reviewed,
      provider_display_name: meta.display_name,
      evidence: op.evidence,
      status: meta.status,
    });
    suggestions.push({
      ...suggestIdentity(meta, memberList, confirmed),
      endpoint_id: e.id as string,
    });
  }
  return {
    classifications,
    suggestions,
    reviews: (reviews ?? []).map((r) => ({
      endpoint_id: r.endpoint_id as string,
      decision: r.decision as string,
      team_member_id: (r.team_member_id as string | null) ?? null,
      created_at: r.created_at as string,
    })),
  };
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

  // ── Categorised issues (§11): distinct issue TYPES, not one flat total. ──
  const ownRoles = new Map<string, Set<string>>();
  for (const o of ownership ?? []) {
    if (o.review_state === "rejected") continue;
    const s = ownRoles.get(o.endpoint_id as string) ?? new Set<string>();
    s.add(o.assignment_role as string);
    ownRoles.set(o.endpoint_id as string, s);
  }
  const confirmedEmails = new Set(
    (identities ?? [])
      .filter((i) => i.verification_state === "verified")
      .map((i) => String(i.external_ref).toLowerCase()),
  );
  const confirmedMembers = new Set(
    (identities ?? [])
      .filter((i) => i.verification_state === "verified")
      .map((i) => i.team_member_id as string),
  );
  const memberWithPhone = new Set(
    (ownership ?? []).filter((o) => o.owner_member_id).map((o) => o.owner_member_id as string),
  );
  const [{ data: mailboxes }, { data: telInv }] = await Promise.all([
    admin
      .from("google_workspace_mailboxes")
      .select("email_address, status")
      .eq("tenant_id", tenantId),
    admin
      .from("telephony_inventory")
      .select("id, canonical_type")
      .eq("tenant_id", tenantId)
      .eq("status", "active"),
  ]);
  const suspended = new Set(
    (mailboxes ?? [])
      .filter((m) => String(m.status).toLowerCase() === "suspended")
      .map((m) => String(m.email_address).toLowerCase()),
  );

  for (const e of endpoints ?? []) {
    const val = String(e.normalized_value).toLowerCase();
    if (
      e.endpoint_kind !== "shared_mailbox" &&
      e.endpoint_kind !== "group_address" &&
      String(e.endpoint_kind).includes("email")
    ) {
      if (!confirmedEmails.has(val))
        items.push({
          kind: "email_no_confirmed_identity",
          detail: `${e.normalized_value} has no confirmed person/team identity`,
          ref: e.id as string,
        });
    }
    if (suspended.has(val))
      items.push({
        kind: "suspended_mailbox",
        detail: `${e.normalized_value} is suspended`,
        ref: e.id as string,
      });
    const roles = ownRoles.get(e.id as string) ?? new Set();
    if (!roles.has("cover"))
      items.push({
        kind: "endpoint_no_cover",
        detail: `${e.normalized_value} has no cover`,
        ref: e.id as string,
      });
    if (!roles.has("escalation"))
      items.push({
        kind: "endpoint_no_escalation",
        detail: `${e.normalized_value} has no escalation`,
        ref: e.id as string,
      });
  }
  for (const m of members ?? []) {
    if (!confirmedMembers.has(m.id as string))
      items.push({
        kind: "person_no_email_identity",
        detail: `member ${(m.id as string).slice(0, 8)} has no confirmed email identity`,
        ref: m.id as string,
      });
    if (!memberWithPhone.has(m.id as string))
      items.push({
        kind: "person_no_phone",
        detail: `member ${(m.id as string).slice(0, 8)} has no phone endpoint`,
        ref: m.id as string,
      });
  }
  const unclassified = (telInv ?? []).filter((r) => r.canonical_type === "endpoint").length;
  if (unclassified > 0)
    items.push({
      kind: "unclassified_phone_metadata",
      detail: `${unclassified} provider metadata records not importable as endpoints`,
      ref: null,
    });
  items.push({
    kind: "provider_capability_unavailable",
    detail: "telephony DDI/queue discovery unavailable (planned); extensions/devices manual",
    ref: null,
  });

  return items;
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
  // Ended (historical) ownership — kept separate so `ownership` stays "currently active".
  const { data: ownershipHistory } = await admin
    .from("endpoint_ownership_assignments")
    .select(ASG_COLS + ", endpoint_id")
    .eq("tenant_id", tenantId)
    .not("effective_to", "is", null)
    .order("effective_to", { ascending: false })
    .limit(200);
  const [conn, identityResolution, telephonyIdentityResolution] = await Promise.all([
    loadConnectionsAndEvidence(admin, tenantId),
    computeIdentityResolution(admin, tenantId),
    computeTelephonyIdentityResolution(admin, tenantId),
  ]);
  return {
    summary,
    members: members ?? [],
    identities: identities ?? [],
    endpoints: endpoints ?? [],
    ownership: ownership ?? [],
    ownershipHistory: ownershipHistory ?? [],
    dataQuality,
    connections: conn.connections,
    phoneEvidence: conn.phoneEvidence,
    identityResolution,
    // Telephony extension candidates (Discover→Review→Confirm), parallel to the email
    // identityResolution above. Provider-neutral suggestions with evidence + confidence.
    telephonyIdentityResolution,
  };
}
