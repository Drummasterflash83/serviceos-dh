// ServiceOS — Edge Function: business-graph-sync (Business Graph v1)
//
// Projects the existing system-of-record tables (people, companies,
// customer_cards, interactions, recommendations) into the Business Graph
// (graph_nodes / graph_edges / graph_events). It is ADDITIVE and IDEMPOTENT: the
// source tables are never modified, and re-running converges (upserts keyed by
// source row / edge triple) instead of duplicating. Only REAL foreign-key links
// become edges — no fabricated relationships.
//
// Auth: a user session (owner/admin/ops) OR the internal service path (the
// identity subscriber / scheduler). Tenant is bound server-side; the browser can
// never spoof it. No secrets logged; no transcript/audio stored in the graph.
//
// Request body: { source?: "interaction" | "identity" | "all", limit?: number }
// Returns: { success, nodes_upserted, edges_upserted, events_published, skipped,
//            failed, nodes_created, edges_created, by_type, avg_confidence }
//
// Runtime: Supabase Edge Functions (Deno). No new dependencies.

import {
  corsHeaders,
  createSupabaseAdmin,
  failResponse,
  jsonResponse,
} from "../_shared/simwood.ts";
import { assertSameTenant, requireTenantUser } from "../_shared/authz.ts";
import {
  completePlatformJob,
  createPlatformJob,
  failPlatformJob,
  startPlatformJob,
} from "../_shared/platform_jobs.ts";
import {
  graphNodeLabelForSource,
  publishGraphEvent,
  upsertGraphEdge,
  upsertGraphNode,
} from "../_shared/business_graph.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function clampLimit(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

type Row = Record<string, unknown>;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return failResponse("method_not_allowed", "Use POST", 405);

  let body: { source?: unknown; limit?: unknown; tenant_id?: unknown } = {};
  try {
    body = ((await req.json()) ?? {}) as typeof body;
  } catch {
    body = {};
  }
  const source = body.source === "interaction" || body.source === "identity" ? body.source : "all";
  const limit = clampLimit(body.limit);

  const admin = createSupabaseAdmin();
  if (!admin) return failResponse("config_error", "Supabase admin client is not configured", 500);

  const auth = await requireTenantUser(req, admin, ["owner", "admin", "ops"]);
  if (!auth.ok) return failResponse(auth.error.code, auth.error.message, auth.error.httpStatus);
  const mismatch = assertSameTenant(auth.ctx, body.tenant_id);
  if (mismatch) return failResponse(mismatch.code, mismatch.message, mismatch.httpStatus);
  const tenantId = auth.ctx.tenantId;

  const wantIdentity = source === "identity" || source === "all";
  const wantInteractions = source === "interaction" || source === "all";

  const job = await createPlatformJob(admin, {
    tenantId,
    connectorId: "openfolk-core",
    moduleId: "core.graph",
    jobType: "graph.sync",
    jobKey: `graph.sync:${tenantId}`,
    payload: { source, limit },
    createdBy: auth.ctx.userId !== "service" ? auth.ctx.userId : null,
  });
  const jobId = job.duplicate ? null : job.id;
  if (jobId) await startPlatformJob(admin, jobId);

  // Counters ----------------------------------------------------------------
  let nodesUpserted = 0;
  let nodesCreated = 0;
  let edgesUpserted = 0;
  let edgesCreated = 0;
  let skipped = 0;
  let failed = 0;
  let confSum = 0;
  let confCount = 0;
  const byType: Record<string, number> = {};

  // In-run source_id → graph node id maps (per type).
  const personNode = new Map<string, string>();
  const companyNode = new Map<string, string>();
  const cardNode = new Map<string, string>();
  const interactionNode = new Map<string, string>();
  const recommendationNode = new Map<string, string>();
  // Derived lookups from real FKs.
  const cardByPerson = new Map<string, string>(); // person source id → card node id

  async function node(
    map: Map<string, string>,
    nodeType: string,
    sourceTable: string,
    row: Row,
    confidence: number | null,
    properties: Record<string, unknown>,
  ): Promise<void> {
    const sid = row.id as string | undefined;
    if (!sid) return;
    const handle = await upsertGraphNode(admin, {
      tenantId,
      nodeType,
      sourceTable,
      sourceId: sid,
      label: graphNodeLabelForSource(nodeType, row),
      confidence,
      properties,
    });
    if (handle.id) {
      map.set(sid, handle.id);
      nodesUpserted += 1;
      if (handle.created) nodesCreated += 1;
      byType[nodeType] = (byType[nodeType] ?? 0) + 1;
    } else {
      failed += 1;
    }
  }

  async function edge(
    edgeType: string,
    fromId: string | undefined,
    toId: string | undefined,
    confidence: number,
    evidence: unknown[],
  ): Promise<void> {
    if (!fromId || !toId) {
      skipped += 1;
      return;
    }
    const handle = await upsertGraphEdge(admin, {
      tenantId,
      edgeType,
      fromNodeId: fromId,
      toNodeId: toId,
      confidence,
      evidence,
    });
    if (handle.id) {
      edgesUpserted += 1;
      if (handle.created) edgesCreated += 1;
      confSum += confidence;
      confCount += 1;
    } else {
      // Not a hard failure — usually a self-loop or a benign race; count skipped.
      skipped += 1;
    }
  }

  try {
    // ── Nodes ──────────────────────────────────────────────────────────────
    if (wantIdentity) {
      const { data: companies } = await admin
        .from("companies")
        .select("id, name, domain")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      for (const c of (companies ?? []) as Row[]) {
        await node(companyNode, "company", "companies", c, null, {
          domain: (c.domain as string | null) ?? null,
        });
      }

      const { data: people } = await admin
        .from("people")
        .select("id, display_name, first_name, last_name, primary_email, primary_phone, company_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      for (const p of (people ?? []) as Row[]) {
        // Minimal, non-PII properties (raw email/phone are NOT stored in the graph).
        await node(personNode, "person", "people", p, null, {
          has_email: Boolean(p.primary_email),
          has_phone: Boolean(p.primary_phone),
        });
      }

      const { data: cards } = await admin
        .from("customer_cards")
        .select("id, person_id, company_id, title, status, priority")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      for (const c of (cards ?? []) as Row[]) {
        await node(cardNode, "customer_card", "customer_cards", c, null, {
          status: (c.status as string | null) ?? null,
          priority: (c.priority as string | null) ?? null,
        });
        const pid = c.person_id as string | null;
        const cardNodeId = cardNode.get(c.id as string);
        if (pid && cardNodeId) cardByPerson.set(pid, cardNodeId);
      }

      const { data: recs } = await admin
        .from("recommendations")
        .select("id, type, title, severity, status, card_id, interaction_id")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(limit);
      for (const r of (recs ?? []) as Row[]) {
        await node(recommendationNode, "recommendation", "recommendations", r, null, {
          type: (r.type as string | null) ?? null,
          severity: (r.severity as string | null) ?? null,
          status: (r.status as string | null) ?? null,
        });
      }

      // Identity edges (all direct FKs → confidence 1.0).
      for (const p of (people ?? []) as Row[]) {
        const cid = p.company_id as string | null;
        if (cid) {
          await edge("works_for", personNode.get(p.id as string), companyNode.get(cid), 1, [
            { source: "people.company_id", detail: "person is linked to a company" },
          ]);
        }
      }
      for (const c of (cards ?? []) as Row[]) {
        const cardId = cardNode.get(c.id as string);
        const pid = c.person_id as string | null;
        const coid = c.company_id as string | null;
        if (pid)
          await edge("represents", cardId, personNode.get(pid), 1, [
            { source: "customer_cards.person_id", detail: "card represents a person" },
          ]);
        if (coid)
          await edge("represents", cardId, companyNode.get(coid), 1, [
            { source: "customer_cards.company_id", detail: "card represents a company" },
          ]);
      }
      for (const r of (recs ?? []) as Row[]) {
        const recId = recommendationNode.get(r.id as string);
        const cardId = r.card_id as string | null;
        if (cardId)
          await edge("concerns", recId, cardNode.get(cardId), 1, [
            { source: "recommendations.card_id", detail: "recommendation concerns a card" },
          ]);
      }
    }

    if (wantInteractions) {
      const { data: interactions } = await admin
        .from("interactions")
        .select(
          "id, interaction_type, occurred_at, processing_status, source_connector_id, related_person_id, related_company_id",
        )
        .eq("tenant_id", tenantId)
        .in("processing_status", ["ready", "enriched"])
        .order("occurred_at", { ascending: false })
        .limit(limit);

      for (const i of (interactions ?? []) as Row[]) {
        await node(interactionNode, "interaction", "interactions", i, null, {
          interaction_type: (i.interaction_type as string | null) ?? null,
          occurred_at: (i.occurred_at as string | null) ?? null,
          processing_status: (i.processing_status as string | null) ?? null,
          source_connector_id: (i.source_connector_id as string | null) ?? null,
        });
      }

      // Interaction edges. person/company use the in-run identity maps when 'all';
      // for source='interaction' a missing endpoint is counted as skipped (never
      // fabricated).
      for (const i of (interactions ?? []) as Row[]) {
        const iid = interactionNode.get(i.id as string);
        const pid = i.related_person_id as string | null;
        const coid = i.related_company_id as string | null;
        if (pid) {
          await edge("contacted", iid, personNode.get(pid), 1, [
            { source: "interactions.related_person_id", detail: "call linked to a person" },
          ]);
          // Inferred: the call relates to that person's card (shared person).
          const cardId = cardByPerson.get(pid);
          if (cardId)
            await edge("relates_to", iid, cardId, 0.9, [
              {
                source: "interactions.related_person_id → customer_cards.person_id",
                detail: "call relates to the person's card",
              },
            ]);
        }
        if (coid)
          await edge("relates_to", iid, companyNode.get(coid), 1, [
            { source: "interactions.related_company_id", detail: "call linked to a company" },
          ]);
      }
    }

    const avgConfidence = confCount > 0 ? Math.round((confSum / confCount) * 1000) / 1000 : null;

    // ── graph.enriched event (bounded — one per sync, not per node) ─────────
    const eventId = await publishGraphEvent(admin, {
      tenantId,
      eventType: "graph.enriched",
      payload: {
        source,
        nodes_upserted: nodesUpserted,
        nodes_created: nodesCreated,
        edges_upserted: edgesUpserted,
        edges_created: edgesCreated,
        skipped,
        failed,
        avg_confidence: avgConfidence,
        by_type: byType,
      },
    });
    const eventsPublished = eventId ? 1 : 0;

    if (jobId) {
      await completePlatformJob(admin, jobId, {
        recordsProcessed: nodesUpserted + edgesUpserted,
        result: {
          nodes_upserted: nodesUpserted,
          edges_upserted: edgesUpserted,
          events_published: eventsPublished,
          skipped,
          failed,
        },
      });
    }

    return jsonResponse({
      success: failed === 0,
      nodes_upserted: nodesUpserted,
      edges_upserted: edgesUpserted,
      events_published: eventsPublished,
      skipped,
      failed,
      nodes_created: nodesCreated,
      edges_created: edgesCreated,
      by_type: byType,
      avg_confidence: avgConfidence,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "business-graph-sync failed";
    if (jobId) await failPlatformJob(admin, jobId, message);
    return failResponse("graph_sync_error", message, 500);
  }
});
