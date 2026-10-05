import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { durationLabel, type ReceptionistCall } from "@/lib/receptionist-data";
import {
  careEvidenceReference,
  careEvidenceRequest,
  type CarePracticeReference,
} from "@/lib/care-evidence";
import { CallRecording } from "@/components/receptionist/CallRecording";
import "@/styles/care-evidence.css";

export function CareEvidence({
  tenantId,
  issueId,
  sourceKey,
  feedbackId,
}: {
  tenantId: string;
  issueId: string;
  sourceKey: string;
  feedbackId: string | null;
}) {
  const { user } = useAuth();
  const evidence = useQuery({
    queryKey: ["care-call-evidence", user?.id, tenantId, issueId, sourceKey, feedbackId],
    enabled: !!user,
    gcTime: 0,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const db = getSupabaseClient();
      let reference = careEvidenceReference(sourceKey);
      if (feedbackId) {
        const feedback = await db
          .from("receptionist_feedback")
          .select("call_id,practice_session_id")
          .eq("tenant_id", tenantId)
          .eq("id", feedbackId)
          .maybeSingle();
        if (feedback.error || !feedback.data)
          throw Error("The original feedback could not be retrieved.");
        reference = careEvidenceReference(sourceKey, feedback.data);
      }
      let session: CarePracticeReference | null = null;
      if (reference.practiceSessionId || reference.callId) {
        let query = db
          .from("receptionist_practice_sessions")
          .select("id,call_id")
          .eq("tenant_id", tenantId);
        query = reference.practiceSessionId
          ? query.eq("id", reference.practiceSessionId)
          : query.eq("call_id", reference.callId!);
        const result = await query.maybeSingle();
        if (result.error || (reference.practiceSessionId && !result.data))
          throw Error("The practice evidence could not be verified.");
        session = result.data;
      }
      const request = careEvidenceRequest(tenantId, reference.callId, session);
      if (!request) return null;
      const result = await db.functions.invoke(request.endpoint, { body: request.body });
      if (result.error || result.data?.error || result.data?.call?.id !== request.callId)
        throw Error(
          "Call evidence is unavailable. Try again shortly; do not treat this as a successful test.",
        );
      if (
        session &&
        (result.data?.session?.id !== session.id ||
          result.data?.session?.call_id !== request.callId ||
          result.data?.session?.tenant_id !== tenantId)
      )
        throw Error("The returned practice evidence does not match this workspace.");
      // Playback is requested separately on click. Never retain provider playback URLs in this cache.
      const call = { ...result.data.call, recording: null } as ReceptionistCall;
      return { call, practiceSessionId: session?.id };
    },
  });
  const call = evidence.data?.call;
  const occurred = call?.startedAt ?? call?.createdAt;
  const date =
    occurred && Number.isFinite(Date.parse(occurred))
      ? new Date(occurred).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
      : "Call time unavailable";
  return (
    <section className="care-evidence" aria-label="Original call evidence">
      <h4>Listen. Read. Then decide.</h4>
      {evidence.isPending ? (
        <p role="status">Loading the original call…</p>
      ) : evidence.isError ? (
        <div role="alert">
          <p>{evidence.error.message}</p>
          <button type="button" onClick={() => void evidence.refetch()}>
            Retry call evidence
          </button>
        </div>
      ) : !call ? (
        <p>This observation is not attached to a call. Review the client’s note above.</p>
      ) : (
        <>
          <div className="care-evidence-meta">
            <strong>
              {evidence.data?.practiceSessionId
                ? "Practice call"
                : call.type === "webCall"
                  ? "Browser call"
                  : "Phone call"}
            </strong>
            <span>{date}</span>
            <span>
              {call.duration === null ? "Duration unavailable" : durationLabel(call.duration)}
            </span>
          </div>
          {call.summary && (
            <p>
              <strong>Provider summary:</strong> {call.summary}
            </p>
          )}
          <CallRecording
            key={`${tenantId}:${call.id}`}
            tenant={tenantId}
            call={call}
            demo={false}
            practiceSessionId={evidence.data?.practiceSessionId}
            autoLoad={false}
          />
          {call.transcript ? (
            <details className="care-evidence-transcript">
              <summary>Read the call transcript</summary>
              <p>{call.transcript}</p>
            </details>
          ) : (
            <p>Transcript not supplied for this call.</p>
          )}
          <small>
            Listen to the provider recording before diagnosing an audio stutter. A transcript alone
            does not prove where it happened.
          </small>
        </>
      )}
    </section>
  );
}
