const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const callSource =
  /^call:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}):(repetition|contradiction|understanding|handover|safety|technical)$/i;
export type CareFeedbackReference = { call_id: string | null; practice_session_id: string | null };
export type CarePracticeReference = { id: string; call_id: string | null };

/** IDs are pointers only. The caller must still resolve every pointer through tenant-scoped RLS. */
export function careEvidenceReference(sourceKey: string, feedback?: CareFeedbackReference) {
  const source = callSource.exec(sourceKey)?.[1] ?? null;
  if (sourceKey.startsWith("call:") && !source) throw Error("Call evidence reference is invalid.");
  if (
    (feedback?.call_id && !uuid.test(feedback.call_id)) ||
    (feedback?.practice_session_id && !uuid.test(feedback.practice_session_id))
  )
    throw Error("Call evidence reference is invalid.");
  if (source && feedback?.call_id && source !== feedback.call_id)
    throw Error("The feedback and call reference do not match.");
  return {
    callId: feedback?.call_id ?? source,
    practiceSessionId: feedback?.practice_session_id ?? null,
  };
}

export function careEvidenceRequest(
  tenantId: string,
  callId: string | null,
  session?: CarePracticeReference | null,
) {
  if (!uuid.test(tenantId) || (callId && !uuid.test(callId)))
    throw Error("Call evidence reference is invalid.");
  if (session) {
    if (!uuid.test(session.id) || !session.call_id || !uuid.test(session.call_id))
      throw Error("The practice call is not available yet.");
    if (callId && session.call_id !== callId)
      throw Error("The practice session and call do not match.");
    return {
      endpoint: "receptionist-practice",
      body: { tenantId, action: "result", sessionId: session.id },
      callId: session.call_id,
    } as const;
  }
  if (!callId) return null;
  return {
    endpoint: "receptionist-calls",
    body: { tenantId, action: "detail", callId },
    callId,
  } as const;
}
