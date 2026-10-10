import type { EmailProtocolClient, EmailScope } from "./email_ingestion_protocol.ts";
export type EmailJobLease = { claimedBy: string; attemptCount: number };
export type EmailJobClaim = EmailJobLease & { tenantId: string; jobId: string };
export type EmailJobAttempt = EmailScope & {
  jobId: string;
  status: "running" | "success" | "failed";
  syncType: "messages" | "workspace_messages" | "workspace_backfill";
  recordsProcessed: number;
  recovered: boolean;
  leaseExpiresAt: string;
  payload: { email_account_id: string; max_results?: number; force?: boolean; restart?: boolean };
};
const uuid = (v: unknown) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
export function validateEmailJobLease(v: EmailJobLease) {
  if (
    !v ||
    typeof v.claimedBy !== "string" ||
    !v.claimedBy ||
    v.claimedBy.length > 200 ||
    !Number.isSafeInteger(v.attemptCount) ||
    v.attemptCount < 1 ||
    v.attemptCount > 2147483647
  )
    throw Error("Invalid email worker lease.");
}
/** Call only after capture admission. Creation of the run and binding is atomic.
 * A terminal result is recovery evidence, never permission to fetch another page.
 * Unknown outcomes are retried with the same queue identity, not a new run ID.
 */
export async function bindEmailJobAttempt(
  db: EmailProtocolClient,
  claim: EmailJobClaim,
  clock = Date.now,
): Promise<EmailJobAttempt> {
  validateEmailJobLease(claim);
  if (!uuid(claim.tenantId) || !uuid(claim.jobId)) throw Error("Invalid email queue identity.");
  const frozen = { ...claim };
  try {
    const { data, error } = await db.rpc("learn_email_job_attempt", {
      p_tenant: frozen.tenantId,
      p_job: frozen.jobId,
      p_claimed_by: frozen.claimedBy,
      p_claim: frozen.attemptCount,
    });
    const d = data as Record<string, any>,
      now = clock();
    if (
      error ||
      !d ||
      d.version !== "learn-email-job-attempt/1" ||
      d.tenant_id !== frozen.tenantId ||
      d.job_id !== frozen.jobId ||
      !uuid(d.email_account_id) ||
      !uuid(d.attempt_id) ||
      !["recent", "historical"].includes(d.stream) ||
      !["messages", "workspace_messages", "workspace_backfill"].includes(d.sync_type) ||
      (d.stream === "historical") !== (d.sync_type === "workspace_backfill") ||
      !["running", "success", "failed"].includes(d.status) ||
      !Number.isSafeInteger(d.records_processed) ||
      d.records_processed < 0 ||
      d.records_processed > 2147483647 ||
      typeof d.recovered !== "boolean" ||
      d.claimed_by !== frozen.claimedBy ||
      d.claim !== frozen.attemptCount ||
      !Number.isFinite(now) ||
      typeof d.lease_expires_at !== "string" ||
      !Number.isFinite(Date.parse(d.lease_expires_at)) ||
      Date.parse(d.lease_expires_at) <= now ||
      !d.payload ||
      typeof d.payload !== "object" ||
      Array.isArray(d.payload) ||
      typeof d.payload.email_account_id !== "string" ||
      d.payload.email_account_id.toLowerCase() !== d.email_account_id ||
      Object.keys(d.payload).some(
        (k) => !["email_account_id", "max_results", "force", "restart"].includes(k),
      ) ||
      ("max_results" in d.payload &&
        (!Number.isInteger(d.payload.max_results) ||
          d.payload.max_results < 1 ||
          d.payload.max_results > 500)) ||
      ["force", "restart"].some((k) => k in d.payload && typeof d.payload[k] !== "boolean")
    )
      throw Error();
    return {
      tenantId: d.tenant_id,
      jobId: d.job_id,
      accountId: d.email_account_id,
      attemptId: d.attempt_id,
      stream: d.stream,
      status: d.status,
      syncType: d.sync_type,
      recordsProcessed: d.records_processed,
      recovered: d.recovered,
      leaseExpiresAt: d.lease_expires_at,
      payload: structuredClone(d.payload),
    };
  } catch {
    throw Error(
      "Email job recovery could not be confirmed. Keep the same job and verify its current lease before continuing.",
    );
  }
}
