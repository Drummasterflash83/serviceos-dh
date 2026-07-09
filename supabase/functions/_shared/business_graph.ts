// ServiceOS — shared Business Graph helper (Deno, service-role).
//
// The one place Edge Functions write nodes/edges/events into the Business Graph
// (see migration 20260709160000_business_graph.sql). Like the platform_jobs /
// events helpers it is BEST-EFFORT and tenant-bound: a graph write must never
// fabricate certainty and (unless a caller opts in) never throw in a way that
// breaks an upstream pipeline. All writes are idempotent so re-running a sync
// converges instead of duplicating.
//
// Security: always requires an explicit tenant_id; never stores secrets or full
// transcript/audio in properties/evidence; both endpoints of an edge are written
// under the same tenant_id (no cross-tenant links). Uses a service-role client
// (writes bypass RLS).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type NodeType = "person" | "company" | "customer_card" | "interaction" | "recommendation";

export interface UpsertNodeInput {
  tenantId: string;
  nodeType: string;
  sourceTable: string;
  sourceId: string;
  externalRef?: string | null;
  label?: string | null;
  confidence?: number | null;
  properties?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface NodeHandle {
  id: string | null;
  created: boolean;
}

/**
 * Idempotent node upsert keyed on (tenant, node_type, source_table, source_id).
 * Uses select-then-write (the uniqueness index is PARTIAL — `where source_id is
 * not null` — which PostgREST's onConflict cannot target). Never throws; returns
 * { id: null } only if the write truly failed.
 */
export async function upsertGraphNode(
  client: SupabaseClient,
  input: UpsertNodeInput,
): Promise<NodeHandle> {
  if (!input.tenantId || !input.nodeType || !input.sourceTable || !input.sourceId) {
    return { id: null, created: false };
  }
  const patch = {
    label: input.label ?? null,
    external_ref: input.externalRef ?? null,
    confidence: input.confidence ?? null,
    properties: input.properties ?? {},
    metadata: input.metadata ?? {},
  };
  try {
    const { data: existing } = await client
      .from("graph_nodes")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("node_type", input.nodeType)
      .eq("source_table", input.sourceTable)
      .eq("source_id", input.sourceId)
      .maybeSingle();
    if (existing?.id) {
      await client
        .from("graph_nodes")
        .update(patch)
        .eq("id", existing.id as string);
      return { id: existing.id as string, created: false };
    }
    const { data, error } = await client
      .from("graph_nodes")
      .insert({
        tenant_id: input.tenantId,
        node_type: input.nodeType,
        source_table: input.sourceTable,
        source_id: input.sourceId,
        ...patch,
      })
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string, created: true };
    // Lost an insert race → the row now exists; re-select it.
    if (error && (error as { code?: string }).code === "23505") {
      const { data: raced } = await client
        .from("graph_nodes")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("node_type", input.nodeType)
        .eq("source_table", input.sourceTable)
        .eq("source_id", input.sourceId)
        .maybeSingle();
      return { id: (raced?.id as string | undefined) ?? null, created: false };
    }
    return { id: null, created: false };
  } catch {
    return { id: null, created: false };
  }
}

export interface UpsertEdgeInput {
  tenantId: string;
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
  confidence?: number | null;
  evidence?: unknown[];
  properties?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Idempotent edge upsert keyed on (tenant, edge_type, from, to). No self-loops.
 * Never throws. Returns { id: null } on failure/skip.
 */
export async function upsertGraphEdge(
  client: SupabaseClient,
  input: UpsertEdgeInput,
): Promise<NodeHandle> {
  if (
    !input.tenantId ||
    !input.edgeType ||
    !input.fromNodeId ||
    !input.toNodeId ||
    input.fromNodeId === input.toNodeId
  ) {
    return { id: null, created: false };
  }
  try {
    const { data: existing } = await client
      .from("graph_edges")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("edge_type", input.edgeType)
      .eq("from_node_id", input.fromNodeId)
      .eq("to_node_id", input.toNodeId)
      .maybeSingle();
    const patch = {
      confidence: input.confidence ?? null,
      evidence: safeEvidence(input.evidence ?? []),
      properties: input.properties ?? {},
      metadata: input.metadata ?? {},
    };
    if (existing?.id) {
      await client
        .from("graph_edges")
        .update(patch)
        .eq("id", existing.id as string);
      return { id: existing.id as string, created: false };
    }
    const { data, error } = await client
      .from("graph_edges")
      .insert({
        tenant_id: input.tenantId,
        edge_type: input.edgeType,
        from_node_id: input.fromNodeId,
        to_node_id: input.toNodeId,
        ...patch,
      })
      .select("id")
      .single();
    if (!error && data) return { id: data.id as string, created: true };
    if (error && (error as { code?: string }).code === "23505") {
      return { id: null, created: false };
    }
    return { id: null, created: false };
  } catch {
    return { id: null, created: false };
  }
}

export interface PublishGraphEventInput {
  tenantId: string;
  eventType: string; // node.created | edge.created | graph.enriched | graph.conflict_detected | …
  nodeId?: string | null;
  edgeId?: string | null;
  sourceEventId?: string | null;
  payload?: Record<string, unknown>;
}

/** Append a graph event. Best-effort; never throws. */
export async function publishGraphEvent(
  client: SupabaseClient,
  input: PublishGraphEventInput,
): Promise<string | null> {
  if (!input.tenantId || !input.eventType) return null;
  try {
    const { data } = await client
      .from("graph_events")
      .insert({
        tenant_id: input.tenantId,
        event_type: input.eventType,
        node_id: input.nodeId ?? null,
        edge_id: input.edgeId ?? null,
        source_event_id: input.sourceEventId ?? null,
        payload: input.payload ?? {},
      })
      .select("id")
      .single();
    return (data?.id as string | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Ensure a graph node exists for a system-of-record row and return its id — a
 * thin, intention-revealing wrapper over upsertGraphNode for the projection
 * builder. Returns null when the node could not be materialised.
 */
export async function linkSourceRecordToNode(
  client: SupabaseClient,
  input: UpsertNodeInput,
): Promise<string | null> {
  const handle = await upsertGraphNode(client, input);
  return handle.id;
}

/** Build a short, human, NON-secret label for a source row. */
export function graphNodeLabelForSource(
  nodeType: string,
  row: Record<string, unknown>,
): string | null {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  switch (nodeType) {
    case "person":
      return (
        (str(row.display_name) ??
          [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ")) ||
        str(row.primary_email) ||
        str(row.primary_phone) ||
        "Person"
      );
    case "company":
      return str(row.name) ?? str(row.domain) ?? "Company";
    case "customer_card":
      return str(row.title) ?? "Customer card";
    case "interaction": {
      const type = str(row.interaction_type) ?? "interaction";
      const when = str(row.occurred_at);
      return when ? `${type} · ${when.slice(0, 10)}` : type;
    }
    case "recommendation":
      return str(row.title) ?? str(row.type) ?? "Recommendation";
    default:
      return null;
  }
}

/**
 * Sanitise an evidence array before storage: keep only small, structured,
 * NON-secret hints (source column + short detail). Drops anything long enough to
 * risk carrying transcript/audio/PII content and caps the array. Never throws.
 */
export function safeEvidence(items: unknown[]): unknown[] {
  if (!Array.isArray(items)) return [];
  const out: unknown[] = [];
  for (const item of items.slice(0, 12)) {
    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const source = typeof obj.source === "string" ? obj.source.slice(0, 120) : null;
      const detail = typeof obj.detail === "string" ? obj.detail.slice(0, 200) : null;
      out.push({ source, detail });
    } else if (typeof item === "string") {
      out.push({ source: null, detail: item.slice(0, 200) });
    }
  }
  return out;
}

/**
 * Fire-and-forget: ask business-graph-sync to project this tenant's graph. Used
 * by subscribers (e.g. identity-resolve) so enrichment flows into the graph
 * promptly WITHOUT the caller depending on the graph. Always internal
 * service-role. Never throws; continues past the response via
 * EdgeRuntime.waitUntil when available.
 */
export function triggerGraphSyncBackground(tenantId: string): void {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !tenantId) return;
  const p = fetch(`${url}/functions/v1/business-graph-sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
      apikey: key,
      "x-internal-tenant-id": tenantId,
    },
    body: JSON.stringify({ tenant_id: tenantId, source: "all" }),
  })
    .then(() => {})
    .catch(() => {});
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (pr: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(p);
}
