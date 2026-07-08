// ServiceOS — shared email pipeline helpers (Deno).
//
// Reuses the generic internal invoker (service-role bearer + x-internal-tenant-id,
// see _shared/authz.ts) to drive the existing, already-idempotent
// gmail-sync-messages function headlessly — no Gmail logic is duplicated here.

import { invokeFunction } from "./phone_pipeline.ts";

export interface MailboxSyncResult {
  ok: boolean;
  recordsProcessed: number;
  syncRunId: string | null;
  /** Short error code when !ok (never contains tokens). */
  code: string | null;
}

/**
 * Sync one connected mailbox by invoking gmail-sync-messages with the
 * service-role key. `tenant_id` in the body becomes the x-internal-tenant-id
 * header (via invokeFunction) so the internal auth path binds the tenant.
 */
export async function syncGmailMailbox(opts: {
  tenantId: string;
  emailAccountId: string;
  maxResults: number;
  serviceKey: string;
}): Promise<MailboxSyncResult> {
  const { status, json } = await invokeFunction(
    "gmail-sync-messages",
    {
      tenant_id: opts.tenantId,
      email_account_id: opts.emailAccountId,
      max_results: opts.maxResults,
    },
    opts.serviceKey,
  );
  const ok = Boolean(json?.success);
  const err = (json?.error ?? {}) as { code?: unknown };
  return {
    ok,
    recordsProcessed:
      typeof json?.records_processed === "number" ? json.records_processed : 0,
    syncRunId: typeof json?.sync_run_id === "string" ? json.sync_run_id : null,
    code: ok ? null : typeof err.code === "string" ? err.code : `http_${status || "network"}`,
  };
}
