import {
  validPhoneAccountEvidence,
  validPhoneProcessingEvidence,
  phoneCaptureSignal,
  type PhoneAccountEvidence,
  type PhoneProcessingEvidence,
} from "./learn-phone-operator-evidence.ts";
import { CADENCE_SEC, freshnessVerdict } from "./health-model.ts";
import type { OperatorInputClient } from "./learn-operator-inputs.ts";
export type CaptureSource = "email" | "phone" | "slack";
export type CaptureHealthRow = {
  key: string;
  id: string;
  source: CaptureSource;
  provider: string;
  label: string;
  enabled: boolean | null;
  account_state: string;
  auth_state: string;
  last_success_at: string | null;
  last_attempt_at: string | null;
  last_failure_at: string | null;
  latest_job: null | {
    id: string;
    status: string;
    available_at: string | null;
    lease_expires_at: string | null;
    completed_at: string | null;
  };
  bounded_complete: boolean | null;
  phone_evidence?: PhoneAccountEvidence | null;
};
export type CaptureHealthPage = {
  version: "learn-operator-capture-health/1";
  tenant_id: string;
  checked_at: string;
  rows: CaptureHealthRow[];
  next_cursor: string | null;
  phone_processing?: PhoneProcessingEvidence | null;
};
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: any) =>
  typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const cursor = (v: any) =>
  typeof v === "string" &&
  /^(email|phone|slack):[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const date = (v: any) => typeof v === "string" && Number.isFinite(Date.parse(v));
const maybeDate = (v: any) => v === null || date(v);
export async function readCaptureHealth(
  db: OperatorInputClient,
  tenant: string,
  after: string | null = null,
): Promise<CaptureHealthPage> {
  if (!uuid(tenant) || (after !== null && !cursor(after)))
    throw Error("Invalid capture status request.");
  const { data: d, error } = await db.rpc("learn_operator_capture_health", {
    p_tenant: tenant,
    p_after: after,
  });
  const v = d as CaptureHealthPage;
  if (
    error ||
    !object(d) ||
    v.version !== "learn-operator-capture-health/1" ||
    v.tenant_id !== tenant ||
    !date(v.checked_at) ||
    (v.phone_processing != null && !validPhoneProcessingEvidence(v.phone_processing, tenant)) ||
    !Array.isArray(v.rows) ||
    v.rows.length > 50 ||
    v.rows.some(
      (r, i) =>
        !object(r) ||
        !uuid(r.id) ||
        !["email", "phone", "slack"].includes(r.source) ||
        r.key !== `${r.source}:${r.id}` ||
        (after !== null && r.key <= after) ||
        (i > 0 && r.key <= v.rows[i - 1].key) ||
        (r.source === "email"
          ? !["gmail", "google_workspace", "other_email"].includes(r.provider)
          : r.provider !== (r.source === "phone" ? "simwood" : "slack")) ||
        typeof r.label !== "string" ||
        r.label.length > 120 ||
        !["gmail", "google_workspace", "other_email", "simwood", "slack"].includes(r.provider) ||
        ![
          "active",
          "active_dwd",
          "pending_tokenless_dwd",
          "disabled",
          "paused",
          "revoked",
          "unknown",
        ].includes(r.account_state) ||
        !["ok", "expired", "revoked", "needs_reconnect", "unknown"].includes(r.auth_state) ||
        !(r.enabled === null || typeof r.enabled === "boolean") ||
        !(r.bounded_complete === null || typeof r.bounded_complete === "boolean") ||
        ![r.last_success_at, r.last_failure_at, r.last_attempt_at].every(maybeDate) ||
        (r.phone_evidence != null &&
          (r.source !== "phone" || !validPhoneAccountEvidence(r.phone_evidence, tenant, r.id))) ||
        (r.latest_job !== null &&
          (!object(r.latest_job) ||
            !uuid(r.latest_job.id) ||
            ![
              "queued",
              "running",
              "retrying",
              "succeeded",
              "dead_letter",
              "cancelled",
              "unknown",
            ].includes(r.latest_job.status) ||
            ![
              r.latest_job.available_at,
              r.latest_job.lease_expires_at,
              r.latest_job.completed_at,
            ].every(maybeDate))),
    ) ||
    !(
      v.next_cursor === null ||
      (cursor(v.next_cursor) && v.rows.length === 50 && v.next_cursor === v.rows.at(-1)?.key)
    )
  )
    throw Error("Capture status could not be verified. Refresh or check the service deployment.");
  return v;
}
export function captureHealthSignal(
  r: CaptureHealthRow,
  now = Date.now(),
): { label: string; action: string; tone: "quiet" | "attention" | "current" } {
  const attention = (label: string, action: string) => ({
    label,
    action,
    tone: "attention" as const,
  });
  if (r.enabled === false || ["disabled", "paused", "revoked"].includes(r.account_state))
    return {
      label: "Capture paused",
      action:
        "Review the existing connector and account settings before enabling new capture. Retained records remain available.",
      tone: "quiet",
    };
  if (["expired", "revoked", "needs_reconnect"].includes(r.auth_state))
    return attention(
      "Connection needs attention",
      "Reconnect the existing mailbox through its account setup, then verify a successful capture.",
    );
  if (
    r.account_state === "unknown" ||
    (r.source !== "email" && r.enabled === null) ||
    r.provider === "other_email" ||
    !Number.isFinite(now)
  )
    return attention(
      "Status needs verification",
      "Check this account’s configuration and current worker status.",
    );
  const future = [
    r.last_success_at,
    r.last_failure_at,
    r.last_attempt_at,
    r.latest_job?.completed_at,
  ].some((t) => t && Date.parse(t) > now);
  if (future)
    return attention(
      "Status timestamps need review",
      "Check the worker clock and refresh the recorded evidence.",
    );
  if (r.source === "phone") return phoneCaptureSignal(r.phone_evidence, r.last_failure_at, now);
  if (r.source === "slack") {
    const j = r.latest_job;
    if (!j)
      return attention(
        "No channel import recorded",
        "Review Slack connection and channel approval. No continuous capture is established.",
      );
    if (j.status === "dead_letter")
      return attention(
        "Channel import needs recovery",
        "Review the saved Slack history request and recover it from its retained checkpoint.",
      );
    if (j.status === "running")
      return attention(
        j.lease_expires_at && Date.parse(j.lease_expires_at) > now
          ? "Channel import running"
          : "Worker recovery needed",
        "Check the existing worker job before approving more work.",
      );
    if (j.status === "queued" || j.status === "retrying")
      return attention(
        "Channel import waiting",
        j.available_at && Date.parse(j.available_at) > now
          ? "The existing job is scheduled for later. Preserve its pacing and check again after that time."
          : "Check the Slack worker and its existing approval; do not start a duplicate import.",
      );
    if (j.status === "succeeded" && r.bounded_complete === true)
      return {
        label: "Approved channel window captured",
        action:
          "Review window coverage and thread imports separately. This does not establish continuous Slack capture.",
        tone: "quiet",
      };
    return attention(
      "Channel history needs review",
      "Review the retained page limit, approval and checkpoint before continuing.",
    );
  }
  if (
    r.last_failure_at &&
    (!r.last_success_at || Date.parse(r.last_failure_at) >= Date.parse(r.last_success_at))
  )
    return attention(
      "Latest capture needs attention",
      "Check this account’s most recent sync and connection. Resume from the saved position after resolving the cause.",
    );
  const cadence = r.provider === "gmail" ? CADENCE_SEC.emailGmail : CADENCE_SEC.emailWorkspace;
  const fresh = freshnessVerdict(r.last_success_at, cadence, now);
  if (fresh === "never")
    return attention(
      "No successful capture recorded",
      "Check account access and the capture worker before treating this source as current.",
    );
  if (fresh !== "healthy")
    return attention(
      "Capture is not current",
      "Check the capture schedule and latest worker run. Verify a new successful sync before marking this input current.",
    );
  return {
    label: "Recent capture recorded",
    action: "Historical coverage and conversion into LEARN records need their own checks.",
    tone: "current",
  };
}
