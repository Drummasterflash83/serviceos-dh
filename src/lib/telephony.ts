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
export function deactivateEndpoint(endpointRef: string): Promise<ApiResult<{ success: boolean }>> {
  return invoke({ action: "deactivate", endpoint_ref: endpointRef });
}
