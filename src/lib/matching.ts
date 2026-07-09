/**
 * Interaction match suggestions — tenant-scoped reads (RLS browser client).
 *
 * Matching is EVIDENCE-LED and never silently merges customer records. Every
 * suggestion carries a confidence score, the evidence used, an explanation and a
 * recommended action; a human (or a strong-evidence auto-linker later) resolves
 * it. This reader is read-only; suggestions are produced by service-role Edge
 * Functions in a future enrichment phase — until then it returns empty honestly.
 *
 * MATCHING RULES (documented; enforced by the future matcher, not here):
 *   Allowed evidence: exact email, exact phone, explicit external id, explicit
 *   user link, shared address, shared job number, shared invoice/quote number,
 *   shared product/part reference, repeated names, company name, conversation
 *   context, timing/proximity, similar issue description, same location, AI
 *   semantic similarity.
 *   Levels: confirmed | likely | possible | rejected.
 *   • confirmed → may auto-link ONLY on strong evidence
 *   • likely    → suggested to the user
 *   • possible  → suggestion only
 *   • rejected  → never re-suggested unless NEW evidence appears
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type MatchLevel = "confirmed" | "likely" | "possible" | "rejected";
export type MatchStatus = "pending" | "accepted" | "rejected" | "superseded";
export type MatchTargetType = "person" | "company" | "customer_card" | "interaction";

export interface MatchSuggestion {
  id: string;
  tenant_id: string;
  interaction_id: string;
  target_type: MatchTargetType | string;
  target_id: string | null;
  match_level: MatchLevel | string;
  confidence: number | null;
  /** Evidence signals used (email/phone/name/context/…). */
  evidence: Record<string, unknown>;
  explanation: string | null;
  recommended_action: string | null;
  status: MatchStatus | string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchFilter {
  status?: string;
  matchLevel?: string;
  interactionId?: string;
  limit?: number;
}

export interface MatchSummary {
  pending: number;
  confirmed: number;
  likely: number;
  possible: number;
}

const MATCH_COLUMNS =
  "id, tenant_id, interaction_id, target_type, target_id, match_level, confidence, evidence, explanation, recommended_action, status, created_by, created_at, updated_at";

function clampLimit(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 100;
  return Math.max(1, Math.min(500, n));
}

/** List match suggestions (RLS-scoped), newest first. */
export async function listMatchSuggestions(
  filter: MatchFilter = {},
): Promise<ApiResult<MatchSuggestion[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  let query = supabase
    .from("interaction_match_suggestions")
    .select(MATCH_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(clampLimit(filter.limit));
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.matchLevel) query = query.eq("match_level", filter.matchLevel);
  if (filter.interactionId) query = query.eq("interaction_id", filter.interactionId);

  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as MatchSuggestion[] };
}

/**
 * Suggested-match counts for the Operations Centre. ok:false
 * ("matches_unavailable") when unreadable; empty returns zeros (⇒ "no suggestions").
 */
export async function getMatchSummary(): Promise<ApiResult<MatchSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const head = { count: "exact" as const, head: true as const };
  const count = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  const probe = await supabase
    .from("interaction_match_suggestions")
    .select("*", head)
    .eq("status", "pending");
  if (probe.error) {
    return { ok: false, error: { code: "matches_unavailable", message: probe.error.message } };
  }

  const [confirmed, likely, possible] = await Promise.all([
    count(() =>
      supabase
        .from("interaction_match_suggestions")
        .select("*", head)
        .eq("status", "pending")
        .eq("match_level", "confirmed"),
    ),
    count(() =>
      supabase
        .from("interaction_match_suggestions")
        .select("*", head)
        .eq("status", "pending")
        .eq("match_level", "likely"),
    ),
    count(() =>
      supabase
        .from("interaction_match_suggestions")
        .select("*", head)
        .eq("status", "pending")
        .eq("match_level", "possible"),
    ),
  ]);

  return {
    ok: true,
    data: {
      pending: probe.count ?? 0,
      confirmed: confirmed ?? 0,
      likely: likely ?? 0,
      possible: possible ?? 0,
    },
  };
}
