/**
 * Command Centre ownership seam — tenant client for the DERIVED ownership projection.
 *
 * Calls the tenant-gated `ownership-projection` Edge Function, which returns ONLY the
 * operational projection (accountable/handler/cover/escalation/explanation/confidence/
 * unresolved reason/warnings) — never raw Control Plane tables. The Command Centre shows
 * these truthfully: a classifier name is never promoted to a confirmed owner.
 */
import { supabaseConfig, getAccessToken } from "./supabase";
import { apiFetch } from "./api";
import type { ApiResult } from "./types";

export type OwnershipStatus = "resolved" | "team_role_fallback" | "unresolved" | "unmapped";
export interface DerivedOwner {
  kind: string;
  label: string | null;
}
export interface DerivedOwnership {
  status: OwnershipStatus;
  accountable: DerivedOwner | null;
  likelyHandler: DerivedOwner | null;
  cover: DerivedOwner | null;
  escalation: DerivedOwner | null;
  explanation: string;
  confidence: number;
  historicalAssignmentRef: string | null;
  unresolvedReason: string | null;
  warnings: string[];
  needsConfiguration: boolean;
}

export interface EndpointEvidence {
  channel: string;
  provider?: string | null;
  providerExternalRef?: string | null;
  normalizedValue?: string | null;
  ddi?: string | null;
  extension?: string | null;
  queue?: string | null;
  ringGroup?: string | null;
  requestedName?: string | null;
}

export async function resolveOwnership(
  evidence: EndpointEvidence,
  opts: { nowMs?: number; subjectRef?: string | null } = {},
): Promise<ApiResult<DerivedOwnership>> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const token = await getAccessToken();
  if (!token)
    return { ok: false, error: { code: "missing_auth", message: "You must be signed in" } };
  const res = await apiFetch<{
    ok: boolean;
    data?: DerivedOwnership;
    error?: { code: string; message: string };
  }>(`${supabaseConfig.url}/functions/v1/ownership-projection`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "resolve",
      evidence,
      now_ms: opts.nowMs,
      subject_ref: opts.subjectRef ?? null,
    }),
  });
  if (!res.ok) return res;
  if (!res.data?.ok)
    return { ok: false, error: res.data?.error ?? { code: "unknown", message: "request failed" } };
  return { ok: true, data: res.data.data as DerivedOwnership };
}
