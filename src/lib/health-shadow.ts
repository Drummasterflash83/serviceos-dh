/**
 * Customer Health — shadow surface client (Tenant-Superadmin only).
 *
 * Calls the `customer-health-shadow` Edge Function, which enforces the
 * tenant.superadmin grant server-side (RLS enforces it again at the data layer).
 * This is a SHADOW surface: it observes, explains and lets the superadmin review —
 * it never creates canonical operational work. Mirrors command-work.ts conventions.
 */
import { supabaseConfig, getAccessToken } from "./supabase";
import { apiFetch } from "./api";
import type { ApiResult } from "./types";

function fnUrl(name: string): string {
  return `${supabaseConfig.url}/functions/v1/${name}`;
}

async function invoke<T>(name: string, payload: unknown): Promise<ApiResult<T>> {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const token = await getAccessToken();
  if (!token)
    return { ok: false, error: { code: "missing_auth", message: "You must be signed in" } };
  const res = await apiFetch<{ ok: boolean; data?: T; error?: { code: string; message: string } }>(
    fnUrl(name),
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

// ── Surface types (mirror loadShadowSurface output). ────────────────────────
export interface HealthDriver {
  code: string;
  detail: string;
}
export interface HealthEvidence {
  source: string;
  detail: string;
}
export interface ShadowAssessment {
  id: string;
  state: string;
  trend: string | null;
  drivers: HealthDriver[];
  risks: string[];
  opportunities: string[];
  confidence: number | null;
  freshness: string | null;
  evidence: HealthEvidence[];
  changed: Record<string, unknown>;
  evaluated_at: string;
  supersedes_id: string | null;
}
export interface ShadowSource {
  id: string;
  source_kind: string;
  source_ref: string;
  role: string;
  excerpt: string | null;
  confidence: number | null;
  observed_at: string | null;
}
export interface ShadowDecision {
  id: string;
  decision: string;
  actor: string;
  from_state: string | null;
  to_state: string | null;
  reason: string | null;
  created_at: string;
  supersedes_id: string | null;
}
export interface ShadowProposal {
  id: string;
  commitment_type: string;
  proposed_title: string | null;
  proposed_outcome: string | null;
  proposed_done_when: string | null;
  proposed_due_at: string | null;
  proposed_accountable_ref: {
    responsibility?: string;
    source?: string;
    label?: string | null;
    explanation?: string;
  } | null;
  state: string;
  confidence: number | null;
  ambiguity: number | null;
  group_key: string;
  resolution_state: string;
  created_at: string;
  updated_at: string;
  sources: ShadowSource[];
  decisions: ShadowDecision[];
}
export interface ShadowObject {
  id: string;
  subject_type: string;
  subject_id: string;
  active_policy_version_id: string | null;
  accountable_ref: Record<string, unknown> | null;
  updated_at: string;
  latestAssessment: ShadowAssessment | null;
  assessmentHistory: ShadowAssessment[];
  proposals: ShadowProposal[];
}
export interface ShadowSurface {
  objects: ShadowObject[];
}

export type ReviewDecision =
  | "confirm"
  | "reject"
  | "correct"
  | "correct_responsibility"
  | "correct_due"
  | "attach"
  | "needs_context"
  | "defer"
  | "confirm_resolution"
  | "undo";

export interface ReviewPayload {
  proposal_id: string;
  decision: ReviewDecision;
  reason?: string;
  corrected_title?: string;
  corrected_outcome?: string;
  corrected_responsibility?: Record<string, unknown>;
  corrected_due_at?: string;
  attach_to_proposal_id?: string;
}

export function listShadow(): Promise<ApiResult<ShadowSurface>> {
  return invoke<ShadowSurface>("customer-health-shadow", { action: "list" });
}
export function reviewShadow(
  payload: ReviewPayload,
): Promise<ApiResult<{ decisionId: string; toState: string }>> {
  return invoke("customer-health-shadow", { action: "review", ...payload });
}
