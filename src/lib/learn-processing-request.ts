export interface ProcessingRequestReceipt {
  version: "learn-processing-request/1";
  success: true;
  accepted: true;
  job_id: string;
  job_type: "interactions.sync";
  source: "phone" | "email" | "all";
  status: string;
  already_running: boolean;
  checked_at: string;
}

export function processingRequestReceipt(
  value: unknown,
  source: "phone" | "email" | "all",
): ProcessingRequestReceipt | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    v.version !== "learn-processing-request/1" ||
    v.success !== true ||
    v.accepted !== true ||
    v.job_type !== "interactions.sync" ||
    v.source !== source ||
    typeof v.job_id !== "string" ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.job_id) ||
    typeof v.status !== "string" ||
    !["queued", "running", "retrying", "succeeded", "failed", "dead_letter", "cancelled"].includes(
      v.status,
    ) ||
    typeof v.already_running !== "boolean" ||
    typeof v.checked_at !== "string" ||
    !Number.isFinite(Date.parse(v.checked_at))
  )
    return null;
  return v as unknown as ProcessingRequestReceipt;
}

export function processingRequestMessage(receipt: ProcessingRequestReceipt): string {
  if (["failed", "dead_letter"].includes(receipt.status))
    return "The processing request needs attention. OpenFolk can review it; your existing timeline is retained.";
  if (receipt.status === "cancelled")
    return "The processing request was cancelled. Your existing timeline is retained.";
  if (receipt.status === "retrying")
    return "The processing request is waiting for another attempt. Your existing timeline is retained. Use Refresh to check for updates.";
  if (receipt.status === "succeeded")
    return "The first batch has finished. Further batches may still be queued; use Refresh to see saved timeline updates.";
  return receipt.already_running
    ? "A processing request is already queued or running. Timeline updates appear as batches finish; use Refresh to check."
    : "Your request is saved and waiting for processing. Timeline updates appear as batches finish; use Refresh to check.";
}
