// marketing.delivery_sync — project the Automation Engine's immutable
// execution facts into the bounded Marketing delivery records (and, on
// CONFIRMED submission, the canonical outbound email_messages row) via the
// governed SQL reconciler `marketing_delivery_reconcile`.
//
// This handler is deliberately thin: selection + one RPC per delivery. All
// transition legality, append-only history and canonical upserts live in SQL
// where the structural guards are. It never touches the engine's tables and
// never re-decides anything — it copies facts.
//
// Drain model: enqueued after a test-send request and re-enqueued via the
// standard continuation while non-terminal deliveries remain (bounded by a
// payload ttl so an abandoned queue never polls forever — the Edge status
// read also reconciles lazily, so nothing is lost when the ttl runs out).

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

const BATCH = 50;
const DEFAULT_TTL = 30; // continuations ≈ one worker tick (1 min) apart

export async function handleMarketingDeliverySync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const db = ctx.supabaseAdmin;
  const tenantId = ctx.tenantId;
  const rawTtl = ctx.payload?.ttl;
  const ttl =
    typeof rawTtl === "number" && Number.isFinite(rawTtl)
      ? Math.max(0, Math.min(120, Math.floor(rawTtl)))
      : DEFAULT_TTL;

  const { data: rows, error } = await db
    .from("marketing_deliveries")
    .select("id, status")
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "executing", "unknown"])
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) {
    return {
      success: false,
      error: {
        code: "delivery_select_failed",
        message: error.message.slice(0, 200),
        retryable: true,
      },
    };
  }

  let changed = 0;
  let remaining = 0;
  for (const row of rows ?? []) {
    const r = await db.rpc("marketing_delivery_reconcile", {
      p_tenant: tenantId,
      p_delivery: row.id,
    });
    if (r.error) {
      // one bad row must not starve the rest; the guard/RPC error is safe text
      remaining += 1;
      continue;
    }
    const out = r.data as { status?: string; changed?: boolean } | null;
    if (out?.changed) changed += 1;
    if (out?.status === "queued" || out?.status === "executing") remaining += 1;
    // 'unknown' deliveries are NOT counted as remaining: they are frozen for
    // explicit reconciliation/human review, never polled in a hot loop
  }

  const result: WorkerHandlerResult = {
    success: true,
    recordsProcessed: changed,
    result: { reconciled: changed, pending: remaining, ttl },
  };
  if (remaining > 0 && ttl > 0) {
    result.continuation = {
      jobType: "marketing.delivery_sync",
      jobKey: `marketing.delivery_sync:${tenantId}`,
      moduleId: "marketing.senders",
      payload: { ttl: ttl - 1 },
    };
  }
  return result;
}
