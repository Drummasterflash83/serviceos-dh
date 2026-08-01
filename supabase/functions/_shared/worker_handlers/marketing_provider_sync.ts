// Marketing Phase 9/10 — `marketing.provider_sync` worker handler.
//
// Claims queued provider sync runs (lease-safe, tenant-scoped) and dispatches
// each to its provider's adapter through the Phase-10 contract:
//   • no adapter (every REAL provider in this build) → the run completes
//     honestly as failed/'no_adapter' — nothing is polled, nothing invented;
//   • the deterministic test provider (env-gated) → the adapter's genuine
//     result drives the outcome: canonical facts are validated at the
//     contract boundary, recorded through the governed recorder, and the
//     completion outcome is COMPUTED from the adapter result — success is
//     never a literal this handler can assert;
//   • RETRYABLE provider failures (rate limit / temporary) leave the run
//     leased: lease expiry re-claims it and the attempts >= 10 ceiling
//     inside marketing_provider_sync_claim retires a poison run;
//   • revocation is re-checked immediately before any provider access.
//
// All writes go through governed RPCs. No cron schedules this job type;
// runs exist only for genuinely connected accounts.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import {
  errorClassFor,
  getProviderAdapter,
  validateCanonicalFacts,
} from "../marketing_provider_adapter_contract.ts";
import { connectionVaultProvider } from "../marketing_provider_connections.ts";

interface ClaimedRun {
  id: string;
  account_id: string;
  kind: string;
  attempts: number;
}

interface AccountRow {
  provider: string;
  status: string;
  external_account_ref: string | null;
}

export async function handleMarketingProviderSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin, tenantId } = ctx;
  const leaseRaw = Number(ctx.payload.lease_seconds);
  const leaseSeconds =
    Number.isFinite(leaseRaw) && leaseRaw >= 5 && leaseRaw <= 600 ? Math.floor(leaseRaw) : 300;

  const claimed = await supabaseAdmin.rpc("marketing_provider_sync_claim", {
    p_tenant: tenantId,
    p_worker: `provider-sync:${ctx.jobId ?? "manual"}`,
    p_batch: 5,
    p_lease_seconds: leaseSeconds,
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
  let leftLeased = 0;

  const complete = (runId: string, args: Record<string, unknown>) =>
    supabaseAdmin.rpc("marketing_provider_sync_complete", {
      p_tenant: tenantId,
      p_run: runId,
      p_args: args,
    });

  for (const run of runs) {
    // REVOCATION CHECK immediately before any provider access
    const acct = await supabaseAdmin
      .from("marketing_provider_accounts")
      .select("provider, status, external_account_ref")
      .eq("tenant_id", tenantId)
      .eq("id", run.account_id)
      .maybeSingle();
    const row = (acct.data ?? null) as AccountRow | null;
    if (acct.error || !row) {
      const done = await complete(run.id, { outcome: "failed", error_class: "account_missing" });
      if (done.error) return seamFailure(done.error.message);
      processed += 1;
      continue;
    }
    if (row.status === "revoked") {
      const done = await complete(run.id, { outcome: "failed", error_class: "account_revoked" });
      if (done.error) return seamFailure(done.error.message);
      processed += 1;
      continue;
    }

    const adapter = getProviderAdapter(row.provider, {
      testProviderEnabled: Deno.env.get("MARKETING_TEST_PROVIDER") === "enabled",
    });
    if (!adapter) {
      // TRUTHFUL: no adapter exists for any real provider in this build
      const done = await complete(run.id, { outcome: "failed", error_class: "no_adapter" });
      if (done.error) return seamFailure(done.error.message);
      processed += 1;
      continue;
    }

    const cred = await supabaseAdmin.rpc("provider_secret_read", {
      p_tenant: tenantId,
      p_provider: connectionVaultProvider(run.account_id),
      p_field: "credential_key",
    });
    if (cred.error || typeof cred.data !== "string" || cred.data.length === 0) {
      const done = await complete(run.id, {
        outcome: "failed",
        error_class: "credential_missing",
      });
      if (done.error) return seamFailure(done.error.message);
      processed += 1;
      continue;
    }

    const result = await adapter.fetchFacts({
      credential: cred.data,
      externalAccountRef: row.external_account_ref,
    });

    if (!result.ok) {
      if (result.error.retryable && run.attempts < 10) {
        // leave the run LEASED: lease expiry drives the retry; the claim's
        // attempts ceiling retires a poison run. Nothing is completed early.
        leftLeased += 1;
        continue;
      }
      const done = await complete(run.id, {
        outcome: "failed",
        error_class: errorClassFor(result.error),
      });
      if (done.error) return seamFailure(done.error.message);
      processed += 1;
      continue;
    }

    // the CONTRACT boundary: malformed canonical output never crosses
    const check = validateCanonicalFacts(result.facts);
    if (!check.ok) {
      const done = await complete(run.id, { outcome: "failed", error_class: "schema_invalid" });
      if (done.error) return seamFailure(done.error.message);
      processed += 1;
      continue;
    }

    if (check.facts.length > 0) {
      const recorded = await supabaseAdmin.rpc("marketing_provider_fact_record", {
        p_tenant: tenantId,
        p_run: run.id,
        p_args: { facts: check.facts },
      });
      if (recorded.error) {
        // the recorder refused (e.g. an out-of-bounds fact) — the run fails
        // honestly and records NOTHING further
        const done = await complete(run.id, { outcome: "failed", error_class: "fact_rejected" });
        if (done.error) return seamFailure(done.error.message);
        processed += 1;
        continue;
      }
    }

    // COMPUTED outcome — "succeeded" is reachable ONLY off the genuine
    // adapter result (result.ok && no partial failure); a partial metrics
    // failure is a truthful failure that keeps the recorded feed.
    const metricsError = result.partial?.metrics;
    const outcomeStatus = metricsError ? "failed" : "succeeded";
    const outcome = metricsError
      ? { outcome: outcomeStatus, error_class: "metrics_unavailable" }
      : { outcome: outcomeStatus, stats: { facts: check.facts.length, kind: run.kind } };
    const done = await complete(run.id, outcome);
    if (done.error) return seamFailure(done.error.message);
    processed += 1;
  }

  return {
    success: true,
    recordsProcessed: processed,
    result: { claimed: runs.length, left_leased: leftLeased },
    // a retryable failure left a run leased: re-prime the drain so the next
    // worker tick re-claims it once the lease lapses. Bounded: if nothing is
    // claimable the follow-on completes empty and requests no further work.
    ...(leftLeased > 0
      ? {
          continuation: {
            jobType: "marketing.provider_sync",
            jobKey: `mkpsync:${tenantId}`,
            payload: ctx.payload,
          },
        }
      : {}),
  };
}

function seamFailure(message: string): WorkerHandlerResult {
  return {
    success: false,
    error: { code: "complete_failed", message: message.slice(0, 500), retryable: true },
  };
}
