/**
 * Recommendations — tenant-scoped reads (RLS browser client). The recommendation
 * engine's output: computed, explainable next-actions (customer waiting, repeat
 * contact, review new contact, …). Read-only in v1 — generated server-side by the
 * identity engine; NOT auto-executed. Honest empty/unavailable states, no fake data.
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export type RecommendationSeverity = "critical" | "high" | "medium" | "low" | "info";
export type RecommendationStatus = "open" | "resolved" | "actioned" | "dismissed" | "expired";

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
  /** When a time-bound action is due (Recommendation Engine v1); null otherwise. */
  due_at: string | null;
  /** Which deterministic rule produced/updated it (provenance). */
  source_rule: string | null;
  /** What happens if ignored. */
  impact: string | null;
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
  /** Open recommendations past their due_at. */
  overdue: number;
  /** Generated today (any status). */
  today: number;
  /** Resolved today. */
  closedToday: number;
  /** Most recent recommendation created_at. */
  latestGeneratedAt: string | null;
}

const REC_COLUMNS =
  "id, tenant_id, type, title, detail, severity, status, card_id, interaction_id, person_id, company_id, evidence, recommended_action, confidence, due_at, source_rule, impact, created_at, updated_at";

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
  const nowIso = new Date().toISOString();

  const [critical, high, overdue, today, closedToday, latest] = await Promise.all([
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
    count(() =>
      supabase
        .from("recommendations")
        .select("*", head)
        .eq("status", "open")
        .not("due_at", "is", null)
        .lt("due_at", nowIso),
    ),
    count(() => supabase.from("recommendations").select("*", head).gte("created_at", startToday)),
    count(() =>
      supabase
        .from("recommendations")
        .select("*", head)
        .eq("status", "resolved")
        .gte("resolved_at", startToday),
    ),
    supabase
      .from("recommendations")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    ok: true,
    data: {
      open: probe.count ?? 0,
      critical: critical ?? 0,
      high: high ?? 0,
      overdue: overdue ?? 0,
      today: today ?? 0,
      closedToday: closedToday ?? 0,
      latestGeneratedAt: (latest.data as { created_at: string } | null)?.created_at ?? null,
    },
  };
}

/**
 * Trigger a server-side recommendation run (Edge Function, service role). The
 * browser forwards the user's session; the function binds the tenant. Manual
 * "Generate" override — normal operation is automatic (scheduled after cards).
 */
export interface SyncRecommendationsResult {
  success: boolean;
  created: number;
  updated: number;
  closed: number;
  skipped: number;
  failed: number;
}

export async function syncRecommendations(
  limit = 200,
): Promise<ApiResult<SyncRecommendationsResult>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("recommendation-sync", {
    body: { limit },
  });
  if (error) {
    return { ok: false, error: { code: "recommendation_sync_failed", message: error.message } };
  }
  return { ok: true, data: data as SyncRecommendationsResult };
}
