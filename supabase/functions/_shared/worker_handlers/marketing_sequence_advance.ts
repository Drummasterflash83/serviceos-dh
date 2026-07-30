// marketing.sequence_advance — the bounded, lease-safe sequence step runner.
// It NEVER sends email and NEVER decides policy:
//
//   1. lease a small deterministic batch of due enrolment steps
//      (marketing_sequence_claim_batch — FOR UPDATE SKIP LOCKED, lease
//      recovery, quiet-hours deferral). WAIT steps are resolved inside that
//      SQL from the factual arrival time, so a late worker can never make a
//      wait drift; only side-effecting steps come back here.
//   2. per execution, fetch the FROZEN bundle (immutable revision + step
//      config + the enrolment's pinned personalisation, plus a freshly minted
//      opaque unsubscribe token for an email step). The SQL bundle RPC
//      re-derives the ONE canonical authority and marks the execution
//      skipped/deferred/cancelled itself when the recipient is no longer
//      eligible.
//   3. for an email step: render deterministically (the same pure
//      renderBroadcast the Phase-5 path uses — no network, no current
//      Person/sender data) and create the complete governed lineage in ONE
//      SQL transaction (Action → Decision Package → approval-required intent
//      + pinned envelope hash → append-only tenant_senior approval → delivery
//      → execution queued).
//      for an internal action step: create the governed intent lineage for the
//      registered marketing.contact_action capability.
//   4. hand the intent to the UNTOUCHED Automation Engine (idempotent enqueue)
//      and keep the existing marketing.delivery_sync reconciler polling.
//   5. reconcile finished internal-action executions so enrolments advance.
//   6. return a continuation only while claimable work remains.
//
// Provider capacity is NOT invented: Gmail reports none through this pipeline
// and none is fabricated here.

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

export async function handleMarketingSequenceAdvance(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const db = ctx.supabaseAdmin;
  const tenantId = ctx.tenantId;
  const worker = `sequence-worker-${ctx.jobId ?? "manual"}`;

  // exits that do not need a step to run: suppression/unsubscribe between
  // steps, canonical reply evidence and configured lifecycle outcomes
  const exits = { suppression: 0, reply: 0, lifecycle: 0 };
  for (const [key, fn] of [
    ["suppression", "marketing_sequence_apply_suppression_exits"],
    ["reply", "marketing_sequence_apply_reply_exits"],
    ["lifecycle", "marketing_sequence_apply_lifecycle_exits"],
  ] as const) {
    const r = await db.rpc(fn, { p_tenant: tenantId });
    if (!r.error && typeof r.data === "number") exits[key] = r.data;
  }

  const claim = await db.rpc("marketing_sequence_claim_batch", {
    p_tenant: tenantId,
    p_worker: worker,
    p_limit: BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claim.error) {
    return {
      success: false,
      error: { code: "claim_failed", message: claim.error.message.slice(0, 200), retryable: true },
    };
  }
  const executions = (claim.data ?? []) as Row[];

  let prepared = 0;
  let skipped = 0;
  let cancelled = 0;
  let deferred = 0;
  let failed = 0;
  for (const x of executions) {
    const executionId = x.id as string;
    const bundleRes = await db.rpc("marketing_sequence_step_bundle", {
      p_tenant: tenantId,
      p_execution: executionId,
      p_worker: worker,
    });
    if (bundleRes.error) {
      failed += 1; // the lease expires; the step is re-claimed later
      continue;
    }
    const bundle = (bundleRes.data ?? {}) as Row;
    if (bundle.skipped === true) {
      skipped += 1;
      continue;
    }
    if (bundle.cancelled === true) {
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
    } else if (bundle.step_type === "send_email") {
      const base = String(bundle.public_base_url ?? "").replace(/\/+$/, "");
      if (!base) {
        // activation froze no base URL — a configuration fault, never a skip
        return {
          success: false,
          error: {
            code: "unsubscribe_config_missing",
            message: "sequence has no frozen public base URL for unsubscribe links",
            retryable: false,
          },
        };
      }
      const unsubscribeUrl = `${base}/marketing-unsubscribe?t=${bundle.unsubscribe_token}`;
      const config = (bundle.step_config ?? {}) as Row;
      let rendered;
      try {
        rendered = renderBroadcast({
          subject: String(config.subject ?? ""),
          previewText: (config.preview_text as string | null) ?? null,
          bodyAuthored: String(config.body_authored ?? ""),
          context: (bundle.personalisation ?? {}) as PersonalisationContext,
          fallbacks: (config.token_fallbacks ?? {}) as Record<string, string>,
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
      const lineage = await db.rpc("marketing_sequence_create_email_lineage", {
        p_tenant: tenantId,
        p_execution: executionId,
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
      intentId = (out.intent_id as string | null) ?? null;
    } else {
      const lineage = await db.rpc("marketing_sequence_create_action_lineage", {
        p_tenant: tenantId,
        p_execution: executionId,
        p_worker: worker,
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
  // execution enqueue leaves a QUEUED step whose intent is still pending and
  // which no claim query will ever look at again. Re-enqueueing is idempotent
  // at both layers (job key + the engine's claim RPC), so it converges without
  // ever producing a second side effect.
  let recovered = 0;
  const { data: stuck } = await db
    .from("marketing_sequence_executions")
    .select("automation_intent_id")
    .eq("tenant_id", tenantId)
    .eq("status", "queued")
    .not("automation_intent_id", "is", null)
    .limit(BATCH * 5);
  const stuckIds = (stuck ?? []).map((s) => s.automation_intent_id as string).filter(Boolean);
  if (stuckIds.length > 0) {
    const { data: pending } = await db
      .from("automation_intents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .in("id", stuckIds);
    for (const intent of (pending ?? []) as Row[]) {
      const r = await enqueueAutomationExecution(db, {
        tenantId,
        automationIntentId: intent.id as string,
        triggeredBy: "repair",
        correlationId: null,
      });
      if (r.id && !r.duplicate) recovered += 1;
    }
  }

  // ── reconcile INTERNAL-action executions. Email steps reach their terminal
  // state through the existing marketing.delivery_sync reconciler (which calls
  // the same sequence reconciler); an internal action has no delivery row, so
  // it is reconciled here from its intent's own facts.
  let reconciled = 0;
  const { data: inflight } = await db
    .from("marketing_sequence_executions")
    .select("id, step_type")
    .eq("tenant_id", tenantId)
    .in("status", ["queued", "executing"])
    .neq("step_type", "send_email")
    .limit(50);
  for (const row of (inflight ?? []) as Row[]) {
    const r = await db.rpc("marketing_sequence_reconcile_execution", {
      p_tenant: tenantId,
      p_execution: row.id as string,
    });
    if (!r.error && (r.data as Row | null)?.changed === true) reconciled += 1;
  }

  // keep the delivery reconciler draining while sequence emails are in flight
  if (prepared > 0 || recovered > 0) {
    await enqueueJob(db, {
      tenantId,
      jobType: "marketing.delivery_sync",
      jobKey: `marketing.delivery_sync:${tenantId}`,
      moduleId: "marketing.senders",
      payload: { ttl: 30 },
    });
  }

  // continuation ONLY while genuinely claimable work remains — a paused or
  // cancelled campaign, a future wait and quiet hours all stop the claim query
  // itself, so this can never become a busy loop
  const { data: due } = await db.rpc("marketing_sequence_due", { p_limit: 200 });
  const remaining =
    ((due ?? []) as Row[]).find((d) => d.tenant_id === tenantId)?.due_enrolments ?? 0;

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
      reconciled,
      exits,
      due_remaining: remaining,
    },
  };
  if (Number(remaining) > 0 && executions.length > 0 && deferred === 0) {
    result.continuation = {
      jobType: "marketing.sequence_advance",
      jobKey: `marketing.sequence_advance:${tenantId}`,
      moduleId: "marketing.sequences",
      payload: {},
    };
  }
  return result;
}
