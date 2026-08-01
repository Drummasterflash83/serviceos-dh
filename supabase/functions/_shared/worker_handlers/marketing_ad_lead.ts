// Worker handler — marketing.ad_lead_process (Marketing Phase 8).
//
// Claims a bounded batch of PENDING ad-lead events with a lease (FOR UPDATE
// SKIP LOCKED inside the claim RPC; an expired lease is reclaimable, so a
// crashed worker never strands work) and processes each through the ONE
// canonical SQL authority `marketing_ad_lead_process` — one transaction per
// event: canonical inbound Interaction, canonical identity resolution
// (marketing_create_contact), governed relationship/tag defaults, append-only
// attribution touchpoint, factual result. Replays and retries converge: the
// interaction key, the identity idempotency key and the touchpoint key all
// derive from the immutable event id.
//
// The handler itself writes NOTHING directly — every mutation is a governed
// RPC. Continuation is returned only while pending work remains.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

const BATCH = 5;
const LEASE_SECONDS = 300;
const JOB_TYPE = "marketing.ad_lead_process";

export async function handleMarketingAdLeadProcess(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const db = ctx.supabaseAdmin;
  const claimed = await db.rpc("marketing_ad_claim_events", {
    p_tenant: ctx.tenantId,
    p_worker: `worker:${ctx.jobId ?? "manual"}`,
    p_batch: BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimed.error) {
    return {
      success: false,
      error: {
        code: "claim_failed",
        message: claimed.error.message.slice(0, 200),
        retryable: true,
      },
    };
  }
  const events = (claimed.data ?? []) as Array<{ id: string }>;
  let processed = 0;
  let failed = 0;
  for (const e of events) {
    const r = await db.rpc("marketing_ad_lead_process", {
      p_tenant: ctx.tenantId,
      p_event: e.id,
    });
    if (r.error) {
      // the RPC classifies its own failures; a transport-level error here
      // leaves the event leased — the expired lease makes it reclaimable
      failed++;
      continue;
    }
    processed++;
  }

  const remaining = await db
    .from("marketing_ad_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", ctx.tenantId)
    .eq("processing_state", "pending");
  const pending = remaining.count ?? 0;

  return {
    success: true,
    recordsProcessed: processed,
    result: { processed, failed, pending },
    ...(pending > 0 && events.length > 0
      ? {
          continuation: {
            jobType: JOB_TYPE,
            jobKey: `${JOB_TYPE}:${ctx.tenantId}`,
          },
        }
      : {}),
  };
}
