import { practiceCallMatches } from "./receptionist-web-call.ts";
import { record } from "./receptionist-data.ts";

export const AUTO_REVIEW_LIMIT = 2;
export const AUTO_REVIEW_PAGE_SIZE = 100;
export const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

export function liveCallOwned(call: unknown, assistantId: string) {
  const c = record(call);
  return (
    uuid(c.id) &&
    c.assistantId === assistantId &&
    (c.type === "inboundPhoneCall" || c.type === "outboundPhoneCall")
  );
}

export function queuedCallOwned(
  call: unknown,
  row: {
    call_id: string;
    call_kind: string;
    tenant_id: string;
    practice_session_id: string | null;
  },
  assistantId: string,
) {
  const c = record(call);
  if (c.id !== row.call_id) return false;
  return row.call_kind === "practice"
    ? !!row.practice_session_id && practiceCallMatches(c, row.practice_session_id, row.tenant_id)
    : liveCallOwned(c, assistantId);
}

// Vapi's documented newest-first listing is inspected, not trusted implicitly:
// a malformed/non-advancing page cannot silently move the scan watermark.
export function reviewPage(value: unknown, before: string) {
  if (!Array.isArray(value) || value.length > AUTO_REVIEW_PAGE_SIZE)
    throw Error("invalid_call_page");
  const rows = value.map(record);
  let previous = Date.parse(before);
  for (const row of rows) {
    const stamp = typeof row.createdAt === "string" ? Date.parse(row.createdAt) : NaN;
    if (!uuid(row.id) || !Number.isFinite(stamp) || stamp >= Date.parse(before) || stamp > previous)
      throw Error("invalid_call_page");
    previous = stamp;
  }
  const exhausted = rows.length < AUTO_REVIEW_PAGE_SIZE;
  // One millisecond overlaps the final timestamp, retaining tied rows. Repeated
  // IDs are idempotent. If a whole page shares the boundary, fail visibly.
  const nextBefore = exhausted ? null : new Date(previous + 1).toISOString();
  if (nextBefore && Date.parse(nextBefore) >= Date.parse(before))
    throw Error("ambiguous_call_page_boundary");
  return { rows, exhausted, nextBefore };
}

export function reviewCallType(kind: string) {
  return kind === "practice"
    ? "Browser practice; handovers are simulated and do not prove telephone transfer or voicemail delivery"
    : "Live telephone call; transcript alone cannot prove handset answer, two-way audio or voicemail delivery";
}

export function feedbackEvidence(note: unknown) {
  const n = record(note);
  if (typeof n.body !== "string" || !n.body.trim()) throw Error("feedback_snapshot_invalid");
  return `Client feedback: ${String(n.title ?? "")}\n${n.body}\nPriority: ${String(n.priority ?? "normal")}\nCategory: ${String(n.category ?? "improvement")}`;
}

export function safeAutoReviewError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const allowed = [
    "review_evidence_in_progress",
    "feedback_snapshot_invalid",
    "review_credit_required",
    "review_rate_limited",
    "review_provider_unavailable",
    "review_incomplete",
    "assessment_invalid",
    "assessment_evidence_invalid",
    "assessment_conflicting_decision",
    "evidence_too_large",
    "call_workspace_mismatch",
    "provider_unavailable",
    "awaiting_transcript",
    "invalid_call_page",
    "ambiguous_call_page_boundary",
    "review_save_failed",
    "approved_rules_required",
    "review_connection_unavailable",
    "daily_review_safeguard",
  ];
  return allowed.includes(code) ? code : "automatic_review_incomplete";
}
