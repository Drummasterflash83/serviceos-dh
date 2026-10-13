// ServiceOS — Worker handler: customer_card.sync (graph → projection).
// Pure business logic — moved verbatim from customer-card-sync/index.ts. Auth,
// CORS and the platform_jobs lifecycle live in the caller (Edge wrapper OR the
// platform-worker), which share this ONE copy. Tenant is always caller-validated.

import { isUuid } from "../simwood.ts";
import {
  computeActivityScore,
  computeHealth,
  healthToCardStatus,
  humanizeInteraction,
  interactionTrend,
  responsiveness,
  type Health,
} from "../customer_card.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_contract.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const TIMELINE_MAX = 10;
// Keep URLs bounded at MAX_LIMIT; the doubled 200-UUID graph filter exceeds
// the production gateway's request-target limit.
const ID_BATCH = 40;
const EDGE_PAGE = 500;
function batches<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < values.length; i += ID_BATCH) result.push(values.slice(i, i + ID_BATCH));
  return result;
}
const URGENT_SEVERITY = new Set(["high", "critical", "emergency", "urgent"]);

type Row = Record<string, unknown>;

function clampLimit(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

function daysBetween(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, (nowMs - t) / 86_400_000);
}

export async function handleCustomerCardSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: admin, tenantId, payload } = ctx;
  const limit = clampLimit(payload.limit);
  const nowMs = Date.now();
  // A full-coverage sweep uses a STABLE cursor (sweep_since) carried across the
  // self-continuation chain, so each batch takes the oldest-refreshed cards and the
  // sweep drains ALL of them exactly once, then stops — instead of repeatedly
  // reprojecting the same most-active subset and never reaching stale cards.
  const sweepSince =
    (typeof payload.sweep_since === "string" && payload.sweep_since) || new Date().toISOString();
  let isSweep = false;

  try {
    // ── Resolve the target card set ─────────────────────────────────────────
    let cardQuery = admin
      .from("customer_cards")
      .select(
        "id, person_id, company_id, title, status, priority, confidence, due_at, completed_at, locked_fields, context, updated_at",
      )
      .eq("tenant_id", tenantId);

    if (isUuid(payload.customer_card_id)) {
      cardQuery = cardQuery.eq("id", payload.customer_card_id as string);
    } else if (isUuid(payload.graph_node_id)) {
      // Resolve the graph node → its source person → the card for that person.
      const { data: gnode, error: graphTargetError } = await admin
        .from("graph_nodes")
        .select("node_type, source_id")
        .eq("tenant_id", tenantId)
        .eq("id", payload.graph_node_id as string)
        .maybeSingle();
      if (graphTargetError) throw new Error("graph_target_unavailable");
      const sid = (gnode?.source_id as string | null) ?? null;
      if (gnode?.node_type === "person" && sid) cardQuery = cardQuery.eq("person_id", sid);
      else if (gnode?.node_type === "company" && sid) cardQuery = cardQuery.eq("company_id", sid);
      else cardQuery = cardQuery.eq("id", "00000000-0000-0000-0000-000000000000"); // no match
    } else {
      isSweep = true;
      cardQuery = cardQuery
        .neq("status", "archived") // archived cards are never reprojected/resurrected
        .lt("updated_at", sweepSince) // only cards not yet refreshed in this sweep
        .order("updated_at", { ascending: true }) // oldest-refreshed first → full coverage
        .limit(limit);
    }

    const { data: cardRows, error: cardErr } = await cardQuery;
    if (cardErr) throw new Error("cards_unavailable");
    const cards = (cardRows ?? []) as Row[];

    // ── Batch-load identity rows + graph relationship counts ────────────────
    const personIds = [
      ...new Set(cards.map((c) => c.person_id as string | null).filter(Boolean)),
    ] as string[];
    const companyIds = [
      ...new Set(cards.map((c) => c.company_id as string | null).filter(Boolean)),
    ] as string[];

    const peopleById = new Map<string, Row>();
    for (const ids of batches(personIds)) {
      const { data, error } = await admin
        .from("people")
        .select("id, display_name, first_name, last_name, primary_email, primary_phone, company_id")
        .eq("tenant_id", tenantId)
        .in("id", ids);
      if (error) throw new Error("people_unavailable");
      for (const p of (data ?? []) as Row[]) peopleById.set(p.id as string, p);
    }
    const companyById = new Map<string, Row>();
    for (const ids of batches(companyIds)) {
      const { data, error } = await admin
        .from("companies")
        .select("id, name, domain, phone")
        .eq("tenant_id", tenantId)
        .in("id", ids);
      if (error) throw new Error("companies_unavailable");
      for (const c of (data ?? []) as Row[]) companyById.set(c.id as string, c);
    }

    // Graph relationship counts for each person node (a real graph read).
    const personNodeId = new Map<string, string>(); // person_id → graph node id
    const relationshipCount = new Map<string, number>(); // graph node id → edge count
    for (const ids of batches(personIds)) {
      const { data: nodes, error: nodesError } = await admin
        .from("graph_nodes")
        .select("id, source_id")
        .eq("tenant_id", tenantId)
        .eq("node_type", "person")
        .eq("source_table", "people")
        .in("source_id", ids);
      if (nodesError) throw new Error("graph_nodes_unavailable");
      for (const n of (nodes ?? []) as Row[]) {
        personNodeId.set(n.source_id as string, n.id as string);
      }
    }
    for (const ids of batches([...new Set(personNodeId.values())])) {
      const targets = new Set(ids);
      let cursor: string | null = null;
      while (true) {
        let query = admin
          .from("graph_edges")
          .select("id, from_node_id, to_node_id")
          .eq("tenant_id", tenantId)
          .or(`from_node_id.in.(${ids.join(",")}),to_node_id.in.(${ids.join(",")})`)
          .order("id", { ascending: true })
          .limit(EDGE_PAGE);
        if (cursor) query = query.gt("id", cursor);
        const { data: edges, error: edgesError } = await query;
        if (edgesError) throw new Error("graph_edges_unavailable");
        const rows = (edges ?? []) as Row[];
        for (const e of rows) {
          const f = e.from_node_id as string;
          const t = e.to_node_id as string;
          // A cross-batch edge is read twice but counts once per endpoint.
          if (targets.has(f)) relationshipCount.set(f, (relationshipCount.get(f) ?? 0) + 1);
          if (targets.has(t)) relationshipCount.set(t, (relationshipCount.get(t) ?? 0) + 1);
        }
        if (rows.length < EDGE_PAGE) break;
        const next = rows[rows.length - 1]?.id;
        if (typeof next !== "string" || (cursor && next <= cursor)) throw new Error("graph_edges_cursor_invalid");
        cursor = next;
      }
    }

    let cardsProjected = 0;
    let skipped = 0;
    let failed = 0;
    const healthCounts: Record<Health, number> = {
      excellent: 0,
      good: 0,
      attention: 0,
      critical: 0,
    };

    for (const card of cards) {
      try {
        const cardId = card.id as string;
        const personId = card.person_id as string | null;
        const companyId = card.company_id as string | null;
        const locked = (card.locked_fields as string[] | undefined) ?? [];
        const person = personId ? peopleById.get(personId) : null;
        const company = companyId ? companyById.get(companyId) : null;

        // Missing linked identity may be a concurrent deletion or an incomplete
        // read. Preserve the prior card rather than replacing it with invented zeroes.
        if ((personId && !person) || (companyId && !company))
          throw new Error("linked_identity_unavailable");

        // Guard: never (re)project synthetic fixtures — demo/test contacts on the
        // reserved @example.invalid domain must not reappear in a live tenant view.
        // (RFC 6761 reserves .invalid; it can never be a real customer address.)
        const personEmail = (person?.primary_email as string | null) ?? null;
        if (personEmail && /@example\.invalid$/i.test(personEmail)) {
          // Skip synthetic fixtures, but bump updated_at so the sweep cursor advances
          // past them (a stale synthetic card must never stall a full sweep).
          if (isSweep) {
            if (typeof card.updated_at !== "string") throw new Error("card_revision_unavailable");
            const { data: advanced, error } = await admin
              .from("customer_cards")
              .update({ status: card.status })
              .eq("tenant_id", tenantId)
              .eq("id", cardId)
              .eq("updated_at", card.updated_at)
              .select("id")
              .maybeSingle();
            if (error || advanced?.id !== cardId) throw new Error("synthetic_cursor_unconfirmed");
          }
          skipped += 1;
          continue;
        }
        // Respect an operator archive: never resurrect a card explicitly archived.
        if (card.status === "archived") {
          skipped += 1;
          continue;
        }

        // Filter retained drafts before taking either bounded evidence window.
        // A failed/malformed eligibility read must preserve the saved projection.
        const { data: inputData, error: inputError } = await admin.rpc(
          "learn_card_projection_inputs",
          { p_tenant: tenantId, p_card: cardId },
        );
        const inputs = inputData as {
          version?: string;
          tenantId?: string;
          cardId?: string;
          capturedAt?: string;
          interactions?: Row[];
          recommendations?: Row[];
          coverage?: Record<string, number>;
        } | null;
        const coverage = inputs?.coverage;
        const countKeys = [
          "eligibleInteractions",
          "excludedDraftInteractions",
          "interactionsLast7",
          "interactionsPrev7",
          "eligibleRecommendations",
          "excludedDraftRecommendations",
          "urgentRecommendations",
        ];
        if (
          inputError ||
          inputs?.version !== "learn-card-inputs/1" ||
          inputs.tenantId !== tenantId ||
          inputs.cardId !== cardId ||
          !Array.isArray(inputs.interactions) ||
          !Array.isArray(inputs.recommendations) ||
          !coverage ||
          countKeys.some((key) => !Number.isSafeInteger(coverage[key]) || coverage[key] < 0) ||
          coverage.urgentRecommendations > coverage.eligibleRecommendations ||
          coverage.interactionLimit !== 100 ||
          coverage.recommendationLimit !== 50 ||
          inputs.interactions.length !== Math.min(100, coverage.eligibleInteractions) ||
          inputs.recommendations.length !== Math.min(50, coverage.eligibleRecommendations) ||
          typeof inputs.capturedAt !== "string" ||
          !Number.isFinite(Date.parse(inputs.capturedAt))
        ) {
          throw new Error("eligible_card_inputs_unavailable");
        }
        const interactions = inputs.interactions;
        const recs = inputs.recommendations;
        const ascending = [...interactions].reverse();

        // ── Communication ────────────────────────────────────────────────
        const last7 = coverage.interactionsLast7;
        const prev7 = coverage.interactionsPrev7;
        const channels = [
          ...new Set(interactions.map((i) => (i.interaction_type as string | null) ?? "unknown")),
        ];
        const lastInteractionAt = (interactions[0]?.occurred_at as string | null) ?? null;
        const latestSentiment =
          (interactions.find((i) => i.sentiment)?.sentiment as string | null) ?? null;

        const resp = responsiveness(
          ascending.map((i) => ({
            direction: i.direction as string | null,
            occurred_at: i.occurred_at as string | null,
          })),
        );

        // ── Operations ────────────────────────────────────────────────────
        const urgent = recs.filter((r) =>
          URGENT_SEVERITY.has(((r.severity as string | null) ?? "").toLowerCase()),
        );
        const waiting = recs.filter(
          (r) => !URGENT_SEVERITY.has(((r.severity as string | null) ?? "").toLowerCase()),
        );
        const overdueActions =
          card.due_at && !card.completed_at && Date.parse(card.due_at as string) < nowMs ? 1 : 0;

        // ── Health + Activity (explainable) ───────────────────────────────
        const { health, reasons } = computeHealth({
          openRecs: coverage.eligibleRecommendations,
          urgentRecs: coverage.urgentRecommendations,
          negativeSentiment: latestSentiment === "negative",
          unansweredInbound: resp.unansweredInbound,
          waitingActions: coverage.eligibleRecommendations - coverage.urgentRecommendations,
          overdueActions,
        });
        const activity = computeActivityScore({
          interactionsLast7: last7,
          interactionsPrev7: prev7,
          totalInteractions: coverage.eligibleInteractions,
          openRecs: coverage.eligibleRecommendations,
          lastInteractionAgeDays: daysBetween(lastInteractionAt, nowMs),
          avgResponseHours: resp.avgResponseHours,
        });

        // ── Identity ──────────────────────────────────────────────────────
        // Honest identity: resolved name → email → company → explicitly unresolved.
        // We deliberately do NOT fall back to the stored card.title, which can hold a
        // stale mislabel (e.g. the tenant's own name from a pre-fix outbound-email
        // projection); the corrected value is written back to the title below.
        const displayName =
          (person?.display_name as string | null) ||
          [person?.first_name, person?.last_name].filter(Boolean).join(" ") ||
          (person?.primary_email as string | null) ||
          (company?.name as string | null) ||
          "Unresolved contact";
        const emails = [person?.primary_email as string | null].filter(Boolean);
        const phones = [
          person?.primary_phone as string | null,
          company?.phone as string | null,
        ].filter(Boolean);

        // ── Timeline (projection only — never source content) ─────────────
        const timeline = [
          ...interactions.slice(0, TIMELINE_MAX).map((i) => ({
            at: (i.occurred_at as string | null) ?? null,
            kind: "interaction",
            label: humanizeInteraction({
              interaction_type: i.interaction_type as string | null,
              direction: i.direction as string | null,
              occurred_at: i.occurred_at as string | null,
            }),
          })),
          ...recs.slice(0, 5).map((r) => ({
            at: (r.created_at as string | null) ?? null,
            kind: "recommendation",
            label: `Recommendation: ${(r.title as string | null) ?? (r.type as string | null) ?? "action"}`,
          })),
        ]
          .filter((t) => t.at)
          .sort((a, b) => Date.parse(b.at as string) - Date.parse(a.at as string))
          .slice(0, TIMELINE_MAX);

        const nodeId = personId ? personNodeId.get(personId) : undefined;
        const relationships = nodeId ? (relationshipCount.get(nodeId) ?? 0) : 0;

        const projection = {
          version: 1,
          generated_at: inputs.capturedAt,
          evidence: {
            version: "learn-card-inputs/1",
            ...coverage,
            sampledInteractions: interactions.length,
            sampledRecommendations: recs.length,
            responseTimeScope: "Latest 100 eligible communications; not a staff performance score",
            recommendationsTruncated: coverage.eligibleRecommendations > recs.length,
          },
          identity: {
            display_name: displayName,
            company_name: (company?.name as string | null) ?? null,
            primary_contact: displayName,
            emails,
            phones,
          },
          communication: {
            last_interaction_at: lastInteractionAt,
            interaction_count: coverage.eligibleInteractions,
            trend: interactionTrend(last7, prev7),
            channels,
          },
          operations: {
            open_recommendations: coverage.eligibleRecommendations,
            urgent: urgent.map((r) => ({
              title: (r.title as string | null) ?? (r.type as string | null),
              severity: (r.severity as string | null) ?? null,
              action: (r.recommended_action as string | null) ?? null,
            })),
            waiting: waiting.map((r) => ({
              title: (r.title as string | null) ?? (r.type as string | null),
              severity: (r.severity as string | null) ?? null,
            })),
            blockers: urgent
              .filter((r) =>
                ["critical", "emergency"].includes(
                  ((r.severity as string | null) ?? "").toLowerCase(),
                ),
              )
              .map((r) => (r.title as string | null) ?? (r.type as string | null)),
          },
          business: {
            confidence: (card.confidence as number | null) ?? null,
            health,
            health_reasons: reasons,
            sentiment: latestSentiment,
            avg_response_hours: resp.avgResponseHours,
            activity_score: activity.score,
            activity_inputs: activity.inputs,
            relationship_count: relationships,
          },
          timeline,
        };

        // ── Write the projection — respecting locked fields ───────────────
        const existingContext = (card.context as Record<string, unknown> | null) ?? {};
        const patch: Record<string, unknown> = { context: { ...existingContext, projection } };
        // Refresh the stored title from the corrected identity so a stale mislabel
        // (e.g. the tenant name) can never persist on the card.
        if (!locked.includes("title")) patch.title = displayName;
        if (!locked.includes("status")) patch.status = healthToCardStatus(health);
        if (!locked.includes("latest_activity_at")) {
          patch.latest_activity_at = lastInteractionAt;
        }
        if (typeof card.updated_at !== "string") throw new Error("card_revision_unavailable");
        const { data: updatedCard, error: updErr } = await admin
          .from("customer_cards")
          .update(patch)
          .eq("tenant_id", tenantId)
          .eq("id", cardId)
          .eq("updated_at", card.updated_at)
          .select("id")
          .maybeSingle();
        if (updErr || updatedCard?.id !== cardId) {
          failed += 1;
          continue;
        }
        cardsProjected += 1;
        healthCounts[health] += 1;
      } catch (_e) {
        failed += 1; // failure-isolated: one bad card never aborts the batch
      }
    }

    // Self-continue the sweep while a full batch was taken (more stale cards remain);
    // stops automatically when the final batch is short. Strictly serial via the
    // idempotent job_key.
    const moreToSweep = isSweep && (cardRows?.length ?? 0) >= limit;
    return {
      success: failed === 0,
      recordsProcessed: cardsProjected,
      result: {
        cards_projected: cardsProjected,
        skipped,
        failed,
        health_counts: healthCounts,
        swept: cardRows?.length ?? 0,
      },
      ...(moreToSweep
        ? {
            continuation: {
              jobType: "customer_card.sync",
              jobKey: `customer_card.sync:${tenantId}`,
              payload: { limit, sweep_since: sweepSince },
            },
          }
        : {}),
      ...(failed > 0
        ? {
            error: {
              code: "card_partial_failure",
              message: `${failed} card projection(s) failed`,
              retryable: true,
            },
          }
        : {}),
    };
  } catch {
    // Database/provider prose can contain private source details. Keep it out of
    // durable job results and preserve the existing projection for retry.
    const message = "Required customer-card data could not be read. Existing cards were retained.";
    return {
      success: false,
      error: { code: "card_sync_error", message, retryable: true },
    };
  }
}
