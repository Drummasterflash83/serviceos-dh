/**
 * Recommendations — tenant-scoped reads (RLS browser client). The recommendation
 * engine's output: computed, explainable next-actions (customer waiting, repeat
 * contact, review new contact, …). Read-only in v1 — generated server-side by the
 * identity engine; NOT auto-executed. Honest empty/unavailable states, no fake data.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type RecommendationSeverity = "critical" | "high" | "medium" | "low" | "info";
export type RecommendationStatus = "open" | "actioned" | "dismissed" | "expired";

export interface Recommendation {
  id: string;
  tenant_id: string;
  type: string;
  title: string;
  detail: string | null;
  severity: RecommendationSeverity | string;
  status: RecommendationStatus | string;
  card_id: string | null;
  interaction_id: string | null;
  person_id: string | null;
  company_id: string | null;
  evidence: unknown[];
  recommended_action: string | null;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

export interface RecommendationFilter {
  status?: string;
  severity?: string;
  cardId?: string;
  limit?: number;
}

export interface RecommendationSummary {
  open: number;
  critical: number;
  high: number;
  today: number;
}

const REC_COLUMNS =
  "id, tenant_id, type, title, detail, severity, status, card_id, interaction_id, person_id, company_id, evidence, recommended_action, confidence, created_at, updated_at";

function clampLimit(v: number | undefined): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 100;
  return Math.max(1, Math.min(500, n));
}

export async function listRecommendations(
  filter: RecommendationFilter = {},
): Promise<ApiResult<Recommendation[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  let query = supabase
    .from("recommendations")
    .select(REC_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(clampLimit(filter.limit));
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.severity) query = query.eq("severity", filter.severity);
  if (filter.cardId) query = query.eq("card_id", filter.cardId);

  const { data, error } = await query;
  if (error) return { ok: false, error: { code: "query_error", message: error.message } };
  return { ok: true, data: (data ?? []) as Recommendation[] };
}

export async function getRecommendationSummary(): Promise<ApiResult<RecommendationSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const startToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const head = { count: "exact" as const, head: true as const };
  const count = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  const probe = await supabase.from("recommendations").select("*", head).eq("status", "open");
  if (probe.error) {
    return {
      ok: false,
      error: { code: "recommendations_unavailable", message: probe.error.message },
    };
  }

  const [critical, high, today] = await Promise.all([
    count(() =>
      supabase
        .from("recommendations")
        .select("*", head)
        .eq("status", "open")
        .eq("severity", "critical"),
    ),
    count(() =>
      supabase
        .from("recommendations")
        .select("*", head)
        .eq("status", "open")
        .eq("severity", "high"),
    ),
    count(() => supabase.from("recommendations").select("*", head).gte("created_at", startToday)),
  ]);

  return {
    ok: true,
    data: { open: probe.count ?? 0, critical: critical ?? 0, high: high ?? 0, today: today ?? 0 },
  };
}
