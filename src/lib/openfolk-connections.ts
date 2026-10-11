/**
 * OpenFolk Control Plane — generic Tenant Connections model + projection (pure, no JSX).
 *
 * ONE reusable connection lifecycle that every integration (Google Workspace, Microsoft
 * 365, Birchills/Sipcentric telephony, Slack, Commusoft, Square, …) flows through:
 *   Connection → Authorisation → Verification → Discovery → Canonical inventory →
 *   Identity review → Ownership → Readiness → Shadow → Production.
 *
 * This module is a PROJECTION over data the Control Plane already returns (the `connections`
 * payload from the openfolk-control-plane Edge Function) plus a static provider-template
 * registry. It NEVER fabricates a connection or a capability: a provider with no live data
 * is shown from its template as not-connected / setup-required / adapter-not-implemented,
 * and capability states reflect real provider limitations (e.g. Birchills DDI discovery is
 * "planned", extensions are "manual"). No secret values ever appear here — secrets live in
 * the server-side secret broker and are referenced, never returned.
 *
 * Kept pure + unit-tested (see openfolk-connections.test.ts); the UI renders these views.
 */
import type { Connections, ConnectionLifecycle, Workspace } from "./openfolk";

// ── Lifecycle / discovery / readiness states (kept DISTINCT — never collapsed) ──
export const CONNECTION_STATES = [
  "not_configured",
  "setup_required",
  "authorisation_requested",
  "awaiting_customer_admin",
  "authorising",
  "connected",
  "verification_failed",
  "degraded",
  "expired",
  "revoked",
  "disconnected",
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const DISCOVERY_STATES = [
  "never_run",
  "ready",
  "running",
  "succeeded",
  "partially_succeeded",
  "failed",
  "unsupported",
] as const;
export type DiscoveryState = (typeof DISCOVERY_STATES)[number];

export const CONNECTION_READINESS = [
  "not_ready",
  "connected",
  "inventory_ready",
  "mapping_ready",
  "ready_for_evaluation",
  "ready_for_shadow",
  "ready_for_production",
] as const;
export type ConnectionReadiness = (typeof CONNECTION_READINESS)[number];

export type AuthorisationState =
  "not_authorised" | "authorised" | "awaiting_customer_admin" | "expired" | "revoked";
export type VerificationState = "never_verified" | "verified" | "failed" | "stale";
export type HealthState = "unknown" | "healthy" | "degraded" | "failed" | "not_connected";

// ── Provider-neutral capability registry ──
export const CAPABILITY_KEYS = [
  "directory_users",
  "mailboxes",
  "aliases",
  "groups",
  "email_metadata",
  "email_content",
  "ddis",
  "extensions",
  "queues",
  "ring_groups",
  "devices",
  "call_history",
  "call_recordings",
  "live_call_events",
  "routing_changes",
  "provisioning",
  "calendar",
  "files",
  "chat_users",
  "chat_channels",
  "jobs",
  "customers",
  "invoices",
  "payments",
  "pos",
  "webhooks",
] as const;
export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

// A capability's state is truthful about the REAL provider limitation, never "the API
// exists therefore supported". `unavailable` is the backend telephony registry's term
// (_shared/telephony/capabilities.ts) and is carried through verbatim rather than
// silently upgraded.
export const CAPABILITY_STATES = [
  "supported",
  "read_only",
  "manual",
  "planned",
  "unavailable",
  "unsupported",
  "requires_customer_admin",
  "requires_provider_support",
] as const;
export type CapabilityState = (typeof CAPABILITY_STATES)[number];

export interface CapabilityView {
  // A neutral vocabulary key OR a provider's real capability key (e.g. the backend
  // telephony registry's `ddi_discovery`) — displayed verbatim, never invented.
  key: string;
  state: CapabilityState;
  note?: string;
}

export type ProviderFamily =
  "google_workspace" | "microsoft_365" | "telephony" | "slack" | "commusoft" | "square";

export interface ConnectionBoundary {
  label: string;
  value: string;
}

export interface ConnectionView {
  id: string; // stable per (tenant, provider family) — projection id, not a DB id
  family: ProviderFamily;
  providerLabel: string;
  commercialProvider: string | null;
  underlyingProvider: string | null;
  accountRef: string | null;
  connected: boolean;
  adapterImplemented: boolean;
  lifecycle: ConnectionState;
  authorisation: AuthorisationState;
  verification: VerificationState;
  health: HealthState;
  readiness: ConnectionReadiness;
  externalRead: boolean;
  externalWrite: boolean;
  capabilities: CapabilityView[];
  boundaries: ConnectionBoundary[];
  warnings: string[];
  /** Human note when not connected / adapter missing — truthful, never fabricated. */
  notConnectedReason: string | null;
  lastVerified: string | null; // null = "not available from the current backend projection"
  lastDiscovery: string | null;
  inventoryCount: number; // canonical records attributable to this connection (best-effort)
  evidenceCount: number; // raw provider evidence (non-canonical)
  lifecycleDetail: ConnectionLifecycle | null; // real backend lifecycle (present once enriched)
}

// ── Provider template registry (§13) — declares each provider's expected shape. Placeholders
// state "Not connected" / "Adapter not yet implemented" truthfully; they never fabricate a
// working integration. ──
export interface ProviderTemplate {
  family: ProviderFamily;
  providerLabel: string;
  adapterImplemented: boolean;
  /** Capability expectations when this provider IS connected (may be overridden by live data). */
  declaredCapabilities: CapabilityView[];
  /** Shown when no live connection data exists. */
  placeholderLifecycle: ConnectionState;
  placeholderReason: string;
}

const cap = (key: string, state: CapabilityState, note?: string): CapabilityView => ({
  key,
  state,
  note,
});

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    family: "google_workspace",
    providerLabel: "Google Workspace",
    adapterImplemented: true,
    declaredCapabilities: [
      cap("directory_users", "read_only"),
      cap("mailboxes", "read_only"),
      cap("aliases", "read_only"),
      cap("groups", "read_only"),
      cap("email_metadata", "read_only"),
      cap("email_content", "planned", "not enabled — no content ingestion active"),
      cap("calendar", "unsupported"),
      cap("files", "unsupported"),
    ],
    placeholderLifecycle: "setup_required",
    placeholderReason: "Setup required",
  },
  {
    family: "microsoft_365",
    providerLabel: "Microsoft 365",
    adapterImplemented: false,
    declaredCapabilities: [
      cap("directory_users", "planned"),
      cap("mailboxes", "planned"),
      cap("groups", "planned"),
      cap("email_metadata", "planned"),
    ],
    placeholderLifecycle: "not_configured",
    placeholderReason: "Adapter not yet implemented",
  },
  {
    family: "telephony",
    providerLabel: "Telephony",
    adapterImplemented: true,
    declaredCapabilities: [
      cap("ddis", "planned", "typed DDI discovery unavailable / planned"),
      cap("extensions", "manual", "typed extension inventory is manual"),
      cap("devices", "manual"),
      cap("queues", "planned", "queue / ring-group inventory unavailable / planned"),
      cap("ring_groups", "planned"),
      cap("call_history", "read_only"),
      cap("call_recordings", "read_only"),
      cap("provisioning", "unsupported", "external provisioning disabled"),
    ],
    placeholderLifecycle: "setup_required",
    placeholderReason: "Setup required",
  },
  {
    family: "slack",
    providerLabel: "Slack",
    adapterImplemented: false,
    declaredCapabilities: [cap("chat_users", "planned"), cap("chat_channels", "planned")],
    placeholderLifecycle: "setup_required",
    placeholderReason: "Identity model ready — ingestion not connected",
  },
  {
    family: "commusoft",
    providerLabel: "Commusoft",
    adapterImplemented: false,
    declaredCapabilities: [
      cap("jobs", "planned"),
      cap("customers", "planned"),
      cap("invoices", "planned"),
    ],
    placeholderLifecycle: "setup_required",
    placeholderReason: "Setup required",
  },
];

// The telephony `capabilities` map comes straight from the backend registry
// (_shared/telephony/capabilities.ts), whose keys are provider-real (ddi_discovery,
// extension_discovery, …) and states are supported|manual|unavailable|planned. We carry
// them through verbatim; an unrecognised state degrades to "planned" (never up to supported).
function coerceCapState(raw: string): CapabilityState {
  return (CAPABILITY_STATES as readonly string[]).includes(raw)
    ? (raw as CapabilityState)
    : "planned";
}

/**
 * Project the Control Plane `connections` payload + workspace into generic connection views.
 * Providers with no live data come purely from their template (truthful placeholder).
 */
export function projectConnections(
  connections: Connections | undefined,
  workspace?: Pick<Workspace, "endpoints" | "identities">,
): ConnectionView[] {
  const endpoints = workspace?.endpoints ?? [];
  const identities = workspace?.identities ?? [];
  const views: ConnectionView[] = [];

  for (const tpl of PROVIDER_TEMPLATES) {
    if (tpl.family === "telephony" && connections?.telephony_accounts?.length) {
      for (const phone of connections.telephony_accounts) {
        const view = buildView(tpl, { ...connections, telephony: phone }, endpoints, identities);
        views.push({ ...view, id: `${view.id}-${phone.underlying_provider}` });
      }
    } else views.push(buildView(tpl, connections, endpoints, identities));
  }
  return views;
}

function connectionState(status: string, detail: ConnectionLifecycle | undefined, phone = false) {
  const state = status.toLowerCase();
  const revoked = state === "revoked" || !!detail?.revoked_at;
  const failedTest = ["failed", "error"].includes(detail?.last_test_status ?? "");
  const verifiedAt = detail?.verified_at ? Date.parse(detail.verified_at) : NaN;
  const verified = Number.isFinite(verifiedAt) && verifiedAt <= Date.now() && !failedTest;
  const inactive =
    revoked ||
    ["disabled", "disconnected", "not_connected", "expired", "not_configured"].includes(state);
  const connected =
    !inactive &&
    !failedTest &&
    (["connected", "active"].includes(state) ||
      (phone && state === "configured" && detail?.has_secrets === true && verified));
  const failed = failedTest || ["error", "failed", "verification_failed"].includes(state);
  const recentSyncFailed = ["failed", "error"].includes(detail?.last_sync_status ?? "");
  const discoveryFailed =
    !!detail?.last_failed_discovery &&
    (!detail.last_successful_discovery ||
      Date.parse(detail.last_failed_discovery) >= Date.parse(detail.last_successful_discovery));
  return {
    connected,
    lifecycle: (revoked
      ? "revoked"
      : state === "expired"
        ? "expired"
        : failed
          ? "verification_failed"
          : connected
            ? recentSyncFailed || discoveryFailed
              ? "degraded"
              : "connected"
            : state === "degraded"
              ? "degraded"
              : "setup_required") as ConnectionState,
    authorisation: (revoked
      ? "revoked"
      : state === "expired"
        ? "expired"
        : connected
          ? "authorised"
          : "not_authorised") as AuthorisationState,
    verification: (failedTest || failed
      ? "failed"
      : inactive && verified
        ? "stale"
        : verified
          ? "verified"
          : "never_verified") as VerificationState,
    // A configuration/test is not a current capture heartbeat.
    health: (failed
      ? "failed"
      : state === "degraded" || (connected && (recentSyncFailed || discoveryFailed))
        ? "degraded"
        : connected
          ? "unknown"
          : "not_connected") as HealthState,
  };
}

function buildView(
  tpl: ProviderTemplate,
  connections: Connections | undefined,
  endpoints: Workspace["endpoints"],
  identities: Workspace["identities"],
): ConnectionView {
  const base: ConnectionView = {
    id: `conn-${tpl.family}`,
    family: tpl.family,
    providerLabel: tpl.providerLabel,
    commercialProvider: null,
    underlyingProvider: null,
    accountRef: null,
    connected: false,
    adapterImplemented: tpl.adapterImplemented,
    lifecycle: tpl.placeholderLifecycle,
    authorisation: "not_authorised",
    verification: "never_verified",
    health: "not_connected",
    readiness: "not_ready",
    externalRead: false,
    externalWrite: false,
    capabilities: tpl.declaredCapabilities,
    boundaries: [],
    warnings: [],
    notConnectedReason: tpl.placeholderReason,
    lastVerified: null,
    lastDiscovery: null,
    inventoryCount: 0,
    evidenceCount: 0,
    lifecycleDetail: null,
  };

  if (tpl.family === "google_workspace" && connections?.google_workspace) {
    const g = connections.google_workspace;
    const state = connectionState(g.status, g.lifecycle);
    const { connected } = state;
    const boundaries: ConnectionBoundary[] = [
      { label: "Approved domains", value: g.approved_domains.join(", ") || "—" },
      {
        label: "Stored domain connections",
        value:
          g.connections.map((c) => `${c.domain ?? "Unknown domain"}: ${c.status}`).join(", ") ||
          "None",
      },
    ];
    const excludedDomains = Object.entries(g.excluded_domains)
      .map(([d, n]) => `${d} (${n})`)
      .join(", ");
    if (excludedDomains) boundaries.push({ label: "Excluded domains", value: excludedDomains });
    const warnings: string[] = [
      "Retained inventory and connection tests do not verify current message/call capture.",
    ];
    if (g.excluded > 0)
      warnings.push(
        `Connected directory contains ${g.excluded} identity(ies) outside the approved tenant boundary`,
      );
    return {
      ...base,
      commercialProvider: "Google Workspace",
      underlyingProvider: "Google Directory / Gmail API",
      ...state,
      health: state.health === "unknown" && g.excluded > 0 ? "degraded" : state.health,
      readiness: connected ? (g.imported > 0 ? "inventory_ready" : "connected") : "not_ready",
      externalRead: connected,
      externalWrite: !g.read_only,
      boundaries,
      warnings,
      notConnectedReason: connected
        ? null
        : state.lifecycle === "revoked"
          ? "Connection revoked. Review its authorization before reconnecting."
          : state.lifecycle === "verification_failed"
            ? "Provider verification failed. Review diagnostics before retesting."
            : state.lifecycle === "degraded"
              ? "Some stored connections need attention. Review each domain status."
              : tpl.placeholderReason,
      inventoryCount: g.imported,
      lifecycleDetail: g.lifecycle ?? null,
      lastVerified: g.lifecycle?.verified_at ?? null,
      lastDiscovery: g.lifecycle?.last_successful_discovery ?? null,
    };
  }

  if (tpl.family === "telephony" && connections?.telephony) {
    const t = connections.telephony;
    const state = connectionState(t.status, t.lifecycle, true);
    const { connected } = state;
    // Show the provider's REAL declared capabilities verbatim (backend registry keys +
    // states); fall back to the template only when the payload carries no map.
    const caps: CapabilityView[] =
      t.capabilities && Object.keys(t.capabilities).length > 0
        ? Object.entries(t.capabilities).map(([k, v]) => cap(k, coerceCapState(v)))
        : tpl.declaredCapabilities.map((c) => ({ ...c }));
    const typedPhone = endpoints.filter(
      (e) => e.channel === "phone" && e.status === "active" && e.provider === t.underlying_provider,
    ).length;
    const warnings: string[] = [
      "Retained inventory and connection tests do not verify current message/call capture.",
    ];
    if (typedPhone === 0)
      warnings.push(
        "No current typed endpoints are recorded for this Phone provider; review its discovery capabilities and inventory setup.",
      );
    return {
      ...base,
      commercialProvider: t.commercial_provider,
      underlyingProvider: t.underlying_provider,
      accountRef: t.account_ref,
      ...state,
      readiness: connected ? (typedPhone > 0 ? "inventory_ready" : "connected") : "not_ready",
      externalRead: connected,
      externalWrite: connected && t.external_write === "enabled",
      capabilities: caps,
      boundaries: [
        { label: "Provider account / customer", value: t.account_ref || "—" },
        { label: "External provisioning", value: t.external_write || "—" },
      ],
      warnings,
      notConnectedReason: connected
        ? null
        : state.lifecycle === "revoked"
          ? "Connection revoked. Review its authorization before reconnecting."
          : state.lifecycle === "verification_failed"
            ? "Provider verification failed. Review diagnostics before retesting."
            : state.lifecycle === "degraded"
              ? "Some stored connections need attention. Review each domain status."
              : tpl.placeholderReason,
      inventoryCount: typedPhone,
      evidenceCount: t.evidence_count,
      lifecycleDetail: t.lifecycle ?? null,
      lastVerified: t.lifecycle?.verified_at ?? null,
      lastDiscovery: t.lifecycle?.last_successful_discovery ?? null,
    };
  }

  if (tpl.family === "slack") {
    const note = connections?.slack?.note ?? tpl.placeholderReason;
    const slackIdentities = identities.filter((i) => i.provider === "slack").length;
    return {
      ...base,
      commercialProvider: "Slack",
      notConnectedReason: note,
      warnings: [],
      inventoryCount: slackIdentities,
    };
  }

  // microsoft_365, commusoft, and any other unconfigured provider → truthful placeholder.
  return base;
}

// ── Customer-facing capability / module projection (§12) — read-only, governed by readiness ──
export const CUSTOMER_MODULES = [
  "customer_health",
  "communication_intelligence",
  "job_health",
  "further_works",
  "capacity",
  "finance",
  "agents",
  "automations",
] as const;
export type CustomerModule = (typeof CUSTOMER_MODULES)[number];
export type ModuleState =
  | "unavailable"
  | "setup_required"
  | "connected"
  | "inventory_incomplete"
  | "mapping_incomplete"
  | "evaluation_required"
  | "ready_for_shadow"
  | "enabled"
  | "suspended";
