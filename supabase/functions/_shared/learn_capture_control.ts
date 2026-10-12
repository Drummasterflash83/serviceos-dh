/** One admission check per bounded capture batch. No credentials or source data.
 * An admitted batch may finish after a pause; the next batch must check again.
 */
export type CaptureSource = "email" | "phone" | "slack";
export type CaptureAdmission =
  | { allowed: true }
  | {
      allowed: false;
      reason: "paused" | "unavailable";
      code: string;
      message: string;
      httpStatus: number;
    };
type Db = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const denied = (reason: "paused" | "unavailable"): CaptureAdmission => ({
  allowed: false,
  reason,
  code: `learn_capture_${reason}`,
  message:
    reason === "paused"
      ? "Capture is paused. Existing records remain available."
      : "Capture settings could not be verified. Please try again shortly.",
  httpStatus: reason === "paused" ? 409 : 503,
});
export async function captureAdmission(
  db: Db,
  tenantId: string,
  source: CaptureSource,
  clock = Date.now,
): Promise<CaptureAdmission> {
  if (!uuid(tenantId) || !["email", "phone", "slack"].includes(source))
    return denied("unavailable");
  try {
    const { data, error } = await db.rpc("learn_capture_admission", {
      p_tenant: tenantId,
      p_source: source,
    });
    const at = Date.parse(data?.checked_at),
      now = clock();
    if (
      error ||
      !data ||
      data.version !== "learn-capture-admission/1" ||
      data.tenant_id !== tenantId ||
      data.source !== source ||
      typeof data.allowed !== "boolean" ||
      !Number.isFinite(at) ||
      !Number.isFinite(now) ||
      at > now + 5000 ||
      now - at > 30000
    )
      return denied("unavailable");
    return data.allowed ? { allowed: true } : denied("paused");
  } catch {
    return denied("unavailable");
  }
}
export const captureSourceForJob = (jobType: string): CaptureSource | null =>
  [
    "email.gmail_sync",
    "email.workspace_sync",
    "email.workspace_backfill",
    "email.mailbox_discovery",
    "email.microsoft_discovery",
    "email.microsoft_sync",
  ].includes(jobType)
    ? "email"
    : ["slack.history_sync", "slack.thread_sync"].includes(jobType)
      ? "slack"
      : null;
export async function deferCaptureJob(
  db: Db,
  job: { tenantId: string; jobId: string; claimedBy: string; attempt: number },
  reason: "paused" | "unavailable",
) {
  const { data, error } = await db.rpc("learn_capture_defer_job", {
    p_tenant: job.tenantId,
    p_job: job.jobId,
    p_claimed_by: job.claimedBy,
    p_attempt: job.attempt,
    p_reason: reason,
  });
  if (
    error ||
    data?.job_id !== job.jobId ||
    data?.state !== "waiting" ||
    data?.reason !== reason ||
    data?.attempt_count !== job.attempt - 1
  )
    throw Error("learn_capture_deferral_unconfirmed");
  return data;
}
