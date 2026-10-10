// Queue mailbox handlers use the durable engine directly. Discovery retains its endpoint.
import { invokeFunction } from "../phone_pipeline.ts";
import { handleEmailCapture } from "../email_capture_handler.ts";
import { isRetryable } from "../platform_queue.ts";
import type { WorkerHandlerContext, WorkerHandlerResult } from "./index.ts";

function serviceKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}
// All three capture types share the durable engine; discovery remains separate.
export const handleEmailGmailSync = handleEmailCapture;
export const handleEmailWorkspaceSync = handleEmailCapture;
export const handleEmailWorkspaceBackfill = handleEmailCapture;

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
