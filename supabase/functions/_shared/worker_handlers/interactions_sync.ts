// Guarded repair/backfill from retained sources. The scoped database publisher
// preserves authoritative ownership and commits the interaction/event/receipt
// together; this worker performs no direct source, interaction or event DML.
import type { WorkerHandlerContext, WorkerHandlerResult } from "../worker_contract.ts";
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const revision = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export async function handleInteractionsSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin: admin, tenantId, payload } = ctx;
  if (payload.source !== undefined && !["phone", "email", "all"].includes(String(payload.source)))
    return {
      success: false,
      error: {
        code: "projection_source_invalid",
        message: "Choose Phone, Email or all communication inputs.",
        retryable: false,
      },
    };
  const source = payload.source === "phone" || payload.source === "email" ? payload.source : "all";
  if (payload.lane !== undefined && !(source === "email" && payload.lane === "current"))
    return {
      success: false,
      error: {
        code: "projection_lane_invalid",
        message: "Choose the current Email lane only with Email input.",
        retryable: false,
      },
    };
  const currentEmail = source === "email" && payload.lane === "current";
  // Each publication takes a separate transaction. Keep one Edge run bounded;
  // the queue can drain further batches after confirmed completion.
  const requestedLimit = Math.max(
    1,
    Math.min(
      currentEmail ? 100 : 200,
      typeof payload.limit === "number" && Number.isFinite(payload.limit)
        ? Math.trunc(payload.limit)
        : 20,
    ),
  );
  // The LIVE API authenticator has an eight-second statement timeout. The
  // older Email selector crossed it at 50 rows, so bound every legacy batch
  // and its continuation while leaving current-mail and Phone lanes alone.
  const limit = !currentEmail && source === "email"
    ? Math.min(requestedLimit, 10) : requestedLimit;
  const counts = {
    phone_selected: 0,
    phone_created: 0,
    phone_updated: 0,
    phone_skipped: 0,
    email_selected: 0,
    email_created: 0,
    email_updated: 0,
    interactions_upserted: 0,
    phone_processed: 0,
    email_processed: 0,
    skipped: 0,
    review_required: 0,
    reviews_recorded: 0,
    failed: 0,
  };
  let inventoryStep = "selector_rpc";
  let databaseErrorCode: string | null = null;
  try {
    const { data: rows, error } = await admin.rpc(
      currentEmail ? "learn_projection_pending_current_email" : "learn_projection_pending",
      currentEmail ? { p_tenant: tenantId, p_limit: limit }
        : { p_tenant: tenantId, p_source: source, p_limit: limit },
    );
    if (error) {
      databaseErrorCode = typeof error.code === "string" &&
          /^[A-Z0-9_]{3,12}$/.test(error.code) ? error.code : null;
      throw Error("inventory");
    }
    inventoryStep = "selector_shape";
    if (
      !Array.isArray(rows) ||
      rows.length > limit ||
      rows.some(
        (r) =>
          !["phone", "email"].includes(r?.source_kind) ||
          !uuid(r?.source_id) ||
          !revision(r?.source_revision) ||
          (source !== "all" && r.source_kind !== source),
      ) ||
      new Set(rows.map((r) => r.source_kind + ":" + r.source_id)).size !== rows.length
    )
      throw Error("inventory");
    for (const row of rows) {
      if (row.source_kind === "phone") counts.phone_selected++;
      else counts.email_selected++;
      const request = crypto.randomUUID(),
        args = {
          p_tenant: tenantId,
          p_request: request,
          p_source: row.source_kind,
          p_source_id: row.source_id,
          p_revision: row.source_revision,
        };
      let receipt: any = null;
      for (const phase of ["publish", "inspect"]) {
        try {
          const { data: r, error } = await admin.rpc("learn_project_interaction", {
            ...args,
            p_phase: phase,
          });
          if (
            !error &&
            r?.version === "learn-interaction-projection/1" &&
            r.tenantId === tenantId &&
            r.requestId === request &&
            r.sourceKind === row.source_kind &&
            r.sourceId === row.source_id &&
            r.sourceRevision === row.source_revision &&
            (r.state === "review_required"
              ? r.action === "held" &&
                typeof r.reason === "string" &&
                (r.interactionId === null || uuid(r.interactionId)) &&
                r.eventId === null
              : r.state === "committed" &&
                uuid(r.interactionId) &&
                ["created", "updated", "unchanged", "authoritative_phone_refresh"].includes(
                  r.action,
                ) &&
                (r.action === "unchanged" ? r.eventId === null : uuid(r.eventId)) &&
                (r.action !== "authoritative_phone_refresh" || row.source_kind === "phone"))
          ) {
            receipt = r;
            break;
          }
        } catch {
          /* Inspect the same request once; never repeat an uncertain publication. */
        }
      }
      if (!receipt) {
        counts.failed++;
        continue;
      }
      if (receipt.state === "review_required") {
        counts.reviews_recorded++;
        continue; // durable outstanding count below
      }
      if (receipt.action === "unchanged") {
        counts.skipped++;
        if (row.source_kind === "phone") counts.phone_skipped++;
        continue;
      }
      counts.interactions_upserted++;
      if (row.source_kind === "phone") {
        counts.phone_processed++;
        if (receipt.action === "created") counts.phone_created++;
        else counts.phone_updated++;
      } else {
        counts.email_processed++;
        if (receipt.action === "created") counts.email_created++;
        else counts.email_updated++;
      }
    }
    // The legacy Email lane still publishes the tenant-wide review count.
    // Its older holds must not mark this bounded current-mail lane as failed.
    if (!currentEmail) {
      inventoryStep = "review_rpc";
      const review = await admin.rpc("learn_projection_review_count", {
        p_tenant: tenantId,
        p_source: source,
      });
      if (review.error) {
        databaseErrorCode = typeof review.error.code === "string" &&
            /^[A-Z0-9_]{3,12}$/.test(review.error.code) ? review.error.code : null;
        throw Error("review_inventory");
      }
      inventoryStep = "review_shape";
      if (!Number.isSafeInteger(review.data) || review.data < 0)
        throw Error("review_inventory");
      counts.review_required = review.data;
    }
    // A durable hold leaves this revision out of pending selection. Drain other
    // retained sources while the held record remains visible for review.
    const continued =
      counts.failed === 0 &&
      rows.length === limit &&
      counts.interactions_upserted + counts.reviews_recorded > 0 &&
      counts.interactions_upserted + counts.reviews_recorded + counts.skipped === rows.length;
    const continuation = continued
      ? {
          jobType: "interactions.sync",
          jobKey: `interactions.sync:${tenantId}:${source}${currentEmail ? ":current" : ""}`,
          payload: { source, limit, ...(currentEmail ? { lane: "current" } : {}) },
          connectorId: "openfolk-core",
          moduleId: "core.interactions",
          priority: currentEmail ? 40 : 50,
        }
      : undefined;
    if (counts.failed || counts.review_required)
      return {
        success: false,
        recordsProcessed: counts.interactions_upserted,
        result: { ...counts, continued },
        ...(continuation ? { continuation } : {}),
        error: {
          code: counts.failed ? "projection_unconfirmed" : "projection_review_required",
          message: counts.failed
            ? "Some retained inputs could not be published reliably. Existing records remain available for retry."
            : "Some legacy inputs need review before their canonical records can be updated.",
          retryable: counts.failed > 0,
        },
      };
    return {
      success: true,
      recordsProcessed: counts.interactions_upserted,
      result: { ...counts, continued },
      ...(continuation ? { continuation } : {}),
    };
  } catch {
    // The fenced settlement accepts only the established numeric result keys.
    // Log this bounded diagnostic separately so a failed read can still settle.
    if (source === "email" && !currentEmail && (ctx.claim?.attemptCount ?? 1) > 1) {
      console.warn(`learn_email_inventory_stage=${inventoryStep} database_code=${databaseErrorCode ?? "none"}`);
    }
    return {
      success: false,
      recordsProcessed: counts.interactions_upserted,
      result: counts,
      error: {
        code: "projection_inventory_unconfirmed",
        message: "Projection work or its outstanding review state could not be read reliably.",
        retryable: true,
      },
    };
  }
}
