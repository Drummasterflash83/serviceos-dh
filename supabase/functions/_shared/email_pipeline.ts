// ServiceOS — shared email pipeline helpers (Deno).
//
// Reuses the generic internal invoker (service-role bearer + x-internal-tenant-id,
// see _shared/authz.ts) to drive the existing, queue-submission
// gmail-sync-messages function headlessly — no Gmail logic is duplicated here.

import { invokeFunction } from "./phone_pipeline.ts";

export interface MailboxSyncResult {
  ok: boolean;
  state: "queued" | "unconfirmed";
  jobId: string | null;
  /** Short error code when !ok (never contains tokens). */
  code: string | null;
}

/**
 * Queue one connected mailbox by invoking a Gmail submission function with the
 * service-role key. `tenant_id` in the body becomes the x-internal-tenant-id
 * header (via invokeFunction) so the internal auth path binds the tenant.
 * `functionName` selects the OAuth (`gmail-sync-messages`, default) or the
 * Workspace DWD (`gmail-workspace-sync-messages`) sync.
 */
export async function syncGmailMailbox(opts: {
  tenantId: string;
  emailAccountId: string;
  maxResults: number;
  serviceKey: string;
  functionName?: string;
}): Promise<MailboxSyncResult> {
  const { status, json } = await invokeFunction(
    opts.functionName ?? "gmail-sync-messages",
    {
      tenant_id: opts.tenantId,
      email_account_id: opts.emailAccountId,
      max_results: opts.maxResults,
    },
    opts.serviceKey,
  );
  const ok =
    status === 202 &&
    json?.success === true &&
    json?.state === "queued" &&
    json?.version === "learn-email-enqueue/1" &&
    json?.email_account_id === opts.emailAccountId.toLowerCase() &&
    typeof json?.job_id === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(json.job_id);
  const err = (json?.error ?? {}) as { code?: unknown };
  return {
    ok,
    state: ok ? "queued" : "unconfirmed",
    jobId: ok ? (json.job_id as string) : null,
    code: ok ? null : typeof err.code === "string" ? err.code : `http_${status || "network"}`,
  };
}
