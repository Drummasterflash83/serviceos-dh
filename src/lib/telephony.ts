/**
 * Telephony calibration client — Settings → Phone / VoIP. Reads the discovered endpoint
 * inventory + evidence-based suggestions and lets an admin confirm/reject/deactivate
 * staff mappings, all tenant-scoped via the telephony-mapping edge function (owner/admin
 * for writes). Suggestions are never auto-confirmed.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type CapabilityState = "supported" | "manual" | "unavailable" | "planned";
export type SuggestionStatus = "suggested" | "conflicted" | "shared" | "unknown";

export interface EndpointSuggestion {
  suggestedPersonId: string | null;
  suggestedName: string | null;
  confidence: number;
  sharedLikelihood: number;
  conflicts: string[];
  status: SuggestionStatus;
  evidence: string[];
}
export interface EndpointMapping {
  status: string;
  active: boolean;
  person_name: string | null;
  is_shared_device: boolean;
  role: string | null;
}
export interface TelephonyEndpoint {
  endpoint_masked: string;
  endpoint_ref: string;
  inbound: number;
  outbound: number;
  last_seen: string | null;
  suggestion: EndpointSuggestion;
  mapping: EndpointMapping | null;
}
export interface TenantPerson {
  id: string;
  name: string;
}
export interface TelephonyInventory {
  provider: string;
  capabilities: { provider: string; label: string; capabilities: Record<string, CapabilityState> };
  people: TenantPerson[];
  endpoints: TelephonyEndpoint[];
  counts: { endpoints: number; confirmed: number; suggested: number; conflicts: number };
}

async function invoke<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("telephony-mapping", { body });
  if (error) return { ok: false, error: { code: "telephony_error", message: error.message } };
  if (data && (data as { success?: boolean }).success === false) {
    const e = (data as { error?: { code?: string; message?: string } }).error;
    return { ok: false, error: { code: e?.code ?? "error", message: e?.message ?? "failed" } };
  }
  return { ok: true, data: data as T };
}

export function getTelephonyInventory(): Promise<ApiResult<TelephonyInventory>> {
  return invoke<TelephonyInventory>({ action: "inventory" });
}

export function confirmEndpointMapping(input: {
  endpointRef: string;
  personNodeId: string | null;
  role?: string | null;
  isSharedDevice?: boolean;
}): Promise<ApiResult<{ success: boolean }>> {
  return invoke({
    action: "confirm",
    endpoint_ref: input.endpointRef,
    person_node_id: input.personNodeId,
    role: input.role ?? null,
    is_shared_device: input.isSharedDevice ?? false,
  });
}

export function rejectEndpoint(endpointRef: string): Promise<ApiResult<{ success: boolean }>> {
  return invoke({ action: "reject", endpoint_ref: endpointRef });
}
export function setEndpointUnknown(endpointRef: string): Promise<ApiResult<{ success: boolean }>> {
  return invoke({ action: "unknown", endpoint_ref: endpointRef });
}

// ── Onboarding + diagnostics + dashboard ────────────────────────────────────
export interface OnboardingState {
  provider: string;
  stage: string;
  stage_status: string;
  completion_pct: number;
  discovered_count: number;
  imported_count: number;
  confirmed_mappings: number;
  unresolved_mappings: number;
  accepted_gaps: boolean;
  last_error: string | null;
}
export interface OnboardingStateResult {
  state: OnboardingState | null;
  available_providers: Array<{ provider: string; label: string; authMode: string }>;
  capabilities: { label: string; capabilities: Record<string, CapabilityState> } | null;
}
export interface ConnectionCheck {
  name: string;
  ok: boolean;
  detail: string;
}
export interface DashboardMetrics {
  active_endpoints: number;
  confirmed_mappings: number;
  shared_devices: number;
  unresolved_endpoints: number;
  calls_processed: number;
  internal_resolved_calls: number;
  internal_resolution_rate: number;
}

async function onboardInvoke<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const { data, error } = await getSupabaseClient().functions.invoke("telephony-onboarding", {
    body,
  });
  if (error) return { ok: false, error: { code: "onboarding_error", message: error.message } };
  if (data && (data as { success?: boolean }).success === false) {
    const e = (data as { error?: { code?: string; message?: string } }).error;
    return { ok: false, error: { code: e?.code ?? "error", message: e?.message ?? "failed" } };
  }
  return { ok: true, data: data as T };
}

export const getOnboardingState = () => onboardInvoke<OnboardingStateResult>({ action: "state" });
export const runDiscovery = () =>
  onboardInvoke<{ discovered: number; imported: number; per_type?: DiscoverPerType[] }>({
    action: "discover",
  });
export const testConnection = () =>
  onboardInvoke<{ ok: boolean; checks: ConnectionCheck[] }>({ action: "test_connection" });
export const getDashboard = () =>
  onboardInvoke<{ metrics: DashboardMetrics }>({ action: "dashboard" });
export const completeOnboarding = (acceptedGaps: boolean) =>
  onboardInvoke<{ stage: string }>({ action: "complete", accepted_gaps: acceptedGaps });
export function deactivateEndpoint(endpointRef: string): Promise<ApiResult<{ success: boolean }>> {
  return invoke({ action: "deactivate", endpoint_ref: endpointRef });
}

// ── Provider connection wizard (adapter-driven, secure) ─────────────────────
export type AuthMode =
  | "oauth"
  | "api_key"
  | "account_credentials"
  | "sip_credentials"
  | "service_account"
  | "webhook_secret"
  | "manual"
  | "none";

export interface ConnectionFieldOption {
  value: string;
  label: string;
}
export interface ConnectionField {
  name: string;
  label: string;
  type: "text" | "secret" | "select" | "url" | "region" | "textarea" | "boolean";
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: ConnectionFieldOption[];
  validation?: { pattern?: string; minLength?: number; maxLength?: number; message?: string };
  autocomplete?: string;
  group?: string;
}
export interface ConnectionSpec {
  provider: string;
  label: string;
  description: string;
  iconKey: string;
  regions: string[];
  authMode: AuthMode;
  fields: ConnectionField[];
  oauth?: { supported: boolean; pkce: boolean; scopes: string[]; note?: string };
  webhook?: { required: boolean; inbound: boolean; secretField?: string; note?: string };
  ipAllowlist?: { required: boolean; addresses?: string[]; note?: string };
  accountRefField?: string;
  accountRefFormat?: string;
  helpText?: string;
  docsUrl?: string;
  manual: boolean;
  manualNote?: string;
}
export interface ProviderGalleryEntry {
  provider: string;
  label: string;
  authMode: string;
  description: string;
  iconKey: string;
  regions: string[];
  manual: boolean;
  oauthSupported: boolean;
  capabilities: { provider: string; label: string; capabilities: Record<string, CapabilityState> };
  devOnly: boolean;
}
export interface ConnectionStatus {
  provider: string;
  status: "not_configured" | "configured" | "manual" | "revoked" | "error";
  authMode: string | null;
  accountRef: string | null;
  configuredFields: string[];
  nonSecretConfig: Record<string, unknown>;
  verifiedAt: string | null;
  lastTest: unknown | null;
  updatedAt: string | null;
}
export interface DiscoverPerType {
  type: string;
  supported: boolean;
  count?: number;
  reason?: string;
}
export interface DiagnosticCheck {
  name: string;
  ok: boolean;
  detail: string;
  likely_cause: string | null;
  recommended_action: string | null;
}
export interface DiagnosticsResult {
  provider: string;
  connection_status: string;
  account_ref: string | null;
  ok: boolean;
  checks: DiagnosticCheck[];
  capabilities: { label: string; capabilities: Record<string, CapabilityState> };
  active_inventory: number;
  manual: boolean;
}
export interface ConnectionAuditEvent {
  event: string;
  actor_id: string | null;
  detail: unknown;
  created_at: string;
}
export interface SpecResult {
  provider: string;
  connection_spec: ConnectionSpec | null;
  capabilities: { label: string; capabilities: Record<string, CapabilityState> } | null;
  connection: ConnectionStatus;
}
export interface FieldError {
  field: string;
  message: string;
}

/** Raw invoke that preserves field_errors on validation failure. */
async function rawInvoke(body: Record<string, unknown>): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
  fieldErrors?: FieldError[];
}> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const { data, error } = await getSupabaseClient().functions.invoke("telephony-onboarding", {
    body,
  });
  if (error) return { ok: false, error: { code: "onboarding_error", message: error.message } };
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.success === false) {
    const e = (d.error ?? {}) as { code?: string; message?: string };
    return {
      ok: false,
      error: { code: e.code ?? "error", message: e.message ?? "failed" },
      fieldErrors: (d.field_errors as FieldError[]) ?? undefined,
    };
  }
  return { ok: true, data: d };
}

export const listProviders = (includeDev = false) =>
  onboardInvoke<{ providers: ProviderGalleryEntry[] }>({
    action: "providers",
    include_dev: includeDev,
  });
export const getProviderState = (provider: string, includeDev = false) =>
  onboardInvoke<
    OnboardingStateResult & { connection_spec: ConnectionSpec | null; connection: ConnectionStatus }
  >({ action: "state", provider, include_dev: includeDev });
export const getConnectionSpec = (provider: string) =>
  onboardInvoke<SpecResult>({ action: "spec", provider });
export const getConnectionStatus = (provider: string) =>
  onboardInvoke<SpecResult>({ action: "connection_status", provider });
export const configureConnection = (provider: string, values: Record<string, unknown>) =>
  rawInvoke({ action: "configure_connection", provider, values });
export const testProviderConnection = (provider: string) =>
  onboardInvoke<{ ok: boolean; checks: ConnectionCheck[] }>({
    action: "test_connection",
    provider,
  });
export const runProviderDiscovery = (provider: string) =>
  onboardInvoke<{ discovered: number; imported: number; per_type: DiscoverPerType[] }>({
    action: "discover",
    provider,
  });
export const getDiagnostics = (provider: string) =>
  onboardInvoke<DiagnosticsResult>({ action: "diagnostics", provider });
export const saveBehaviour = (
  provider: string,
  entries: Array<Record<string, unknown>>,
  config: Record<string, unknown>,
) => onboardInvoke<{ saved: number }>({ action: "behaviour", provider, entries, config });
export const disconnectProvider = (provider: string) =>
  onboardInvoke<{ connection: ConnectionStatus }>({ action: "disconnect", provider });
export const reconnectProvider = (provider: string) =>
  onboardInvoke<SpecResult>({ action: "reconnect", provider });
export const getConnectionAudit = (provider: string) =>
  onboardInvoke<{ events: ConnectionAuditEvent[] }>({ action: "audit", provider });
export const importExistingConnection = (provider: string) =>
  onboardInvoke<{ imported: boolean; connection?: ConnectionStatus; reason?: string }>({
    action: "import_existing",
    provider,
  });
export const startProviderOAuth = (
  provider: string,
  values: Record<string, unknown>,
  redirectUri: string,
) =>
  onboardInvoke<{ authorize_url: string; state: string }>({
    action: "oauth_start",
    provider,
    values,
    redirect_uri: redirectUri,
  });
export const reopenOnboarding = (provider: string, stage?: string) =>
  onboardInvoke<{ reopened: boolean }>({ action: "reopen", provider, stage });
export const completeProviderOnboarding = (provider: string, acceptedGaps: boolean) =>
  onboardInvoke<{ stage: string }>({ action: "complete", provider, accepted_gaps: acceptedGaps });
export const runTestCall = (provider: string, callId?: string) =>
  onboardInvoke<{ call?: string; steps: Record<string, boolean> }>({
    action: "test_call",
    provider,
    call_id: callId,
  });

/** Client-side mirror of the server validator (fast UX; server remains authoritative). */
export function validateFields(
  spec: ConnectionSpec,
  values: Record<string, string>,
  existingSecrets: string[] = [],
): FieldError[] {
  const errors: FieldError[] = [];
  for (const f of spec.fields) {
    const v = (values[f.name] ?? "").trim();
    if (f.required && !v) {
      if (f.secret && existingSecrets.includes(f.name)) continue;
      errors.push({ field: f.name, message: `${f.label} is required` });
      continue;
    }
    if (!v) continue;
    const rule = f.validation;
    if (rule) {
      if (rule.minLength && v.length < rule.minLength)
        errors.push({ field: f.name, message: rule.message ?? `${f.label} is too short` });
      else if (rule.maxLength && v.length > rule.maxLength)
        errors.push({ field: f.name, message: rule.message ?? `${f.label} is too long` });
      else if (rule.pattern) {
        try {
          if (!new RegExp(rule.pattern).test(v))
            errors.push({ field: f.name, message: rule.message ?? `${f.label} is invalid` });
        } catch {
          /* ignore bad pattern */
        }
      }
    }
    if ((f.type === "select" || f.type === "region") && f.options?.length) {
      if (!f.options.some((o) => o.value === v))
        errors.push({ field: f.name, message: `${f.label} must be one of the offered options` });
    }
  }
  return errors;
}
