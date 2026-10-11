// Deliver each canonical revision through one atomic identity/card transaction.
// The database owns contact matching, manual-field protection, card writes and
// event acknowledgement together. No direct DML or best-effort success here.
import { triggerGraphSyncBackground } from "../business_graph.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_contract.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const revision = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export async function handleIdentityResolve(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: admin, tenantId, payload } = ctx;
  const batch = Math.max(
    1,
    Math.min(
      50,
      typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? Math.trunc(payload.limit)
        : 20,
    ),
  );
  const counts = {
    resolved: 0,
    cards_enriched: 0,
    people_created: 0,
    companies_created: 0,
    recommendations: 0,
    suggestions_created: 0,
    events_consumed: 0,
    review_required: 0,
    failed: 0,
    continued: false,
  };
  try {
    const { data: rows, error } = await admin.rpc("learn_identity_pending", {
      p_tenant: tenantId,
      p_limit: batch,
    });
    if (
      error ||
      !Array.isArray(rows) ||
      rows.length > batch ||
      new Set(rows.map((r) => r?.interaction_id)).size !== rows.length ||
      rows.some((r) => !uuid(r?.interaction_id) || !revision(r?.source_revision))
    )
      throw Error("identity_inventory_unconfirmed");
    for (const row of rows) {
      const requestId = crypto.randomUUID();
      const args = {
        p_tenant: tenantId,
        p_request: requestId,
        p_interaction: row.interaction_id,
        p_revision: row.source_revision,
      };
      let receipt: any = null;
      for (const phase of ["publish", "inspect"]) {
        try {
          const { data, error } = await admin.rpc("learn_identity_deliver", {
            ...args,
            p_phase: phase,
          });
          if (
            !error &&
            data?.version === "learn-identity-delivery/1" &&
            ["committed", "review_required"].includes(data.state) &&
            data.tenantId === tenantId &&
            data.requestId === requestId &&
            data.interactionId === row.interaction_id &&
            data.sourceRevision === row.source_revision &&
            typeof data.personCreated === "boolean" &&
            typeof data.companyCreated === "boolean" &&
            typeof data.cardEnriched === "boolean" &&
            [data.recommendations, data.suggestions, data.eventsConsumed].every(integer) &&
            data.eventsConsumed <= 1 &&
            (data.state === "committed"
              ? data.cardEnriched && uuid(data.cardId)
              : !data.cardEnriched &&
                data.cardId === null &&
                !data.personCreated &&
                !data.companyCreated &&
                data.recommendations === 0 &&
                data.suggestions === 0 &&
                data.eventsConsumed === 0 &&
                typeof data.reason === "string")
          ) {
            receipt = data;
            break;
          }
        } catch {
          /* Inspect the same immutable request after response loss; never republish. */
        }
      }
      if (!receipt) {
        counts.failed++;
        continue;
      }
      if (receipt.state === "review_required") {
        counts.review_required++;
        continue;
      }
      counts.resolved++;
      counts.cards_enriched++;
      counts.people_created += Number(receipt.personCreated);
      counts.companies_created += Number(receipt.companyCreated);
      counts.recommendations += receipt.recommendations;
      counts.suggestions_created += receipt.suggestions;
      counts.events_consumed += receipt.eventsConsumed;
    }
    if (counts.resolved > 0) triggerGraphSyncBackground(tenantId);
    const review = await admin.rpc("learn_identity_review_count", { p_tenant: tenantId });
    if (review.error || !Number.isSafeInteger(review.data) || review.data < 0)
      throw Error("identity_review_inventory_unconfirmed");
    counts.review_required = review.data;
    const needsReview = counts.review_required > 0;
    if (counts.failed || needsReview)
      return {
        success: false,
        recordsProcessed: counts.resolved,
        result: counts,
        error: {
          code: counts.failed ? "identity_delivery_unconfirmed" : "identity_review_required",
          message: counts.failed
            ? "Some customer-card deliveries could not be confirmed. Retained inputs remain available for retry."
            : "Some interactions need identity review. Their events remain pending.",
          retryable: counts.failed > 0,
        },
      };
    counts.continued = rows.length === batch && counts.resolved > 0;
    return {
      success: true,
      recordsProcessed: counts.resolved,
      result: counts,
      ...(counts.continued
        ? {
            continuation: {
              jobType: "identity.resolve",
              jobKey: `identity.resolve:${tenantId}`,
              payload: { limit: batch },
              connectorId: "openfolk-core",
              moduleId: "core.identity",
              priority: 50,
            },
          }
        : {}),
    };
  } catch {
    return {
      success: false,
      recordsProcessed: counts.resolved,
      result: counts,
      error: {
        code: "identity_inventory_unconfirmed",
        message:
          "Identity work could not be read reliably. Retained inputs have not been declared complete.",
        retryable: true,
      },
    };
  }
}
