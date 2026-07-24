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
  confidence: number | null;
  review_state: string;
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
export interface Connections {
  google_workspace: {
    status: string;
    connections: { domain: string | null; status: string }[];
    approved_domains: string[];
    imported: number;
    excluded: number;
    excluded_domains: Record<string, number>;
    read_only: boolean;
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
  };
  slack: { status: string; note: string };
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
export type MailboxClass = "personal" | "shared" | "group" | "service" | "suspended" | "unknown";
export interface EmailClassification {
  endpoint_id: string;
  email: string;
  class: MailboxClass;
  evidence: string;
  status: string | null;
}
export interface IdentitySuggestion {
  endpoint_id: string;
  endpoint_email: string;
  mailbox_class: MailboxClass;
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
  reviews: { endpoint_id: string; decision: string; team_member_id: string | null; created_at: string }[];
}
export interface Workspace {
  summary: TenantSummary;
  members: CpMember[];
  identities: CpIdentity[];
  endpoints: CpEndpoint[];
  ownership: CpOwnership[];
  dataQuality: DataQualityItem[];
  connections?: Connections;
  phoneEvidence?: PhoneEvidenceItem[];
  identityResolution?: IdentityResolution;
}
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
export const reviewIdentity = (p: {
  tenant_id: string;
  endpoint_id: string;
  decision: "confirmed_person" | "shared" | "system" | "rejected" | "unresolved";
  team_member_id?: string | null;
  confidence?: string;
  reason: string;
}) => invoke<{ review_id: string; identity_id: string | null; decision: string }>({ action: "identity.review", ...p });
export const updateManualEndpoint = (p: {
  tenant_id: string;
  endpoint_id: string;
  display_value?: string;
  provider_context?: string;
  expected_updated_at?: string | null;
  reason: string;
}) => invoke<{ id: string; outcome: string }>({ action: "endpoint.update", ...p });
export const endOwnership = (p: { tenant_id: string; assignment_id: string; reason: string }) =>
  invoke<{ id: string; outcome: string }>({ action: "ownership.end", ...p });
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
