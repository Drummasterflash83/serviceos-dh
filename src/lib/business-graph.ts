/**
 * Business Graph — tenant-scoped browser reads (RLS) + the build trigger.
 *
 * Reads use the signed-in user's Supabase client, so every query is filtered to
 * the caller's tenant by the graph_* SELECT policies (Security-2 model). NO
 * service role in the browser. The build trigger invokes the `business-graph-sync`
 * Edge Function, which binds the tenant server-side. Honest states only: when the
 * graph tables can't be read the summary returns ok:false (never a fake zero).
 */

import { getSupabaseClient, isSupabaseConfigured } from "./supabase";
import type { ApiResult } from "./types";

export interface GraphNode {
  id: string;
  node_type: string;
  label: string | null;
  confidence: number | null;
  created_at: string;
}

export interface GraphEdge {
  id: string;
  edge_type: string;
  from_node_id: string;
  to_node_id: string;
  confidence: number | null;
  created_at: string;
}

export interface GraphEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface GraphSummary {
  totalNodes: number;
  totalEdges: number;
  people: number;
  companies: number;
  interactions: number;
  cards: number;
  recommendations: number;
  latestEvent: GraphEvent | null;
  /** Average edge confidence from the latest graph.enriched run (server-computed). */
  avgConfidence: number | null;
}

export interface SyncBusinessGraphResult {
  success: boolean;
  nodes_upserted: number;
  edges_upserted: number;
  events_published: number;
  skipped: number;
  failed: number;
  nodes_created: number;
  edges_created: number;
  avg_confidence: number | null;
}

export async function getBusinessGraphSummary(): Promise<ApiResult<GraphSummary>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const head = { count: "exact" as const, head: true as const };

  const cnt = (build: () => PromiseLike<{ count: number | null; error: unknown }>) =>
    build().then((r) => (r.error ? null : (r.count ?? 0)));

  // Probe nodes first — distinguishes "unavailable" (tables/RLS) from "empty".
  const probe = await supabase.from("graph_nodes").select("*", head);
  if (probe.error) {
    return { ok: false, error: { code: "graph_unavailable", message: probe.error.message } };
  }
  const totalNodes = probe.count ?? 0;

  const nodeCount = (nodeType: string) =>
    cnt(() => supabase.from("graph_nodes").select("*", head).eq("node_type", nodeType));

  const [totalEdges, people, companies, interactions, cards, recommendations, latest] =
    await Promise.all([
      cnt(() => supabase.from("graph_edges").select("*", head)),
      nodeCount("person"),
      nodeCount("company"),
      nodeCount("interaction"),
      nodeCount("customer_card"),
      nodeCount("recommendation"),
      supabase
        .from("graph_events")
        .select("id, event_type, payload, created_at")
        .eq("event_type", "graph.enriched")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const latestRow = (latest.data as GraphEvent | null) ?? null;
  const payload = (latestRow?.payload ?? {}) as Record<string, unknown>;
  const avg = payload.avg_confidence;
  const avgConfidence = typeof avg === "number" ? avg : null;

  return {
    ok: true,
    data: {
      totalNodes,
      totalEdges: totalEdges ?? 0,
      people: people ?? 0,
      companies: companies ?? 0,
      interactions: interactions ?? 0,
      cards: cards ?? 0,
      recommendations: recommendations ?? 0,
      latestEvent: latestRow,
      avgConfidence,
    },
  };
}

export async function listGraphNodes(limit = 20): Promise<ApiResult<GraphNode[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_nodes")
    .select("id, node_type, label, confidence, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) return { ok: false, error: { code: "graph_unavailable", message: error.message } };
  return { ok: true, data: (data ?? []) as GraphNode[] };
}

export async function listGraphEdges(limit = 20): Promise<ApiResult<GraphEdge[]>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("graph_edges")
    .select("id, edge_type, from_node_id, to_node_id, confidence, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) return { ok: false, error: { code: "graph_unavailable", message: error.message } };
  return { ok: true, data: (data ?? []) as GraphEdge[] };
}

/**
 * Trigger a server-side graph projection (Edge Function, service role). The
 * browser forwards the signed-in user's session; the function binds the tenant.
 * This is the manual "Build graph" override — normal operation is automatic
 * (identity trigger + scheduled sync).
 */
export async function syncBusinessGraph(
  source: "interaction" | "identity" | "all" = "all",
  limit = 200,
): Promise<ApiResult<SyncBusinessGraphResult>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: { code: "config_error", message: "Supabase is not configured" } };
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("business-graph-sync", {
    body: { source, limit },
  });
  if (error) {
    return { ok: false, error: { code: "graph_sync_failed", message: error.message } };
  }
  return { ok: true, data: data as SyncBusinessGraphResult };
}
