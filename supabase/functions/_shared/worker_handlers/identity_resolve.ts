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
      10,
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
    reviews_recorded: 0,
    failed: 0,
    continued: false,
  };
  // Only fixed stages and SQLSTATEs enter Edge diagnostics, never private
  // database messages, source IDs or interaction content.
  let failedStage = "pending_inventory";
  let sqlstate: string | null = null;
  const noteSqlstate = (error: unknown) => {
    const code = (error as { code?: unknown } | null)?.code;
    sqlstate = typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : null;
  };
  // Only fixed protocol markers and validated machine codes may enter a job
  // result. Provider messages, interaction IDs and source content never do.
  const failureReason = (error: any, fallback: string) => {
    const code = error?.code;
    if (code === "PT409" && [
      "identity_source_changed", "identity_event_changed",
      "identity_card_unconfirmed", "identity_tenant_inactive",
      "identity_receipt_conflict", "identity_review_person_unavailable",
      "identity_review_company_unavailable", "processing_receipt_missing",
      "identity_receipt_missing",
    ].includes(error?.message)) return error.message as string;
    if (typeof code === "string" && /^[A-Z0-9]{5}$/.test(code))
      return `sqlstate_${code}`;
    if (typeof code === "string" && /^PGRST[0-9]{3}$/.test(code))
      return `postgrest_${code}`;
    return fallback;
  };
  const validReceipt = (data: any, args: {
    p_request: string; p_interaction: string; p_revision: string;
  }) =>
    data?.version === "learn-identity-delivery/1" &&
    ["committed", "review_required"].includes(data.state) &&
    data.tenantId === tenantId &&
    data.requestId === args.p_request &&
    data.interactionId === args.p_interaction &&
    data.sourceRevision === args.p_revision &&
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
        typeof data.reason === "string");
  async function deliver(row: { interaction_id: string; source_revision: string }) {
    const args = {
      p_tenant: tenantId,
      p_request: crypto.randomUUID(),
      p_interaction: row.interaction_id,
      p_revision: row.source_revision,
    };
    let missing = false;
    let diagnostic = "delivery_unconfirmed";
    for (const phase of ["publish", "inspect"]) {
      try {
        const { data, error } = await admin.rpc("learn_identity_deliver", {
          ...args, p_phase: phase,
        });
        if (!error && validReceipt(data, args)) return { receipt: data, missing: false };
        const reason = error
          ? failureReason(error, `${phase}_error_unclassified`)
          : `${phase}_receipt_invalid`;
        if (phase === "publish" || diagnostic === "delivery_unconfirmed")
          diagnostic = reason;
        // Only a definite missing immutable publication permits a new request.
        // A lost inspect response or malformed receipt must remain unconfirmed.
        if (phase === "inspect" && error?.code === "PT409" &&
          ["processing_receipt_missing", "identity_receipt_missing"].includes(error.message))
          missing = true;
      } catch {
        if (phase === "publish" || diagnostic === "delivery_unconfirmed")
          diagnostic = `${phase}_transport_exception`;
        /* Inspect the same immutable request after response loss; never republish. */
      }
    }
    return { receipt: null, missing, diagnostic };
  }
  try {
    failedStage = "pending_inventory";
    const { data: rows, error } = await admin.rpc("learn_identity_pending", {
      p_tenant: tenantId,
      p_limit: batch,
    });
    if (error) noteSqlstate(error);
    if (
      error ||
      !Array.isArray(rows) ||
      rows.length > batch ||
      new Set(rows.map((r) => r?.interaction_id)).size !== rows.length ||
      rows.some((r) => !uuid(r?.interaction_id) || !revision(r?.source_revision))
    )
      throw Error("identity_inventory_unconfirmed");
    for (const row of rows) {
      failedStage = "delivery";
      let { receipt, missing, diagnostic } = await deliver(row);
      if (!receipt && missing) {
        // A source can change after inventory and before publication. Re-read
        // the bounded pending set; publish at most once with a different,
        // verified revision and a new request. The original request had no
        // durable publication, so this cannot double-count a committed card.
        try {
          const refreshed = await admin.rpc("learn_identity_pending", {
            p_tenant: tenantId, p_limit: batch,
          });
          if (!refreshed.error && Array.isArray(refreshed.data) &&
            refreshed.data.length <= batch &&
            new Set(refreshed.data.map((r: any) => r?.interaction_id)).size === refreshed.data.length) {
            const current = refreshed.data.find((r: any) => r?.interaction_id === row.interaction_id);
            if (current && revision(current.source_revision) &&
              current.source_revision !== row.source_revision)
              ({ receipt, diagnostic } = await deliver(current));
          }
        } catch {
          /* Uncertain inventory leaves this row for the ordinary retry. */
        }
      }
      if (!receipt) {
        counts.failed++;
        // Settlement accepts only its fixed numeric/bool result keys. Keep
        // machine diagnostics in the operational log, never in the receipt.
        console.warn(JSON.stringify({ event: "identity_delivery_unconfirmed",
          reason: diagnostic ?? "delivery_unconfirmed" }));
        continue;
      }
      if (receipt.state === "review_required") {
        counts.review_required++;
        counts.reviews_recorded++;
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
    // A durable review hold is already recorded by the delivery receipt.
    // Historical holds belong to the operator queue, not this work batch;
    // recounting the whole tenant here can time out after successful cards
    // and falsely dead-letter an unrelated ordinary job.
    const needsReview = counts.review_required > 0;
    // A durable hold removes this revision from pending selection. Keep the
    // review visible, but drain unrelated eligible records in the next batch.
    counts.continued =
      // Older saved jobs can still request 200. Their database settlement
      // fence expects 200 receipts, so finish this bounded attempt without a
      // child; the 50-row scheduler will create the next ordinary job.
      (payload.limit === undefined ||
        (typeof payload.limit === "number" && Number.isInteger(payload.limit) &&
          payload.limit >= 1 && payload.limit <= 50)) &&
      // The settlement fence requires a full requested batch when continuing
      // a held review. A legacy 50-row job may safely settle ten successful
      // records, but a mixed held batch must let the scheduler prime a new
      // ten-row job instead of claiming fifty review receipts exist.
      (counts.review_required === 0 || payload.limit === undefined || payload.limit === batch) &&
      counts.failed === 0 &&
      rows.length === batch &&
      counts.resolved + counts.reviews_recorded === rows.length;
    const continuation = counts.continued
      ? {
          jobType: "identity.resolve",
          jobKey: `identity.resolve:${tenantId}`,
          payload: { limit: batch },
          connectorId: "openfolk-core",
          moduleId: "core.identity",
          priority: 50,
        }
      : undefined;
    if (counts.failed || needsReview)
      return {
        success: false,
        recordsProcessed: counts.resolved,
        result: counts,
        ...(continuation ? { continuation } : {}),
        error: {
          code: counts.failed ? "identity_delivery_unconfirmed" : "identity_review_required",
          message: counts.failed
            ? "Some customer-card deliveries could not be confirmed. Retained inputs remain available for retry."
            : "Some interactions need identity review. Their events remain pending.",
          retryable: counts.failed > 0,
        },
      };
    return {
      success: true,
      recordsProcessed: counts.resolved,
      result: counts,
      ...(continuation ? { continuation } : {}),
    };
  } catch {
    // The fenced settlement RPC rejects extra result keys; keep its durable
    // payload unchanged and use a sanitized operational log.
    console.warn(JSON.stringify({ event: "identity_read_failed", stage: failedStage, sqlstate }));
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
