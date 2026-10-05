// marketing.broadcast_dispatch — the bounded, lease-safe broadcast recipient
// preparer. It NEVER sends email and NEVER decides policy:
//
//   1. lease a small deterministic batch of pending dispatches
//      (marketing_broadcast_claim_batch — FOR UPDATE SKIP LOCKED, quiet hours
//      defer, lease recovery for crashed workers);
//   2. per recipient, fetch the FROZEN bundle (immutable revision content +
//      the member's frozen personalisation context + a freshly minted opaque
//      unsubscribe token) — the SQL bundle RPC re-derives the ONE canonical
//      send authority and marks the dispatch skipped/deferred itself when the
//      recipient is no longer eligible;
//   3. render deterministically (pure renderBroadcast — no network, no
//      current Person/sender data, proven by the pure suite);
//   4. create the complete governed lineage in ONE SQL transaction
//      (marketing_broadcast_create_lineage: Action → Decision Package →
//      approval-required intent + pinned envelope hash → append-only
//      tenant-senior approval → delivery + event → dispatch queued);
//   5. hand the intent to the UNTOUCHED Automation Engine (idempotent
//      enqueue) and keep the existing marketing.delivery_sync reconciler
//      polling;
//   6. return a continuation only while claimable work remains.
//
// Provider capacity is NOT invented: Gmail reports none through this
// pipeline, and none is fabricated here.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { enqueueAutomationExecution } from "../automation_execution_enqueue.ts";
import { enqueueJob } from "../platform_queue.ts";
import { renderBroadcast, type PersonalisationContext } from "../marketing_email.ts";

const BATCH = 10;
const LEASE_SECONDS = 120;

type Row = Record<string, unknown>;

function footerLines(footer: Row, mailbox: string): string[] {
  const lines: string[] = [];
  const name = typeof footer.company_name === "string" ? footer.company_name.trim() : "";
  const address = typeof footer.address === "string" ? footer.address.trim() : "";
  if (name) lines.push(name);
  if (address) lines.push(address);
  lines.push(`You received this email from ${mailbox}.`);
  return lines;
}

export async function handleMarketingBroadcastDispatch(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const db = ctx.supabaseAdmin;
  const tenantId = ctx.tenantId;
  const worker = `broadcast-worker-${ctx.jobId ?? "manual"}`;

  const claim = await db.rpc("marketing_broadcast_claim_batch", {
    p_tenant: tenantId,
    p_worker: worker,
    p_limit: BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claim.error) {
    return {
      success: false,
      error: {
        code: "claim_failed",
        message: claim.error.message.slice(0, 200),
        retryable: true,
      },
    };
  }
  const dispatches = (claim.data ?? []) as Row[];

  let prepared = 0;
  let skipped = 0;
  let deferred = 0;
  let failed = 0;
  let cancelled = 0;
  for (const d of dispatches) {
    const dispatchId = d.id as string;
    const bundleRes = await db.rpc("marketing_broadcast_recipient_bundle", {
      p_tenant: tenantId,
      p_dispatch: dispatchId,
      p_worker: worker,
    });
    if (bundleRes.error) {
      failed += 1; // lease expires; the recipient is re-claimed later
      continue;
    }
    const bundle = (bundleRes.data ?? {}) as Row;
    if (bundle.skipped === true) {
      skipped += 1;
      continue;
    }
    if (bundle.cancelled === true) {
      // the campaign was cancelled while this recipient was leased — the SQL
      // marked it cancelled rather than leaving it falsely pending
      cancelled += 1;
      continue;
    }
    if (bundle.deferred === true) {
      deferred += 1;
      continue;
    }
    let intentId: string | null = null;
    if (bundle.already_prepared === true) {
      intentId = (bundle.intent_id as string | null) ?? null;
    } else {
      // the public unsubscribe URL: frozen base + THIS recipient's token —
      // the SQL lineage guard digest-verifies the token and requires the URL
      // in both rendered bodies
      const base = String(bundle.public_base_url ?? "").replace(/\/+$/, "");
      if (!base) {
        // launch froze no base URL — a configuration fault, never a skip
        return {
          success: false,
          error: {
            code: "unsubscribe_config_missing",
            message: "campaign has no frozen public base URL for unsubscribe links",
            retryable: false,
          },
        };
      }
      const unsubscribeUrl = `${base}/marketing-unsubscribe?t=${bundle.unsubscribe_token}`;
      let rendered;
      try {
        rendered = renderBroadcast({
          subject: String(bundle.subject ?? ""),
          previewText: (bundle.preview_text as string | null) ?? null,
          bodyAuthored: String(bundle.body_authored ?? ""),
          context: (bundle.personalisation ?? {}) as PersonalisationContext,
          fallbacks: (bundle.token_fallbacks ?? {}) as Record<string, string>,
          signatureText: (bundle.signature_text as string | null) ?? null,
          footerLines: footerLines(
            (bundle.unsubscribe_footer ?? {}) as Row,
            String(bundle.mailbox_address ?? ""),
          ),
          unsubscribeUrl,
        });
      } catch {
        // rendering can only fail on data preflight should have excluded —
        // leave the lease to expire and surface through health counts
        failed += 1;
        continue;
      }
      const lineage = await db.rpc("marketing_broadcast_create_lineage", {
        p_tenant: tenantId,
        p_dispatch: dispatchId,
        p_worker: worker,
        p_args: {
          subject: rendered.subject,
          body_text: rendered.text,
          body_html: rendered.html,
          preview_text: rendered.previewText,
          unsubscribe_url: unsubscribeUrl,
        },
      });
      if (lineage.error) {
        failed += 1;
        continue;
      }
      const out = (lineage.data ?? {}) as Row;
      if (out.skipped === true) {
        skipped += 1;
        continue;
      }
      if (out.cancelled === true) {
        cancelled += 1;
        continue;
      }
      if (out.deferred === true) {
        deferred += 1;
        continue;
      }
      intentId = (out.intent_id as string | null) ?? null;
    }
    if (intentId) {
      await enqueueAutomationExecution(db, {
        tenantId,
        automationIntentId: intentId,
        triggeredBy: "intent_created",
        correlationId: null,
      });
      prepared += 1;
    }
  }

  // ── RECOVERY: a crash between the lineage transaction committing and the
  // execution enqueue leaves a QUEUED recipient whose intent is still pending
  // and which no claim query will ever look at again (claims only take pending
  // / lease-expired work). Re-enqueueing is idempotent at both layers — the job
  // key de-dups and the engine's claim RPC is the single-execution authority —
  // so this converges without ever creating a second send.
  let recovered = 0;
  const { data: stuckDispatches } = await db
    .from("marketing_broadcast_dispatches")
    .select("automation_intent_id")
    .eq("tenant_id", tenantId)
    .eq("status", "queued")
    .not("automation_intent_id", "is", null)
    .limit(BATCH * 5);
  const stuckIds = (stuckDispatches ?? [])
    .map((d) => d.automation_intent_id as string)
    .filter(Boolean);
  if (stuckIds.length > 0) {
    const { data: pendingIntents } = await db
      .from("automation_intents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .in("id", stuckIds);
    for (const intent of (pendingIntents ?? []) as Row[]) {
      const r = await enqueueAutomationExecution(db, {
        tenantId,
        automationIntentId: intent.id as string,
        triggeredBy: "repair",
        correlationId: null,
      });
      if (r.id && !r.duplicate) recovered += 1;
    }
  }

  // keep the reconciler draining while broadcast deliveries are in flight
  if (prepared > 0 || recovered > 0) {
    await enqueueJob(db, {
      tenantId,
      jobType: "marketing.delivery_sync",
      jobKey: `marketing.delivery_sync:${tenantId}`,
      moduleId: "marketing.senders",
      payload: { ttl: 30 },
    });
  }

  // continuation only while claimable work remains (paused/cancelled
  // campaigns and quiet hours stop the claim query itself; the scheduler
  // re-drives when conditions change)
  const { count: remaining } = await db
    .from("marketing_broadcast_dispatches")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .in("status", ["pending"]);

  const result: WorkerHandlerResult = {
    success: true,
    recordsProcessed: prepared + skipped,
    result: {
      prepared,
      skipped,
      cancelled,
      deferred,
      failed,
      recovered,
      remaining: remaining ?? 0,
    },
  };
  if ((remaining ?? 0) > 0 && dispatches.length > 0 && deferred === 0) {
    result.continuation = {
      jobType: "marketing.broadcast_dispatch",
      jobKey: `marketing.broadcast_dispatch:${tenantId}`,
      moduleId: "marketing.campaigns",
      payload: {},
    };
  }
  return result;
}
