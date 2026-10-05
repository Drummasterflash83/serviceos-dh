// ServiceOS — Worker handlers: email.* (queue-driven, one mailbox per job).
//
// Each handler processes ONE unit of email work by invoking the existing,
// idempotent Edge Function over the internal service path (the phone pattern —
// no Gmail/Workspace logic is duplicated here). The scheduler enqueues one job
// per account/mailbox and returns fast; the platform-worker claims them, so a
// slow or failing mailbox never blocks the scheduler or the other mailboxes.
//
// Retryability comes from the classified error code (platform_queue.isRetryable):
// permanent auth/delegation codes dead-letter; transient provider codes retry.

import { invokeFunction } from "../phone_pipeline.ts";
import { syncGmailMailbox } from "../email_pipeline.ts";
import { isRetryable } from "../platform_queue.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

function accountIdOf(payload: Record<string, unknown>): string | null {
  const id = typeof payload.email_account_id === "string" ? payload.email_account_id.trim() : "";
  return id || null;
}
function clampMax(v: unknown, def: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : def;
  return Math.max(1, Math.min(100, n));
}
function serviceKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

/** Map a mailbox-sync result to the worker contract. */
function fromMailboxResult(res: {
  ok: boolean;
  recordsProcessed: number;
  syncRunId: string | null;
  code: string | null;
}): WorkerHandlerResult {
  if (res.ok) {
    return {
      success: true,
      recordsProcessed: res.recordsProcessed,
      result: { records: res.recordsProcessed, sync_run_id: res.syncRunId },
    };
  }
  const code = res.code ?? "email_sync_failed";
  return {
    success: false,
    recordsProcessed: 0,
    result: { error_code: code, sync_run_id: res.syncRunId },
    error: { code, message: `email sync failed (${code})`, retryable: isRetryable(code) },
  };
}

/** email.gmail_sync — one OAuth Gmail mailbox. */
export async function handleEmailGmailSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const accountId = accountIdOf(ctx.payload);
  if (!accountId) {
    return {
      success: false,
      error: { code: "invalid_input", message: "email_account_id required", retryable: false },
    };
  }
  const res = await syncGmailMailbox({
    tenantId: ctx.tenantId,
    emailAccountId: accountId,
    maxResults: clampMax(ctx.payload.max_results, 50),
    serviceKey: serviceKey(),
    functionName: "gmail-sync-messages",
  });
  return fromMailboxResult(res);
}

/** email.workspace_sync — one DWD mailbox (live incremental). */
export async function handleEmailWorkspaceSync(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const accountId = accountIdOf(ctx.payload);
  if (!accountId) {
    return {
      success: false,
      error: { code: "invalid_input", message: "email_account_id required", retryable: false },
    };
  }
  const res = await syncGmailMailbox({
    tenantId: ctx.tenantId,
    emailAccountId: accountId,
    maxResults: clampMax(ctx.payload.max_results, 25),
    serviceKey: serviceKey(),
    functionName: "gmail-workspace-sync-messages",
  });
  return fromMailboxResult(res);
}

/** email.workspace_backfill — one DWD mailbox, one historical page (lower priority). */
export async function handleEmailWorkspaceBackfill(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const accountId = accountIdOf(ctx.payload);
  if (!accountId) {
    return {
      success: false,
      error: { code: "invalid_input", message: "email_account_id required", retryable: false },
    };
  }
  const { status, json } = await invokeFunction(
    "gmail-workspace-backfill-messages",
    {
      tenant_id: ctx.tenantId,
      email_account_id: accountId,
      ...(ctx.payload.restart === true ? { restart: true } : {}),
    },
    serviceKey(),
  );
  if (json?.success) {
    const records = typeof json.records_processed === "number" ? json.records_processed : 0;
    return {
      success: true,
      recordsProcessed: records,
      result: { records, backfill_status: json.backfill_status ?? null },
    };
  }
  const err = (json?.error ?? {}) as { code?: unknown };
  const code = typeof err.code === "string" ? err.code : `http_${status || "network"}`;
  return {
    success: false,
    result: { error_code: code },
    error: { code, message: `workspace backfill failed (${code})`, retryable: isRetryable(code) },
  };
}

/** email.mailbox_discovery — refresh the tenant's DWD mailbox list (auto-discovery). */
export async function handleEmailMailboxDiscovery(
  ctx: WorkerHandlerContext,
): Promise<WorkerHandlerResult> {
  const { status, json } = await invokeFunction(
    "google-workspace-discover-mailboxes",
    { tenant_id: ctx.tenantId },
    serviceKey(),
  );
  if (json?.success) {
    const discovered = typeof json.discovered === "number" ? json.discovered : 0;
    return {
      success: true,
      recordsProcessed: discovered,
      result: {
        discovered,
        added: json.added ?? null,
        removed: json.removed ?? null,
        skipped: json.skipped ?? null,
      },
    };
  }
  const err = (json?.error ?? {}) as { code?: unknown };
  const code = typeof err.code === "string" ? err.code : `http_${status || "network"}`;
  return {
    success: false,
    result: { error_code: code },
    error: { code, message: `mailbox discovery failed (${code})`, retryable: isRetryable(code) },
  };
}
