type Db = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
export const phoneRunId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export type ScheduleJob = { tenantId: string; jobId: string; owner: string };
/** Claim once, then renew only the same live attempt. Never revive a lost lease. */
export async function ownPhoneSchedule(db: Db, job: ScheduleJob, claim = false): Promise<boolean> {
  try {
    const now = new Date();
    let query = db
      .from("platform_jobs")
      .update({
        lease_expires_at: new Date(now.getTime() + 300_000).toISOString(),
        ...(claim
          ? {
              status: "running",
              started_at: now.toISOString(),
              claimed_at: now.toISOString(),
              last_attempt_at: now.toISOString(),
              claimed_by: job.owner,
              attempt_count: 1,
            }
          : {}),
      })
      .eq("id", job.jobId)
      .eq("tenant_id", job.tenantId)
      .eq("job_type", "phone.scheduled_sync")
      .eq("status", claim ? "queued" : "running")
      .eq("attempt_count", claim ? 0 : 1);
    if (!claim) query = query.eq("claimed_by", job.owner).gt("lease_expires_at", now.toISOString());
    const saved = await query.select("id").maybeSingle();
    return !saved.error && saved.data?.id === job.jobId;
  } catch {
    return false;
  }
}
export function phoneChildResult(
  response: { status: number; json: Record<string, unknown> | null },
  expected: { from: string; to: string; customerId: string },
) {
  const body = response.json;
  const runId = phoneRunId(body?.sync_run_id) ? body.sync_run_id : null;
  const success =
    response.status >= 200 &&
    response.status < 300 &&
    body?.success === true &&
    runId !== null &&
    body.window_complete === true &&
    body.from === expected.from &&
    body.to === expected.to &&
    body.customer_id === expected.customerId &&
    Number.isSafeInteger(body.records_processed) &&
    (body.records_processed as number) >= 0 &&
    (body.records_processed as number) <= 10_000;
  const rawCode = (body?.error as { code?: unknown } | undefined)?.code;
  const code =
    !success &&
    body?.success === false &&
    typeof rawCode === "string" &&
    /^[a-z][a-z0-9_]{0,79}$/.test(rawCode)
      ? rawCode
      : "phone_child_unconfirmed";
  return { success, runId, code };
}
export type ScheduleSettlement = ScheduleJob & {
  runId: string;
  accountId: string;
  connectorId: string;
  customerId: string;
  from: string;
  to: string;
  callsRunId: string | null;
  recordingsRunId: string | null;
  outcome: "success" | "failed" | "paused";
  errors: Record<string, string>;
};
const unknown = () => ({ ok: false as const, code: "phone_schedule_unconfirmed" });
export async function settlePhoneSchedule(db: Db, input: ScheduleSettlement) {
  try {
    const { data, error } = await db.rpc("learn_phone_settle_schedule", {
      p_tenant: input.tenantId,
      p_run: input.runId,
      p_calls: input.callsRunId,
      p_recordings: input.recordingsRunId,
      p_outcome: input.outcome,
      p_errors: input.errors,
    });
    if (error) {
      if (
        error.code === "PT409" &&
        [
          "learn_capture_paused",
          "phone_account_unavailable",
          "phone_schedule_account_changed",
          "phone_schedule_job_changed",
        ].includes(error.message)
      )
        return { ok: false as const, code: error.message as string };
      return unknown();
    }
    if (
      !data ||
      data.version !== "learn-phone-schedule/1" ||
      data.tenantId !== input.tenantId ||
      data.runId !== input.runId ||
      data.accountId !== input.accountId ||
      data.connectorId !== input.connectorId ||
      data.customerId !== input.customerId ||
      data.jobId !== input.jobId ||
      data.outcome !== input.outcome ||
      data.from !== input.from ||
      data.to !== input.to ||
      data.callsRunId !== input.callsRunId ||
      data.recordingsRunId !== input.recordingsRunId ||
      data.cursorAdvanced !== (input.outcome === "success") ||
      ![data.callsProcessed, data.recordingsProcessed].every(
        (n) => Number.isSafeInteger(n) && n >= 0 && n <= 10_000,
      )
    )
      return unknown();
    return {
      ok: true as const,
      callsProcessed: data.callsProcessed as number,
      recordingsProcessed: data.recordingsProcessed as number,
    };
  } catch {
    return unknown();
  }
}
