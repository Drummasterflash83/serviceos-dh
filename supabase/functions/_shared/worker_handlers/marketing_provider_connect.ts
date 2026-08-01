// Marketing Phase 10A — `marketing.provider_connect` worker handler.
//
// The SERVICE-ROLE half of the connection handshake. The user-facing API
// only ever moves an account into 'connecting' and queues this job; THIS
// handler — the same trust domain a reviewed provider adapter runs in —
// performs the genuine credential validation and reports the outcome
// through the governed adapter seam (marketing_provider_account_connect_result).
// A verified outcome carries the adapter's evidence + discovered accounts
// and asks the seam to queue the initial sync; a failed outcome lands the
// account honestly in error with a bounded reason. Nothing here can invent
// a connected state: verification is RELAYED from the adapter, never
// asserted.
//
// In this build only the deterministic test provider resolves an adapter,
// and only under MARKETING_TEST_PROVIDER=enabled. Every real provider
// reports 'no_adapter'.

import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";
import { errorClassFor, getProviderAdapter } from "../marketing_provider_adapter_contract.ts";
import { connectionVaultProvider } from "../marketing_provider_connections.ts";

interface AccountRow {
  id: string;
  provider: string;
  status: string;
}

export async function handleMarketingProviderConnect(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { supabaseAdmin, tenantId } = ctx;
  const accountId = typeof ctx.payload.account_id === "string" ? ctx.payload.account_id : null;
  if (!accountId) {
    return {
      success: false,
      error: { code: "invalid_payload", message: "account_id required", retryable: false },
    };
  }

  const acct = await supabaseAdmin
    .from("marketing_provider_accounts")
    .select("id, provider, status")
    .eq("tenant_id", tenantId)
    .eq("id", accountId)
    .maybeSingle();
  if (acct.error) {
    return {
      success: false,
      error: {
        code: "read_failed",
        message: acct.error.message.slice(0, 300),
        retryable: true,
      },
    };
  }
  const row = acct.data as AccountRow | null;
  if (!row || row.status !== "connecting") {
    // nothing to validate (revoked / already resolved / gone) — converge
    return { success: true, recordsProcessed: 0, result: { skipped: true } };
  }

  const report = (args: Record<string, unknown>) =>
    supabaseAdmin.rpc("marketing_provider_account_connect_result", {
      p_tenant: tenantId,
      p_account: accountId,
      p_args: args,
    });

  const adapter = getProviderAdapter(row.provider, {
    testProviderEnabled: Deno.env.get("MARKETING_TEST_PROVIDER") === "enabled",
  });
  if (!adapter) {
    const done = await report({ verified: false, reason: "no_adapter" });
    if (done.error) {
      return {
        success: false,
        error: { code: "seam_failed", message: done.error.message.slice(0, 300), retryable: true },
      };
    }
    return { success: true, recordsProcessed: 1, result: { outcome: "no_adapter" } };
  }

  const cred = await supabaseAdmin.rpc("provider_secret_read", {
    p_tenant: tenantId,
    p_provider: connectionVaultProvider(accountId),
    p_field: "credential_key",
  });
  if (cred.error || typeof cred.data !== "string" || cred.data.length === 0) {
    const done = await report({ verified: false, reason: "credential_missing" });
    if (done.error) {
      return {
        success: false,
        error: { code: "seam_failed", message: done.error.message.slice(0, 300), retryable: true },
      };
    }
    return { success: true, recordsProcessed: 1, result: { outcome: "credential_missing" } };
  }

  const validation = await adapter.validateConnection(cred.data);
  const outcome = validation.ok
    ? {
        verified: validation.ok, // relayed, never asserted
        adapter_version: adapter.version,
        evidence: validation.evidence,
        accounts: validation.accounts,
        queue_initial_sync: true,
      }
    : { verified: false, reason: errorClassFor(validation.error) };
  const done = await report(outcome);
  if (done.error) {
    return {
      success: false,
      error: { code: "seam_failed", message: done.error.message.slice(0, 300), retryable: true },
    };
  }
  return {
    success: true,
    recordsProcessed: 1,
    result: { outcome: validation.ok ? "validated" : "refused" },
  };
}
