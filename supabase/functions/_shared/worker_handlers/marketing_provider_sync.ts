// Marketing Phase 9 — `marketing.provider_sync` worker handler.
//
// Claims queued provider sync runs (lease-safe, tenant-scoped) and dispatches
// each to its provider's SYNC adapter. In this build ZERO sync adapters
// exist, so every claimed run completes honestly as failed/'no_adapter' —
// nothing is polled, nothing is fabricated, and the failure is visible in
// the freshness projection. A future reviewed adapter replaces the dispatch
// below with a genuine pull; the claim/complete contract (including the
// attempts >= 10 poison ceiling inside marketing_provider_sync_claim) does
// not change.
//
// NOTE: nothing schedules this job type in this build — no cron is
// registered and marketing_provider_sync_due is never called on a timer.
// Runs can only exist for a genuinely connected account (MK430 otherwise),
// and no account can be connected without a reviewed adapter.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { syncAdapterImplemented } from "../marketing_provider_connections.ts";

interface ClaimedRun {
  id: string;
  account_id: string;
  kind: string;
  attempts: number;
}

export async function handleMarketingProviderSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin, tenantId } = ctx;

  const claimed = await supabaseAdmin.rpc("marketing_provider_sync_claim", {
    p_tenant: tenantId,
    p_worker: `provider-sync:${ctx.jobId ?? "manual"}`,
    p_batch: 5,
    p_lease_seconds: 300,
  });
  if (claimed.error) {
    return {
      success: false,
      error: {
        code: "claim_failed",
        message: claimed.error.message.slice(0, 500),
        retryable: true,
        failedStep: "claim",
      },
    };
  }

  const runs = (claimed.data ?? []) as ClaimedRun[];
  let processed = 0;
  for (const run of runs) {
    // Resolve the run's provider through its account (tenant-bound read).
    const acct = await supabaseAdmin
      .from("marketing_provider_accounts")
      .select("provider")
      .eq("tenant_id", tenantId)
      .eq("id", run.account_id)
      .maybeSingle();
    const provider = acct.data?.provider ?? "unknown";

    // TRUTHFUL dispatch: no sync adapter exists in this build, so the run
    // fails with the honest class. When an adapter ships, this branch calls
    // it and reports its real outcome instead.
    const outcome = syncAdapterImplemented(provider)
      ? { outcome: "failed", error_class: "adapter_dispatch_missing" }
      : { outcome: "failed", error_class: "no_adapter" };

    const done = await supabaseAdmin.rpc("marketing_provider_sync_complete", {
      p_tenant: tenantId,
      p_run: run.id,
      p_args: outcome,
    });
    if (done.error) {
      return {
        success: false,
        error: {
          code: "complete_failed",
          message: done.error.message.slice(0, 500),
          retryable: true,
          failedStep: "complete",
        },
      };
    }
    processed += 1;
  }

  return {
    success: true,
    recordsProcessed: processed,
    result: { claimed: runs.length },
  };
}
