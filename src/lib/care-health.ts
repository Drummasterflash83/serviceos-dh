export type CareSummary = {
  monitoring: {
    enabled: boolean;
    last_scan_at?: string | null;
    scan_state: string;
    scan_error?: string | null;
    daily_limit?: number;
  };
  reviews: {
    observed: number;
    reviewed: number;
    queued: number;
    processing: number;
    failed: number;
    awaiting_evidence: number;
  };
  alerts: { pending: number; failed: number; delivery_unknown: number; sent: number };
  practice: { total: number; completed: number; with_feedback: number };
};
export function careHealth(summary: CareSummary, now = Date.now()) {
  const m = summary.monitoring,
    r = summary.reviews,
    a = summary.alerts;
  const scanned = m.last_scan_at ? Date.parse(m.last_scan_at) : NaN;
  if (!m.enabled)
    return {
      tone: "waiting",
      title: "Awaiting activation",
      detail: "Approve the review rules and connect the background service.",
    };
  if (m.scan_error || m.scan_state === "failed" || r.failed || a.failed || a.delivery_unknown)
    return {
      tone: "attention",
      title: "A check needs attention",
      detail: "OpenFolk has unfinished checks or an unconfirmed alert. Review the queue below.",
    };
  if (!Number.isFinite(scanned))
    return {
      tone: "waiting",
      title: "First check pending",
      detail: "Review is enabled. A completed background check has not been recorded yet.",
    };
  if (now - scanned > 300000 || scanned > now + 60000)
    return {
      tone: "attention",
      title: "Check-in overdue",
      detail: "The last completed scan is not recent. Do not assume monitoring is running.",
    };
  if (r.queued || r.processing || r.awaiting_evidence)
    return {
      tone: "working",
      title: "Reviews are in progress",
      detail: "Recent calls are safely queued. Coverage is shown below, not assumed.",
    };
  if (!r.observed)
    return {
      tone: "waiting",
      title: "Awaiting call evidence",
      detail: "The latest scan completed. There are no observed calls to assess yet.",
    };
  return {
    tone: "good",
    title: "Last check complete",
    detail:
      "The observed queue is up to date. This is a transcript check, not an audio-quality guarantee.",
  };
}
