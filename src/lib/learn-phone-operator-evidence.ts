import { CADENCE_SEC, freshnessVerdict } from "./health-model.ts";
export type PhoneAccountEvidence = {
  version: "learn-phone-account-evidence/1";
  tenant_id: string;
  account_id: string;
  scope: "scheduled_capture";
  capture_allowed: boolean;
  latest_attempt: null | {
    id: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    confirmed: boolean;
    job: null | {
      id: string;
      status: string;
      lease_expires_at: string | null;
      ownership_current: boolean;
    };
  };
  last_confirmed: null | {
    id: string;
    completed_at: string;
    from: string;
    to: string;
    calls_processed: number;
    recordings_processed: number;
  };
};
export type PhoneProcessingEvidence = {
  version: "learn-phone-processing-evidence/1";
  tenant_id: string;
  scope: "company";
  total: number;
  complete: number;
  download_pending: number;
  transcribe_pending: number;
  analyse_pending: number;
  needs_review: number;
  cooling_down: number;
  recent_processing: number;
  ready: number;
  waiting_provider: number;
  unknown_retry: number;
};
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: any) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const date = (v: any) => typeof v === "string" && Number.isFinite(Date.parse(v));
const count = (v: any) => Number.isSafeInteger(v) && v >= 0;
export function validPhoneAccountEvidence(
  v: any,
  tenant: string,
  account: string,
): v is PhoneAccountEvidence {
  if (
    !object(v) ||
    v.version !== "learn-phone-account-evidence/1" ||
    v.tenant_id !== tenant ||
    v.account_id !== account ||
    v.scope !== "scheduled_capture" ||
    typeof v.capture_allowed !== "boolean"
  )
    return false;
  const a = v.latest_attempt,
    c = v.last_confirmed;
  if (
    a !== null &&
    (!object(a) ||
      !uuid(a.id) ||
      !["running", "success", "failed", "paused", "unknown"].includes(a.status) ||
      !date(a.started_at) ||
      !(a.completed_at === null || date(a.completed_at)) ||
      typeof a.confirmed !== "boolean" ||
      (a.confirmed &&
        (!["success", "failed", "paused"].includes(a.status) ||
          !date(a.completed_at) ||
          Date.parse(a.completed_at) < Date.parse(a.started_at))) ||
      (a.job !== null &&
        (!object(a.job) ||
          !uuid(a.job.id) ||
          ![
            "queued",
            "running",
            "retrying",
            "succeeded",
            "failed",
            "dead_letter",
            "cancelled",
            "unknown",
          ].includes(a.job.status) ||
          !(a.job.lease_expires_at === null || date(a.job.lease_expires_at)) ||
          typeof a.job.ownership_current !== "boolean")) ||
      (a.confirmed &&
        a.job?.status !==
          (
            { success: "succeeded", failed: "failed", paused: "cancelled" } as Record<
              string,
              string
            >
          )[a.status]))
  )
    return false;
  if (
    c !== null &&
    (!object(c) ||
      !uuid(c.id) ||
      ![c.completed_at, c.from, c.to].every(date) ||
      Date.parse(c.from) >= Date.parse(c.to) ||
      !count(c.calls_processed) ||
      !count(c.recordings_processed))
  )
    return false;
  if (a?.confirmed && a.status === "success" && c?.id !== a.id) return false;
  if (c !== null && (!a || (a.id === c.id && (!a.confirmed || a.status !== "success"))))
    return false;
  return true;
}
export function validPhoneProcessingEvidence(v: any, tenant: string): v is PhoneProcessingEvidence {
  if (
    !object(v) ||
    v.version !== "learn-phone-processing-evidence/1" ||
    v.tenant_id !== tenant ||
    v.scope !== "company"
  )
    return false;
  const stages = [v.complete, v.download_pending, v.transcribe_pending, v.analyse_pending];
  const states = [
    v.needs_review,
    v.cooling_down,
    v.recent_processing,
    v.ready,
    v.waiting_provider,
    v.unknown_retry,
  ];
  return (
    count(v.total) &&
    [...stages, ...states].every(count) &&
    stages.reduce((a, b) => a + b, 0) === v.total &&
    states.reduce((a, b) => a + b, 0) === v.total - v.complete
  );
}
export function phoneCaptureSignal(
  e: PhoneAccountEvidence | undefined | null,
  lastFailure: string | null,
  now: number,
) {
  const attention = (label: string, action: string) => ({
    label,
    action,
    tone: "attention" as const,
  });
  const quiet = (label: string, action: string) => ({ label, action, tone: "quiet" as const });
  if (!e)
    return attention(
      "Scheduled Phone capture needs verification",
      "Check the Phone import history. An account timestamp alone does not confirm a completed import.",
    );
  if (!e.capture_allowed)
    return quiet(
      "Phone capture paused",
      "Review the company Phone capture switch before resuming. Retained calls and recordings remain available.",
    );
  const a = e.latest_attempt,
    c = e.last_confirmed;
  if (
    !Number.isFinite(now) ||
    [a?.started_at, a?.completed_at, c?.completed_at, c?.to].some((t) => t && Date.parse(t) > now)
  )
    return attention(
      "Phone timestamps need review",
      "Check the worker clock and refresh the recorded evidence.",
    );
  if (a && !a.confirmed) {
    if (
      a.status === "running" &&
      a.job?.status === "running" &&
      a.job.ownership_current &&
      a.job.lease_expires_at &&
      Date.parse(a.job.lease_expires_at) > now
    )
      return quiet(
        "Phone import running",
        "The saved job has a current claim. Check its result before starting another import.",
      );
    return attention(
      "Phone import needs reconciliation",
      "Check the retained run, job and completion receipt before retrying. Existing source records remain available.",
    );
  }
  if (a?.status === "paused")
    return quiet(
      "Latest Phone import paused",
      "Check capture permission and the existing connection before resuming from the saved position.",
    );
  if (a?.status === "failed")
    return attention(
      "Latest Phone import needs attention",
      "Review the saved run and connection, resolve the cause, then resume from the retained cursor.",
    );
  if (!c)
    return attention(
      "No confirmed scheduled Phone capture",
      "Check the registered account and capture schedule. Retained recordings and manual imports are reviewed separately.",
    );
  if (lastFailure && Date.parse(lastFailure) > Date.parse(c.completed_at))
    return attention(
      "Phone has a newer recorded issue",
      "Review the latest connection issue before treating this account as current.",
    );
  if (freshnessVerdict(c.to, CADENCE_SEC.phoneSync, now) !== "healthy")
    return attention(
      "Confirmed Phone capture is not current",
      "Check the schedule and latest run. Resume from the saved position and verify a new completed window.",
    );
  return {
    label: "Recent Phone window confirmed",
    action:
      "The saved window is confirmed. Schedule configuration, recording processing and voicemail coverage still need their own checks.",
    tone: "current" as const,
  };
}
export function phoneProcessingSignal(p: PhoneProcessingEvidence) {
  if (!p.total)
    return {
      label: "No retained recordings",
      action:
        "Check account setup and provider coverage before assuming recording capture is running.",
    };
  if (p.needs_review || p.unknown_retry)
    return {
      label: "Some recordings need review",
      action:
        "Inspect the held recordings and resolve their processing issue before retrying. Keep their audio and attempt history.",
    };
  if (p.total > p.complete)
    return {
      label: "Recording processing is incomplete",
      action:
        "Check the existing recovery job. Preserve retry pacing and provider waiting periods; avoid duplicate processing.",
    };
  return {
    label: "Retained recordings have audio, transcripts and analysis",
    action:
      "This covers stored recordings only. It does not establish complete provider capture, voicemail coverage or conversion into LEARN cards.",
  };
}
