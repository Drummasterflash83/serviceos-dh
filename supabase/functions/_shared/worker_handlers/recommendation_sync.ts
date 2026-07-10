// ServiceOS — Worker handler: recommendation.sync (deterministic rule engine).
// Pure business logic — auth/CORS/job-lifecycle live in the caller. Moved verbatim
// from recommendation-sync/index.ts; both the Edge wrapper and the platform-worker
// call this ONE copy.

import { isUuid } from "../simwood.ts";
import {
  buildRecommendationsForCard,
  closeResolvedRecommendations,
  upsertRecommendation,
  type InteractionLite,
  type ProjectionLite,
} from "../recommendations.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const INTERACTION_WINDOW = 50;

type Row = Record<string, unknown>;

function clampLimit(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, n));
}

function toProjectionLite(context: unknown): ProjectionLite | null {
  if (!context || typeof context !== "object") return null;
  const proj = (context as Record<string, unknown>).projection;
  if (!proj || typeof proj !== "object") return null;
  const p = proj as Record<string, unknown>;
  const business = (p.business as Record<string, unknown> | undefined) ?? {};
  const operations = (p.operations as Record<string, unknown> | undefined) ?? {};
  return {
    business: {
      health: (business.health as string | null) ?? null,
      sentiment: (business.sentiment as string | null) ?? null,
    },
    operations: {
      open_recommendations:
        typeof operations.open_recommendations === "number" ? operations.open_recommendations : 0,
    },
  };
}

export async function handleRecommendationSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: admin, tenantId, payload } = ctx;
  const limit = clampLimit(payload.limit);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    let cardQuery = admin
      .from("customer_cards")
      .select("id, person_id, company_id, confidence, latest_activity_at, context")
      .eq("tenant_id", tenantId);
    if (isUuid(payload.customer_card_id)) {
      cardQuery = cardQuery.eq("id", payload.customer_card_id as string);
    } else {
      cardQuery = cardQuery
        .order("latest_activity_at", { ascending: false, nullsFirst: false })
        .limit(limit);
    }
    const { data: cardRows, error: cardErr } = await cardQuery;
    if (cardErr) throw new Error(`cards read failed: ${cardErr.message}`);
    const cards = (cardRows ?? []) as Row[];

    // Batch-load verified flags for the cards' people.
    const personIds = [
      ...new Set(cards.map((c) => c.person_id as string | null).filter(Boolean)),
    ] as string[];
    const verifiedByPerson = new Map<string, boolean>();
    if (personIds.length) {
      const { data } = await admin
        .from("people")
        .select("id, verified")
        .eq("tenant_id", tenantId)
        .in("id", personIds);
      for (const p of (data ?? []) as Row[]) {
        verifiedByPerson.set(p.id as string, Boolean(p.verified));
      }
    }

    let created = 0;
    let updated = 0;
    let closed = 0;
    let skipped = 0;
    let failed = 0;

    for (const card of cards) {
      try {
        const cardId = card.id as string;
        const personId = (card.person_id as string | null) ?? null;
        const companyId = (card.company_id as string | null) ?? null;
        const projection = toProjectionLite(card.context);

        // A card with no identity AND no projection has nothing to evaluate.
        if (!personId && !companyId && !projection) {
          skipped += 1;
          continue;
        }

        // Interactions for this person/company (recent window, newest first).
        const filters: string[] = [];
        if (personId) filters.push(`related_person_id.eq.${personId}`);
        if (companyId) filters.push(`related_company_id.eq.${companyId}`);
        let interactions: InteractionLite[] = [];
        if (filters.length) {
          const { data } = await admin
            .from("interactions")
            .select("id, direction, occurred_at, interaction_type, sentiment")
            .eq("tenant_id", tenantId)
            .or(filters.join(","))
            .order("occurred_at", { ascending: false, nullsFirst: false })
            .limit(INTERACTION_WINDOW);
          interactions = (data ?? []) as InteractionLite[];
        }

        const desired = buildRecommendationsForCard({
          card: {
            id: cardId,
            confidence: (card.confidence as number | null) ?? null,
            latest_activity_at: (card.latest_activity_at as string | null) ?? null,
          },
          projection,
          interactions,
          personVerified: personId ? (verifiedByPerson.get(personId) ?? false) : null,
          nowMs,
        });

        for (const rec of desired) {
          const res = await upsertRecommendation(admin, {
            tenantId,
            cardId,
            personId,
            companyId,
            rec,
          });
          if (res.id) {
            if (res.created) created += 1;
            else updated += 1;
          } else {
            failed += 1;
          }
        }

        // Close engine-owned recommendations whose rule no longer fires.
        closed += await closeResolvedRecommendations(admin, {
          tenantId,
          cardId,
          keepTypes: desired.map((d) => d.type),
          nowIso,
        });
      } catch (_e) {
        failed += 1; // failure-isolated: one bad card never aborts the batch
      }
    }

    return {
      success: failed === 0,
      recordsProcessed: created + updated + closed,
      result: { created, updated, closed, skipped, failed },
      ...(failed > 0
        ? {
            error: {
              code: "recommendation_partial_failure",
              message: `${failed} recommendation write(s) failed`,
              retryable: true,
            },
          }
        : {}),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "recommendation-sync failed";
    return {
      success: false,
      error: { code: "recommendation_sync_error", message: message.slice(0, 500), retryable: true },
    };
  }
}
