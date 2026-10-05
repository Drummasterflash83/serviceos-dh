import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export interface LearningEvent {
  id: string;
  kind: string;
  at: string;
  label: string;
}
export interface LearningSnapshot {
  pending: number;
  enriched: number;
  oldestPendingAt: string | null;
  events: LearningEvent[];
}

export async function getLearningSnapshot(): Promise<ApiResult<LearningSnapshot>> {
  if (!isSupabaseConfigured())
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  const db = getSupabaseClient();
  const head = { count: "exact" as const, head: true as const };
  const [pending, enriched, oldest, interactions, intelligence, recommendations, graph] =
    await Promise.all([
      db.from("interactions").select("*", head).eq("processing_status", "pending"),
      db.from("interactions").select("*", head).eq("processing_status", "enriched"),
      db
        .from("interactions")
        .select("occurred_at")
        .eq("processing_status", "pending")
        .order("occurred_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from("interactions")
        .select("id, interaction_type, processing_status, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(12),
      db
        .from("intelligence_objects")
        .select("id, object_type, created_at")
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("recommendations")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(12),
      db
        .from("graph_events")
        .select("id, event_type, created_at")
        .order("created_at", { ascending: false })
        .limit(12),
    ]);
  if (pending.error)
    return { ok: false, error: { code: "learning_unavailable", message: pending.error.message } };
  const events: LearningEvent[] = [];
  for (const r of interactions.data ?? [])
    events.push({
      id: `i-${r.id}`,
      kind: "Interaction",
      at: r.occurred_at,
      label: `${r.interaction_type} · ${r.processing_status}`,
    });
  for (const r of intelligence.data ?? [])
    events.push({
      id: `o-${r.id}`,
      kind: "Intelligence",
      at: r.created_at,
      label: `${r.object_type} produced`,
    });
  for (const r of recommendations.data ?? [])
    events.push({
      id: `r-${r.id}`,
      kind: "Recommendation",
      at: r.created_at,
      label: r.title || "Recommendation created",
    });
  for (const r of graph.data ?? [])
    events.push({ id: `g-${r.id}`, kind: "Knowledge", at: r.created_at, label: r.event_type });
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return {
    ok: true,
    data: {
      pending: pending.count ?? 0,
      enriched: enriched.count ?? 0,
      oldestPendingAt: (oldest.data as { occurred_at?: string } | null)?.occurred_at ?? null,
      events: events.slice(0, 30),
    },
  };
}
