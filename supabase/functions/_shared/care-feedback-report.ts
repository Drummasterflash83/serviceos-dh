import { normalizeCall, record } from "./receptionist-data.ts";
import { practiceCallMatches } from "./receptionist-web-call.ts";

const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const sourceCall =
  /^call:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}):(?:repetition|contradiction|understanding|handover|safety|technical)$/i;
export type ReportFeedback = {
  id: string;
  tenant_id: string;
  call_id: string | null;
  practice_session_id: string | null;
  title: string;
  body: string;
};
export type ReportSession = { id: string; tenant_id: string; call_id: string | null };
export type ReportDependencies = {
  feedback: (tenant: string, id: string) => Promise<ReportFeedback | null>;
  practiceSession: (
    tenant: string,
    call: string | null,
    session: string | null,
  ) => Promise<ReportSession | null>;
  workspace: (tenant: string) => Promise<{ assistant_id: string; key: string }>;
  fetcher?: typeof fetch;
};

/** Raw report text. The Slack boundary escapes it; never include provider recording URLs. */
export async function careFeedbackReport(
  issue: { tenant_id: string; feedback_id: string | null; source_key: string },
  deps: ReportDependencies,
): Promise<string | null> {
  if (!uuid.test(issue.tenant_id) || (issue.feedback_id && !uuid.test(issue.feedback_id)))
    throw Error("call_scope_invalid");
  const canonicalCall = sourceCall.exec(issue.source_key)?.[1] ?? null;
  if (issue.source_key.startsWith("call:") && !canonicalCall) throw Error("call_scope_invalid");
  const feedback = issue.feedback_id
    ? await deps.feedback(issue.tenant_id, issue.feedback_id)
    : null;
  if (
    issue.feedback_id &&
    (!feedback || feedback.id !== issue.feedback_id || feedback.tenant_id !== issue.tenant_id)
  )
    throw Error("feedback_unavailable");
  const callId = feedback?.call_id ?? canonicalCall;
  if (
    (callId && !uuid.test(callId)) ||
    (canonicalCall && feedback?.call_id && canonicalCall !== feedback.call_id)
  )
    throw Error("call_scope_invalid");
  if (feedback?.practice_session_id && !uuid.test(feedback.practice_session_id))
    throw Error("call_scope_invalid");
  const report = feedback
    ? `Client feedback\n${feedback.title}\n${feedback.body}`
    : "No feedback submitted with this call.";
  if (report.length > 30_000) throw Error("evidence_too_large");
  if (!callId && !feedback?.practice_session_id) return feedback ? report : null;
  const session = await deps.practiceSession(
    issue.tenant_id,
    callId,
    feedback?.practice_session_id ?? null,
  );
  if (feedback?.practice_session_id && !session) throw Error("call_scope_invalid");
  if (
    session &&
    (session.tenant_id !== issue.tenant_id ||
      !uuid.test(session.id) ||
      !session.call_id ||
      !uuid.test(session.call_id) ||
      (callId && session.call_id !== callId) ||
      (feedback?.practice_session_id && feedback.practice_session_id !== session.id))
  )
    throw Error("call_scope_invalid");
  const resolvedCall = session?.call_id ?? callId;
  if (!resolvedCall) throw Error("call_evidence_unavailable");
  const workspace = await deps.workspace(issue.tenant_id);
  if (!workspace.key) throw Error("review_connection_required");
  const response = await (deps.fetcher ?? fetch)(`https://api.vapi.ai/call/${resolvedCall}`, {
    headers: { Authorization: `Bearer ${workspace.key}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error("call_evidence_unavailable");
  const raw = record(await response.json());
  if (
    raw.id !== resolvedCall ||
    (session
      ? !practiceCallMatches(raw, session.id, issue.tenant_id)
      : raw.assistantId !== workspace.assistant_id)
  )
    throw Error("call_scope_invalid");
  const call = normalizeCall(raw);
  if (call.status !== "ended") throw Error("awaiting_completed_call");
  if (!call.transcript?.trim()) throw Error("awaiting_transcript");
  const text = `${session ? "Practice call report" : "Call report"}\nCall reference: ${resolvedCall}\n\n${report}\n\nConversation transcript\n${call.transcript}`;
  if (text.length > 30_000) throw Error("evidence_too_large");
  return text;
}
