import type { EmailCaptureQueuedResult } from "./types.ts";
/** Do not render old synchronous or malformed success responses as queued work. */
export function isEmailCaptureQueued(
  value: unknown,
  accountId: string,
): value is EmailCaptureQueuedResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === "learn-email-enqueue/1" &&
    v.success === true &&
    v.state === "queued" &&
    v.provider === "gmail" &&
    v.email_account_id === accountId.trim().toLowerCase() &&
    typeof v.job_id === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.job_id) &&
    typeof v.duplicate === "boolean"
  );
}
