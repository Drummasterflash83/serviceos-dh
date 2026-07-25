/**
 * OpenFolk Control Plane — client (platform-operator only).
 *
 * Calls the `openfolk-control-plane` Edge Function, which enforces OpenFolk role + an
 * active platform.controlplane grant SERVER-SIDE (view to read, admin to write). This
 * surface is NEVER exposed in tenant navigation; a non-operator receives 403 and an
 * explanatory panel — access is not frontend-hidden.
 */
import { supabaseConfig, getAccessToken } from "./supabase";
import { apiFetch } from "./api";
import type { ApiResult } from "./types";

async function invoke<T>(payload: unknown): Promise<ApiResult<T>> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const token = await getAccessToken();
  if (!token)
    return { ok: false, error: { code: "missing_auth", message: "You must be signed in" } };
  const res = await apiFetch<{ ok: boolean; data?: T; error?: { code: string; message: string } }>(
    `${supabaseConfig.url}/functions/v1/openfolk-control-plane`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload ?? {}),
    },
  );
  if (!res.ok) return res;
  const body = res.data;
  if (!body?.ok)
    return { ok: false, error: body?.error ?? { code: "unknown", message: "request failed" } };
  return { ok: true, data: (body.data ?? (body as unknown as T)) as T };
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
export interface ReadinessCheck {
  key: string;
  ok: boolean;
  detail: string;
}
export interface SourceReadiness {
  channel: string;
  level: "not_ready" | "ready_for_evaluation" | "ready_for_chris_shadow" | "ready_for_staff_pilot";
  checks: ReadinessCheck[];
  summary: string;
}
export interface CpMember {
  id: string;
  display_name: string;
  formal_role: string | null;
  org_unit_id: string | null;
  effective_to: string | null;
}
export interface CpEndpoint {
  id: string;
  channel: string;
  endpoint_kind: string;
  normalized_value: string;
  display_value: string | null;
  provider: string | null;
  is_shared: boolean;
  status: string;
  source: string; // 'manual' endpoints are operator-editable; provider evidence is not
  updated_at: string; // optimistic-concurrency token for manual edits
}
export interface CpOwnership {
  id: string;
  endpoint_id: string;
  owner_kind: string;
  owner_member_id: string | null;
  owner_org_unit_id: string | null;
  owner_role: string | null;
  assignment_role: string;
  effective_from: string;
  effective_to: string | null;
  confidence: number | null;
  review_state: string;
  updated_at?: string;
}
export interface CpIdentity {
  id: string;
  team_member_id: string;
  provider: string;
  identity_kind: string;
  external_ref: string;
  display: string | null;
  verification_state: string;
}
export interface DataQualityItem {
  kind: string;
  detail: string;
  ref: string | null;
}
// Real per-connection lifecycle from provider_connections + events + sync runs. Additive;
// present only when the backend projection supplies it. NEVER contains secret refs/tokens.
export interface ConnectionLifecycle {
  connection_id: string | null;
  provider: string | null;
  status: string | null;
  auth_mode: string | null;
  account_ref: string | null;
  configured_fields: string[];
  has_secrets: boolean;
  verified_at: string | null;
  last_test_status: string | null;
  last_test_at: string | null;
  revoked_at: string | null;
  latest_event: string | null;
  latest_event_at: string | null;
  last_successful_discovery: string | null;
  last_failed_discovery: string | null;
  discovery_counts: { last_run_processed: number | null };
  is_fallback: boolean;
  fallback_reason: string | null;
}
export interface Connections {
  google_workspace: {
    status: string;
    connections: { domain: string | null; status: string }[];
    approved_domains: string[];
    imported: number;
    excluded: number;
    excluded_domains: Record<string, number>;
    read_only: boolean;
    lifecycle?: ConnectionLifecycle;
  };
  telephony: {
    commercial_provider: string;
    underlying_provider: string;
    account_ref: string;
    status: string;
    credentials: string;
    capabilities: Record<string, string> | null;
    external_write: string;
    evidence_count: number;
    lifecycle?: ConnectionLifecycle;
  };
  slack: { status: string; note: string };
}
export interface DiscoveryRun {
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
}
export interface DelegatedTask {
  id: string;
  tenant_id: string;
  provider: string | null;
  connection_id: string | null;
  task_type: string;
  requested_action: string;
  recipient_email: string;
  recipient_name: string | null;
  status: string;
  token_last4: string | null;
  single_use: boolean;
  max_uses: number;
  use_count: number;
  expires_at: string;
  opened_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
  created_by: string | null;
  correlation_id: string;
  created_at: string;
  submission_present?: boolean;
}
export interface DelegatedIssueResult {
  task_id: string;
  task_type: string;
  recipient_email: string;
  token_last4: string;
  setup_url: string; // shown ONCE — never persisted
  warning: string;
}
export interface PhoneEvidenceItem {
  id: string;
  provider: string | null;
  external_ref: string | null;
  canonical_type: string;
  label: string | null;
  status: string;
  discovery_source: string | null;
}
// Provider mailbox type = raw provider fact; operational class = how it's actually used
// (set only from reviewed evidence). These are DELIBERATELY separate — a provider `user`
// mailbox may still be operationally shared/team, and defaults to `unknown` until reviewed.
export type ProviderMailboxType = "user" | "group" | "alias" | "shared" | "suspended" | "unknown";
export type OperationalClass = "personal" | "shared" | "team" | "service" | "inactive" | "unknown";
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
export interface IdentitySuggestion {
  endpoint_id: string;
  endpoint_email: string;
  provider_mailbox_type: ProviderMailboxType;
  operational_class: OperationalClass;
  suggested_member_id: string | null;
  suggested_kind: "person" | "shared" | "none";
  confidence: "high" | "medium" | "low" | "unresolved";
  evidence: string;
  provenance: string;
  ambiguity: string[];
}
export interface IdentityResolution {
  classifications: EmailClassification[];
  suggestions: IdentitySuggestion[];
  reviews: {
    endpoint_id: string;
    decision: string;
    team_member_id: string | null;
    created_at: string;
  }[];
}
// Telephony extension candidate — the phone analogue of an email IdentitySuggestion. Derived
// provider-neutrally from call activity; carries the supporting evidence the operator needs
// (labels, call volume, last-seen) and never auto-confirms.
export interface TelephonyCandidate {
  endpoint_id: string;
  endpoint_extension: string;
  display_value: string | null;
  suggested_member_id: string | null;
  suggested_kind: "person" | "shared" | "none";
  confidence: "high" | "medium" | "low" | "unresolved";
  evidence: string;
  provenance: string;
  ambiguity: string[];
  named_members: string[];
  unknown_label_names: string[];
  observed_labels: string[];
  call_count: number;
  last_activity: string | null;
}
export interface TelephonyIdentityResolution {
  candidates: TelephonyCandidate[];
}
// Slack identity candidate — the Slack analogue. Discovered read-only from the user directory
// (never message content). A Slack user id is never a canonical person id.
export interface SlackCandidate {
  endpoint_id: string | null; // communication_endpoints (channel=slack) — set by discovery
  slack_user_id: string;
  suggested_member_id: string | null;
  suggested_kind: "person" | "system" | "none";
  confidence: "high" | "medium" | "low" | "unresolved";
  evidence: string;
  provenance: string;
  matched_by: string;
  ambiguity: string[];
  deactivated: boolean;
  classification: "person" | "bot" | "app" | "system";
  display_name: string | null;
  real_name: string | null;
  email: string | null;
  title: string | null;
  tz: string | null;
  is_guest: boolean;
}
export interface SlackIdentityResolution {
  workspace: { team_id: string | null; team_name: string | null } | null;
  candidates: SlackCandidate[];
}
export interface Workspace {
  summary: TenantSummary;
  members: CpMember[];
  identities: CpIdentity[];
  endpoints: CpEndpoint[];
  ownership: CpOwnership[];
  ownershipHistory?: CpOwnership[];
  dataQuality: DataQualityItem[];
  connections?: Connections;
  phoneEvidence?: PhoneEvidenceItem[];
  identityResolution?: IdentityResolution;
  telephonyIdentityResolution?: TelephonyIdentityResolution;
  slackIdentityResolution?: SlackIdentityResolution;
}
// ── Learning Centre (read-only operator view) — mirrors _shared/controlplane/learning_centre.ts
export interface LcSourceStatus {
  key: string;
  label: string;
  connectionState: "live" | "foundation" | "planned" | "not_connected";
  scheduleState: "active" | "dormant" | "not_applicable";
  latestEvidenceAt: string | null;
  freshness: "fresh" | "recent" | "stale" | "none";
  received: number | null;
  processed: number | null;
  failedOrPending: number | null;
  coverage: { label: string; value: string }[];
  confirmedIdentities: number | null;
  unresolvedIdentities: number | null;
  gaps: string[];
  actionRequired: string | null;
}
export interface LcIntelQueue {
  key: string;
  label: string;
  count: number;
  drill: { table: string; filter: string };
  note?: string;
}
export interface LearningOverview {
  tenantId: string;
  generatedAt: string;
  sourceTruth: {
    summary: {
      sourcesLive: string[];
      sourcesMissing: string[];
      latestEvidenceAt: string | null;
      processingHealth: "ok" | "attention" | "unknown";
      identityCoverage: { confirmed: number; unresolved: number; pct: number | null };
      majorBlindSpots: string[];
    };
    sources: LcSourceStatus[];
  };
  existingIntelligence: {
    totals: {
      interactions: number;
      intelligenceObjects: number;
      observations: number;
      actions: number;
      recommendations: number;
    };
    queues: LcIntelQueue[];
    repeatedThemes: { subject: string; count: number }[];
    waiting: { derived: boolean; note: string };
  };
}
export const getLearningOverview = (tenant_id: string) =>
  invoke<LearningOverview>({ action: "learning.overview", tenant_id });

// Drill-down — the EXISTING canonical records behind a factual queue (read-only).
export interface LcDrillRecord {
  id: string;
  objectType: string | null;
  subject: string;
  status: string | null;
  deadline: string | null;
  isOverdue: boolean;
  overdueMs: number | null;
  elapsedMs: number | null;
  confidence: number | null;
  occurredAt: string | null;
  owner: { state: "confirmed" | "unresolved"; label: string | null };
  customer: string | null;
  source: { type: string | null; ref: string | null; interactionId: string | null } | null;
  evidenceExcerpt: string | null;
  whyQualified: string;
}
export interface LcDrillResult {
  queueKey: string;
  label: string;
  drillable: boolean;
  trace: { table: string; filter: string };
  why: string;
  records: LcDrillRecord[];
  returned: number;
  truncated: boolean;
  note?: string;
}
export const getLearningDrill = (tenant_id: string, queue: string) =>
  invoke<LcDrillResult>({ action: "learning.drill", tenant_id, queue });

export interface EndpointValidation {
  valid: boolean;
  errors?: string[];
  kind?: string;
  canonical?: string;
  display?: string;
  duplicate?: { normalized_value: string; source: string | null } | null;
}
export interface AuditEntry {
  actor: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  reason: string | null;
  view_as_active: boolean;
  created_at: string;
}

export const listTenants = () => invoke<{ tenants: TenantSummary[] }>({ action: "tenants.list" });
export const getWorkspace = (tenant_id: string) =>
  invoke<Workspace>({ action: "workspace", tenant_id });
export const getReadiness = (tenant_id: string) =>
  invoke<SourceReadiness>({ action: "readiness", tenant_id });
export const getAudit = (tenant_id: string) =>
  invoke<{ entries: AuditEntry[] }>({ action: "audit", tenant_id });
export const discoverTelephony = (tenant_id: string, reason: string) =>
  invoke<{ scanned: number; upserted: number; skipped: number }>({
    action: "discover.telephony",
    tenant_id,
    reason,
  });
export interface EmailDiscoverySummary {
  scanned: number;
  upserted: number;
  created: number;
  updated: number;
  unchanged: number;
  excluded: number;
  excluded_domains: Record<string, number>;
  approved_domains: string[];
  default_denied: boolean;
}
export const discoverEmail = (tenant_id: string, reason: string) =>
  invoke<EmailDiscoverySummary>({ action: "discover.email", tenant_id, reason });
export const validateEndpoint = (p: {
  tenant_id: string;
  endpoint_kind: string;
  value?: string;
  display_value?: string;
  provider_context?: string;
  provider_id?: string;
}) => invoke<EndpointValidation>({ action: "endpoint.validate", ...p });
export const createManualEndpoint = (p: {
  tenant_id: string;
  endpoint_kind: string;
  value?: string;
  display_value?: string;
  provider_context?: string;
  provider_id?: string;
  notes?: string;
  reason: string;
}) => invoke<{ id: string; outcome: string }>({ action: "endpoint.manual_create", ...p });
export const archiveEndpoint = (p: { tenant_id: string; endpoint_id: string; reason: string }) =>
  invoke<{ id: string; outcome: string }>({ action: "endpoint.archive", ...p });
export type ReviewDecision =
  | "confirmed_person"
  | "shared"
  | "team"
  | "system"
  | "rejected"
  | "unresolved"
  | "deferred"
  | "unassigned";
export const reviewIdentity = (p: {
  tenant_id: string;
  endpoint_id: string;
  decision: ReviewDecision;
  team_member_id?: string | null;
  confidence?: string;
  reason: string;
}) =>
  invoke<{ review_id: string; identity_id: string | null; decision: string }>({
    action: "identity.review",
    ...p,
  });

// ── Identity Resolution V1 (read-only Review mode) ───────────────────────────
export type IdentityMappingState =
  | "discovered"
  | "suggested"
  | "conflicting"
  | "confirmed"
  | "shared"
  | "rejected"
  | "deferred"
  | "historical"
  | "unassigned";
export interface IdentityCandidate {
  key: string;
  endpointId: string | null;
  channel: "email" | "phone" | "slack" | "commusoft";
  candidateKind:
    | "email_address"
    | "email_alias"
    | "mailbox"
    | "extension"
    | "ddi"
    | "telephony_provider"
    | "commusoft"
    | "slack";
  provider: string | null;
  rawExternalIdentity: string;
  isShared: boolean;
  suggestedMemberId: string | null;
  suggestedMemberName: string | null;
  suggestedKind: "person" | "shared" | "none";
  confidence: "high" | "medium" | "low" | "unresolved";
  mappingState: IdentityMappingState;
  supportingEvidence: string[];
  conflictingEvidence: string[];
  lastObservedAt: string | null;
  activityCount: number | null;
  latestDecision: string | null;
}
export interface IdentityCandidateSet {
  tenantId: string;
  generatedAt: string;
  candidates: IdentityCandidate[];
  summary: {
    total: number;
    byState: Record<string, number>;
    byChannel: Record<string, number>;
    confirmed: number;
    needsReview: number;
  };
}
export interface IdentityImpact {
  endpointId: string;
  channel: string;
  rawExternalIdentity: string;
  interactions: number;
  intelligenceObjects: number;
  unresolvedActions: number;
  sampleInteractionIds: string[];
  note: string | null;
}
export const getIdentityCandidates = (tenant_id: string) =>
  invoke<IdentityCandidateSet>({ action: "identity.candidates", tenant_id });
export const getIdentityImpact = (tenant_id: string, endpoint_id: string) =>
  invoke<IdentityImpact>({ action: "identity.impact", tenant_id, endpoint_id });
export const updateManualEndpoint = (p: {
  tenant_id: string;
  endpoint_id: string;
  display_value?: string;
  provider_context?: string;
  expected_updated_at?: string | null;
  reason: string;
}) => invoke<{ id: string; outcome: string }>({ action: "endpoint.update", ...p });
export const endOwnership = (p: {
  tenant_id: string;
  assignment_id: string;
  effective_to?: string | null;
  expected_updated_at?: string | null;
  reason: string;
}) =>
  invoke<{ id: string; outcome: string; effective_to?: string }>({ action: "ownership.end", ...p });
export const restoreEndpoint = (p: { tenant_id: string; endpoint_id: string; reason: string }) =>
  invoke<{ id: string; outcome: string }>({ action: "endpoint.restore", ...p });
export const assignOwnership = (p: {
  tenant_id: string;
  endpoint_id: string;
  owner_kind: string;
  owner_member_id?: string | null;
  owner_org_unit_id?: string | null;
  owner_role?: string | null;
  assignment_role: string;
  confidence?: number;
  reason: string;
}) => invoke<{ id: string }>({ action: "ownership.assign", ...p });
export const upsertMember = (p: {
  tenant_id: string;
  member_id?: string;
  display_name: string;
  formal_role?: string;
  reason: string;
}) => invoke<{ id: string }>({ action: "member.upsert", ...p });

// ── Connections: discovery history + delegated setup tasks (operator) ──
export const getDiscoveryHistory = (
  tenant_id: string,
  opts: { page?: number; page_size?: number; provider?: string; status?: string } = {},
) =>
  invoke<{
    runs: DiscoveryRun[];
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  }>({ action: "connections.discovery_history", tenant_id, ...opts });
export const listDelegatedTasks = (tenant_id: string) =>
  invoke<{ tasks: DelegatedTask[] }>({ action: "delegated.list", tenant_id });
export const issueDelegatedTask = (p: {
  tenant_id: string;
  task_type: string;
  requested_action: string;
  recipient_email: string;
  recipient_name?: string;
  allowed_fields?: string[];
  provider?: string;
  connection_id?: string;
  ttl_seconds?: number;
  origin?: string;
  reason: string;
}) => invoke<DelegatedIssueResult>({ action: "delegated.issue", ...p });
export const revokeDelegatedTask = (p: { tenant_id: string; task_id: string; reason: string }) =>
  invoke<{ revoked: boolean }>({ action: "delegated.revoke", ...p });
export const getDelegatedSubmission = (p: { tenant_id: string; task_id: string }) =>
  invoke<{ task: DelegatedTask & { submission: Record<string, unknown> | null } }>({
    action: "delegated.get_submission",
    ...p,
  });
