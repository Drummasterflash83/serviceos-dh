import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, PhoneOff, Headphones, Send, MessageSquare, ChevronDown } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { type ReceptionistCall } from "@/lib/receptionist-data";
import { callBrief } from "@/lib/receptionist-review";
import {
  PracticeLifecycle,
  practiceVoiceError,
  practiceEndedMessage,
  microphoneHasSignal,
} from "@/lib/receptionist-practice-runtime";
import type Vapi from "@vapi-ai/web";
import { CallRecording } from "./CallRecording";

export type EmmaInfo = {
  enabled: boolean;
  unavailableReason?: string | null;
  checkedAt: string;
  maxSeconds: number;
  overview: {
    name: string;
    updatedAt: string | null;
    voiceProvider: string | null;
    firstMessage: string | null;
    queryToolCount: number;
    otherToolCount: number;
    sections: { title: string; text: string }[];
  };
};
export function useEmmaInfo(tenant: string, userId: string | undefined, demo: boolean) {
  return useQuery({
    queryKey: ["receptionist-info", userId, tenant],
    enabled: !!userId && !!tenant && !demo,
    staleTime: 60000,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().functions.invoke("receptionist-practice", {
        body: { tenantId: tenant, action: "info" },
      });
      if (error || data?.error) {
        // This endpoint returns governed messages, never raw provider payloads.
        let reason = data?.error;
        if (!reason && error?.context instanceof Response) {
          const body = await error.context
            .clone()
            .json()
            .catch(() => null);
          reason = body?.error;
        }
        throw Error(
          typeof reason === "string"
            ? reason
            : "Emma’s current configuration could not be checked. Your feedback can still be saved.",
        );
      }
      return data as EmmaInfo;
    },
  });
}
type SavedNote = {
  id: string;
  title: string;
  body: string;
  status: string;
  response: string;
  version: number;
  created_at: string;
  practice_session_id: string | null;
  call_id: string | null;
};
type PracticeSession = {
  id: string;
  call_id: string | null;
  state: string;
  created_at: string;
};
export function PracticeImprove({
  tenant,
  userId,
  tester,
  name,
  demo,
  active,
  info,
}: {
  tenant: string;
  userId?: string;
  tester: string;
  name: string;
  demo: boolean;
  active: boolean;
  info: ReturnType<typeof useEmmaInfo>;
}) {
  const db = getSupabaseClient(),
    qc = useQueryClient();
  const sdk = useRef<Vapi | null>(null),
    media = useRef<{ stop: () => void } | null>(null),
    providerCreated = useRef(false),
    micInCall = useRef(false),
    joinStage = useRef<"not_started" | "started" | "completed">("not_started"),
    lifecycle = useRef<PracticeLifecycle | null>(null),
    alive = useRef(true),
    generation = useRef(0),
    endedAt = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "active" | "ended">("idle"),
    [muted, setMuted] = useState(false),
    [error, setError] = useState(""),
    [connectionNote, setConnectionNote] = useState("");
  const [session, setSession] = useState<{
      id: string;
      callId: string | null;
      startedAt: string;
    } | null>(null),
    [showFeedback, setShowFeedback] = useState(false),
    [transcript, setTranscript] = useState<{ role: string; text: string }[]>([]);
  const [noticed, setNoticed] = useState(""),
    [sending, setSending] = useState(false),
    [saved, setSaved] = useState<string | null>(null),
    [expandedSession, setExpandedSession] = useState<string | null>(null);
  const submission = useRef(crypto.randomUUID()),
    pendingPayload = useRef<Record<string, unknown> | null>(null);
  const notes = useQuery({
    queryKey: ["receptionist-practice-notes", userId, tenant],
    enabled: !!userId && !demo,
    refetchInterval: active ? 15000 : false,
    queryFn: async () => {
      const { data, error } = await db
        .from("receptionist_feedback")
        .select("id,title,body,status,response,version,created_at,practice_session_id,call_id")
        .eq("tenant_id", tenant)
        .eq("author_id", userId!)
        .not("practice_session_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw Error("Your improvement history is unavailable");
      return data as SavedNote[];
    },
  });
  const sessions = useQuery({
    queryKey: ["receptionist-practice-sessions", userId, tenant],
    enabled: !!userId && !demo,
    refetchInterval: active ? 15000 : false,
    queryFn: async () => {
      const { data, error } = await db
        .from("receptionist_practice_sessions")
        .select("id,call_id,state,created_at")
        .eq("tenant_id", tenant)
        .eq("author_id", userId!)
        .not("call_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw Error("Your test calls are unavailable");
      return data as PracticeSession[];
    },
  });
  const delivery = useQuery({
    queryKey: ["receptionist-practice-delivery", userId, tenant],
    enabled: !!userId && !demo && active,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await db
        .from("client_notification_outbox")
        .select("source_id,source_version,state")
        .eq("tenant_id", tenant)
        .eq("source_type", "receptionist_feedback")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw Error("Slack status unavailable");
      return data;
    },
  });
  const result = useQuery({
    queryKey: ["receptionist-practice-result", userId, tenant, session?.id],
    enabled: !!session?.callId && state === "ended" && !demo,
    refetchInterval: (query) =>
      active &&
      endedAt.current > 0 &&
      Date.now() - endedAt.current < 60000 &&
      !query.state.data?.transcript
        ? 3000
        : false,
    queryFn: async () => {
      const { data, error } = await db.functions.invoke("receptionist-practice", {
        body: { tenantId: tenant, action: "result", sessionId: session!.id },
      });
      if (error || data?.error) throw Error("Conversation is still processing. Try again shortly.");
      return data.call as ReceptionistCall | null;
    },
  });
  function stop() {
    endedAt.current = Date.now();
    lifecycle.current?.end();
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    void sdk.current?.stop();
    sdk.current = null;
    media.current?.stop();
    media.current = null;
    setState(providerCreated.current ? "ended" : "idle");
    setMuted(false);
    micInCall.current = false;
    joinStage.current = "not_started";
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      lifecycle.current?.end();
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
      void sdk.current?.stop();
      sdk.current = null;
      media.current?.stop();
      media.current = null;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      lifecycle.current?.end();
      generation.current++;
      if (timer.current) clearTimeout(timer.current);
      void sdk.current?.stop();
      sdk.current = null;
      media.current?.stop();
      media.current = null;
      setState((s) =>
        s === "active" || s === "connecting" ? (providerCreated.current ? "ended" : "idle") : s,
      );
    }
  }, [active]);
  async function start() {
    if (demo || state === "active" || state === "connecting") return;
    if (!info.data?.enabled) {
      setError(
        info.data?.unavailableReason ??
          "The voice connection has not passed its readiness check. Use Recheck connection below; your feedback can still be saved.",
      );
      return;
    }
    if (noticed.trim() && !saved) {
      setError(
        "Send or clear your current feedback before starting another conversation, so it stays linked to the right call.",
      );
      return;
    }
    const attempt = ++generation.current;
    const connection = new PracticeLifecycle();
    lifecycle.current = connection;
    setState("connecting");
    providerCreated.current = false;
    micInCall.current = false;
    joinStage.current = "not_started";
    setSession(null);
    endedAt.current = 0;
    setError("");
    setConnectionNote("Preparing audio…");
    setTranscript([]);
    setShowFeedback(false);
    setSaved(null);
    setMuted(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || attempt !== generation.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      media.current = { stop: () => stream.getTracks().forEach((t) => t.stop()) };
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== "live")
        throw Error(
          "No working microphone was found. Check your input device before trying again.",
        );
      setConnectionNote("Say ‘hello’ now so we can check your microphone before calling Emma…");
      if (!(await microphoneHasSignal(track)))
        throw Error(
          "Your microphone is connected but no sound is coming through. Check the selected input and its volume, then try again. No test call was placed.",
        );
      if (!alive.current || attempt !== generation.current) return;
      setConnectionNote("Preparing Emma’s secure connection…");
      const { default: VapiClient } = await import("@vapi-ai/web");
      if (!alive.current || attempt !== generation.current) return;
      const id = crypto.randomUUID();
      const { data, error } = await db.functions.invoke("receptionist-practice", {
        body: { tenantId: tenant, action: "start", sessionId: id, mode: "conversation" },
      });
      if (!alive.current || attempt !== generation.current) return;
      if (error || data?.error) {
        let reason = data?.error;
        if (!reason && error?.context instanceof Response) {
          const body = await error.context
            .clone()
            .json()
            .catch(() => null);
          reason = body?.error;
        }
        throw Error(
          typeof reason === "string"
            ? reason
            : "Voice could not connect. The call status is unconfirmed; wait five minutes before a new attempt.",
        );
      }
      setSession({ id, callId: data.callId, startedAt: new Date().toISOString() });
      providerCreated.current = true;
      // Keep the already-authorised, live microphone track through Daily's
      // join. Releasing it here left Vapi with no customer audio on some
      // browsers, causing the call to end before the tester could speak.
      const voice = new VapiClient("", undefined, undefined, { audioSource: track });
      sdk.current = voice;
      const ready = async () => {
        if (!alive.current || attempt !== generation.current || connection.ended) return;
        try {
          // Daily can replace its input track while preparing audio processing.
          // Reattach the checked live track after join instead of assuming the
          // factory option still represents the microphone being transmitted.
          await voice.setInputDevicesAsync({ audioSource: track });
          if (!alive.current || attempt !== generation.current || !connection.ready()) return;
          voice.setMuted(false);
          if (timer.current) clearTimeout(timer.current);
          setState("active");
          setConnectionNote("Call connected. Speak to Emma; checking audio in the call…");
          timer.current = setTimeout(() => stop(), data.maxSeconds * 1000);
        } catch {
          if (alive.current && attempt === generation.current) {
            setError(
              "Your microphone worked locally, but the call could not attach it. Check this browser’s microphone and try again.",
            );
            stop();
          }
        }
      };
      voice.on("call-start", () => void ready());
      voice.on("call-start-progress", (event) => {
        if (alive.current && attempt === generation.current && event.stage === "daily-call-join") {
          joinStage.current = event.status === "started" ? "started" : "completed";
          setConnectionNote(
            event.status === "started"
              ? "Connecting your microphone to Emma…"
              : "Audio connection joined. Waiting for Emma…",
          );
        }
      });
      voice.on("local-volume-level", (level) => {
        if (
          alive.current &&
          attempt === generation.current &&
          !micInCall.current &&
          level > 0.008
        ) {
          micInCall.current = true;
          setConnectionNote(
            "Microphone audio detected in the call. Emma should be able to hear you.",
          );
        }
      });
      voice.on("call-end", () => {
        if (alive.current && attempt === generation.current && connection.end()) {
          if (!connection.wasReady)
            setError(
              joinStage.current === "completed"
                ? "The call joined but ended before audio was ready. Open the saved test below for Vapi’s end reason."
                : "The browser could not finish joining the call. Open the saved test below for Vapi’s end reason.",
            );
          setState("ended");
          endedAt.current = Date.now();
          setMuted(false);
          setConnectionNote("Conversation ended. Checking the call record…");
          if (timer.current) clearTimeout(timer.current);
          media.current?.stop();
          media.current = null;
          sdk.current = null;
        }
      });
      voice.on("error", (event: unknown) => {
        if (alive.current && attempt === generation.current) {
          const issue = practiceVoiceError(event);
          if (issue.fatal) {
            setError(issue.message);
            stop();
          } else setConnectionNote(issue.message);
        }
      });
      voice.on("message", (message: unknown) => {
        const m = message as {
          type?: string;
          transcriptType?: string;
          transcript?: string;
          role?: string;
        };
        if (
          alive.current &&
          attempt === generation.current &&
          m.type === "transcript" &&
          m.transcriptType === "final" &&
          typeof m.transcript === "string"
        )
          setTranscript((lines) => [
            ...lines,
            { role: m.role === "assistant" ? name : "You", text: m.transcript! },
          ]);
      });
      setConnectionNote("Connecting microphone and speaker…");
      timer.current = setTimeout(() => {
        if (alive.current && attempt === generation.current && !connection.ended) {
          setError(
            "The browser could not finish connecting audio. Check microphone permission and your connection before another attempt.",
          );
          stop();
        }
      }, 30000);
      await voice.reconnect({ webCallUrl: data.webCallUrl, id: data.callId });
      if (!alive.current || attempt !== generation.current) {
        await voice.stop();
        return;
      }
      // Only the SDK's call-start event can confirm a joined call. A resolved
      // reconnect promise alone is not proof that customer audio reached Vapi.
    } catch (e) {
      if (alive.current && attempt === generation.current) {
        setError(
          e instanceof Error && e.name === "NotAllowedError"
            ? "Microphone access was blocked. Allow it for this site, then start again. No call was requested."
            : e instanceof Error
              ? e.message
              : "Voice unavailable. You can still share an improvement.",
        );
        stop();
      }
    }
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    if (
      sending ||
      state === "connecting" ||
      state === "active" ||
      !userId ||
      demo ||
      !noticed.trim()
    )
      return;
    setSending(true);
    setError("");
    const payload = pendingPayload.current ?? {
      tenant_id: tenant,
      call_id: session?.callId ?? null,
      practice_session_id: session?.id ?? null,
      submission_key: submission.current,
      category: "improvement",
      priority: "normal",
      title: "Emma test feedback",
      body: noticed.trim(),
    };
    pendingPayload.current = payload;
    try {
      const { data, error } = await db
        .from("receptionist_feedback")
        .insert(payload)
        .select("id")
        .single();
      let id = data?.id;
      if (error) {
        const previous = await db
          .from("receptionist_feedback")
          .select("id")
          .eq("tenant_id", tenant)
          .eq("author_id", userId)
          .eq("submission_key", submission.current)
          .maybeSingle();
        if (previous.error || !previous.data)
          throw Error(
            "Save could not be confirmed. Your draft is kept; retry checks the same submission, not a duplicate.",
          );
        id = previous.data.id;
      }
      setSaved(id!);
      setNoticed("");
      pendingPayload.current = null;
      submission.current = crypto.randomUUID();
      await qc.invalidateQueries({
        predicate: (q) => String(q.queryKey[0]).startsWith("receptionist-"),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  const speaking = state === "active" || state === "connecting";
  return (
    <div className="ep" hidden={!active}>
      <div className="ep-grid">
        <section className="ep-stage" aria-label="Practice conversation">
          <span className="ep-kicker">A PRIVATE CONVERSATION, RIGHT HERE</span>
          <div className="ep-orb" aria-hidden="true">
            <Headphones size={46} />
          </div>
          <h2>Get to know {name}.</h2>
          <p>
            Speak to {name} in the app. End the conversation, hear it back and send one clear report
            to OpenFolk.
          </p>
          <p className="ep-phone-safety">
            Allow microphone access and use fictional customer details. This tests Emma’s voice and
            answers, not the phone transfer or Birchills route. Practice is recorded, uses provider
            minutes and cannot change customer records.
          </p>
          <div className="ep-call-console">
            <div className="ep-controls">
              {speaking ? (
                <>
                  <button className="rw-btn rw-btn-primary" onClick={stop}>
                    <PhoneOff size={18} /> {state === "connecting" ? "Cancel" : "Hang up"}
                  </button>
                  {state === "active" && (
                    <button
                      className="rw-btn rw-btn-light"
                      aria-pressed={muted}
                      onClick={() => {
                        sdk.current?.setMuted(!muted);
                        setMuted(!muted);
                      }}
                    >
                      {muted ? <MicOff size={18} /> : <Mic size={18} />} {muted ? "Unmute" : "Mute"}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="rw-btn rw-btn-primary"
                    disabled={demo || info.isPending}
                    onClick={() => void start()}
                  >
                    <Mic size={18} /> Test {name}
                  </button>
                </>
              )}
              <button
                type="button"
                className="rw-btn rw-btn-light"
                disabled={speaking || !session?.callId || state !== "ended"}
                onClick={() => setShowFeedback(true)}
              >
                <MessageSquare size={18} /> Give feedback
              </button>
            </div>
            <div className="ep-live-caption" role="status">
              {state === "connecting"
                ? connectionNote
                : state === "active"
                  ? connectionNote
                  : state === "ended"
                    ? "Conversation ended."
                    : "Ready when you are."}
            </div>
            {!!transcript.length && (
              <div className="ep-transcript" aria-label="Live conversation transcript">
                {transcript.map((line, index) => (
                  <p key={`${index}-${line.role}`}>
                    <strong>{line.role}</strong> {line.text}
                  </p>
                ))}
              </div>
            )}
            {state === "ended" && result.data && practiceEndedMessage(result.data.endedReason) && (
              <p className="rw-footnote" role="status">
                {practiceEndedMessage(result.data.endedReason)}
              </p>
            )}
            {state === "ended" && session?.callId && (
              <div className="ep-current-call">
                <div className="ep-current-call-header">
                  <strong>Your test call</strong>
                  <small>
                    {new Date(session.startedAt).toLocaleString("en-GB")} · {tester}
                  </small>
                </div>
                {result.data ? (
                  <>
                    {result.data.status === "ended" && <p>{callBrief(result.data).text}</p>}
                    {result.data.status === "ended" ? (
                      <CallRecording
                        key={session.id}
                        tenant={tenant}
                        call={result.data}
                        demo={demo}
                        practiceSessionId={session.id}
                        autoLoad
                      />
                    ) : (
                      <p>Finishing your call record…</p>
                    )}
                  </>
                ) : (
                  <p>{result.isError ? result.error.message : "Preparing your call record…"}</p>
                )}
                {showFeedback && (
                  <form className="ep-inline-feedback" onSubmit={(e) => void send(e)}>
                    <label htmlFor="emma-test-feedback">What should Emma do differently?</label>
                    <textarea
                      id="emma-test-feedback"
                      value={noticed}
                      maxLength={3500}
                      disabled={sending || !!pendingPayload.current}
                      onChange={(e) => setNoticed(e.target.value)}
                      placeholder="Tell OpenFolk what happened or what you want changed."
                    />
                    <button
                      className="rw-btn rw-btn-primary"
                      disabled={demo || sending || !noticed.trim()}
                    >
                      <Send size={17} /> {sending ? "Saving…" : "Save feedback"}
                    </button>
                    <small>
                      The test call is saved even if you leave without feedback. Feedback does not
                      change Emma automatically.
                    </small>
                  </form>
                )}
                {saved && (
                  <p className="ep-saved" role="status">
                    Feedback saved with this call.
                  </p>
                )}
              </div>
            )}
            <small className="ep-limit">
              Up to 3 minutes · recorded for your review · 10 sessions per person and 30 per
              workspace in 24 hours
            </small>
            {!info.data?.enabled && (
              <p className="ep-connection">
                {demo
                  ? "Design preview — voice is not connected."
                  : info.isPending
                    ? "Checking the voice connection…"
                    : info.isError
                      ? info.error.message
                      : (info.data?.unavailableReason ??
                        "Voice practice is awaiting OpenFolk verification. You can send feedback now.")}{" "}
                {!demo && !info.isPending && (
                  <button onClick={() => void info.refetch()} disabled={info.isFetching}>
                    Recheck connection
                  </button>
                )}
              </p>
            )}
          </div>
        </section>
      </div>
      {error && (
        <div className="rw-banner rw-error" role="alert">
          {error}
        </div>
      )}
      <section className="rw-panel ep-history">
        <div className="rw-panel-title">
          <div>
            <span className="rw-eyebrow">LATEST FIRST</span>
            <h2>Your test calls</h2>
          </div>
          <Headphones size={25} />
        </div>
        {sessions.isError || notes.isError ? (
          <p role="alert">
            Your test history is unavailable.{" "}
            <button
              onClick={() => {
                void sessions.refetch();
                void notes.refetch();
              }}
            >
              Retry
            </button>
          </p>
        ) : (sessions.isPending || notes.isPending) && !demo ? (
          <p>Loading your test calls…</p>
        ) : !sessions.data?.length ? (
          <div className="ep-empty">Your test calls will appear here automatically.</div>
        ) : (
          sessions.data.map((test) => {
            const n = notes.data?.find((note) => note.practice_session_id === test.id);
            const d = delivery.data?.find(
              (d) => d.source_id === n?.id && d.source_version === n?.version,
            );
            return (
              <article key={test.id} className="ep-test-row">
                <button
                  type="button"
                  className="ep-test-toggle"
                  aria-expanded={expandedSession === test.id}
                  aria-controls={`ep-test-detail-${test.id}`}
                  onClick={() => setExpandedSession(expandedSession === test.id ? null : test.id)}
                >
                  <span className="ep-test-main">
                    <strong>
                      <time dateTime={test.created_at}>
                        {new Intl.DateTimeFormat("en-GB", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(test.created_at))}
                      </time>
                    </strong>
                    <small>
                      {tester} · {test.state === "ended" ? "Call ended" : "Test call"}
                    </small>
                  </span>
                  <span className="ep-test-trailing">
                    <span className="rw-pill">{n ? "With feedback" : "No feedback yet"}</span>
                    <ChevronDown size={18} aria-hidden="true" />
                  </span>
                </button>
                <div
                  id={`ep-test-detail-${test.id}`}
                  hidden={expandedSession !== test.id}
                  className="ep-test-detail"
                >
                  {n && (
                    <p className="rw-preserve">
                      <strong>Your feedback</strong>
                      <br />
                      {n.body}
                    </p>
                  )}
                  {n && (
                    <small>
                      {delivery.isError
                        ? "Slack status unavailable"
                        : d?.state === "sent"
                          ? "Delivered to Slack"
                          : d?.state === "failed"
                            ? "Saved · Slack delivery needs attention"
                            : "Saved · Slack delivery pending"}
                    </small>
                  )}
                  <PracticeEvidence
                    tenant={tenant}
                    sessionId={test.id}
                    viewerId={userId!}
                    expanded={expandedSession === test.id}
                  />
                </div>
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

function PhonePracticeEvidence({
  tenant,
  callId,
  viewerId,
}: {
  tenant: string;
  callId: string;
  viewerId: string;
}) {
  const [opened, setOpened] = useState(false);
  const evidence = useQuery({
    queryKey: ["receptionist-phone-practice-evidence", viewerId, tenant, callId],
    enabled: opened,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().functions.invoke("receptionist-calls", {
        body: { tenantId: tenant, action: "detail", callId },
      });
      if (error || data?.error || !data?.call)
        throw Error("This call is unavailable. Try again shortly.");
      return data.call as ReceptionistCall;
    },
  });
  return (
    <div className="ep-evidence">
      <button className="rw-text-btn" type="button" onClick={() => setOpened(!opened)}>
        {opened ? "Hide" : "Open"} phone conversation
      </button>
      {opened &&
        (evidence.isPending ? (
          <p>Loading conversation…</p>
        ) : evidence.isError ? (
          <p role="alert">
            {evidence.error.message}{" "}
            <button type="button" onClick={() => void evidence.refetch()}>
              Retry
            </button>
          </p>
        ) : (
          evidence.data && (
            <>
              <p>{callBrief(evidence.data).text}</p>
              {evidence.data.transcript ? (
                <details>
                  <summary>Conversation transcript</summary>
                  <p className="rw-preserve">{evidence.data.transcript}</p>
                </details>
              ) : (
                <p>Transcript not supplied for this call.</p>
              )}
              <CallRecording tenant={tenant} call={evidence.data} demo={false} />
            </>
          )
        ))}
    </div>
  );
}

export function PracticeEvidence({
  tenant,
  sessionId,
  viewerId,
  expanded,
}: {
  tenant: string;
  sessionId: string;
  viewerId: string;
  expanded?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const visible = expanded ?? opened;
  const evidence = useQuery({
    queryKey: ["receptionist-practice-evidence", viewerId, tenant, sessionId],
    enabled: visible,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().functions.invoke("receptionist-practice", {
        body: { tenantId: tenant, action: "result", sessionId },
      });
      if (error || data?.error || !data?.call)
        throw Error("Practice evidence is not available yet.");
      return data.call as ReceptionistCall;
    },
  });
  return (
    <div className="ep-evidence">
      {expanded === undefined && (
        <button className="rw-text-btn" onClick={() => setOpened(!opened)}>
          {opened ? "Hide" : "Open"} practice conversation
        </button>
      )}
      {visible &&
        (evidence.isPending ? (
          <p>Loading conversation…</p>
        ) : evidence.isError ? (
          <p role="alert">
            {evidence.error.message} <button onClick={() => void evidence.refetch()}>Retry</button>
          </p>
        ) : (
          evidence.data && (
            <>
              <p>{callBrief(evidence.data).text}</p>
              <small>{callBrief(evidence.data).source}</small>
              {practiceEndedMessage(evidence.data.endedReason) && (
                <p role="status">{practiceEndedMessage(evidence.data.endedReason)}</p>
              )}
              {evidence.data.transcript && (
                <details>
                  <summary>Conversation transcript</summary>
                  <p className="rw-preserve">{evidence.data.transcript}</p>
                </details>
              )}
              <CallRecording
                tenant={tenant}
                call={evidence.data}
                demo={false}
                practiceSessionId={sessionId}
              />
            </>
          )
        ))}
    </div>
  );
}

export function EmmaTraining({
  name,
  info,
}: {
  name: string;
  info: ReturnType<typeof useEmmaInfo>;
}) {
  return (
    <section className="rw-panel ep-training">
      <span className="rw-eyebrow">HER INSTRUCTIONS, MADE VISIBLE</span>
      <h2>What {name} is trained to do</h2>
      <p>
        Read the instructions returned by the connected assistant. Practice uses the same published
        conversation instructions and voice, with real-world actions removed.
      </p>
      {info.isPending ? (
        <p>Checking the published configuration…</p>
      ) : info.isError ? (
        <p role="alert">
          {info.error.message} <button onClick={() => void info.refetch()}>Retry</button>
        </p>
      ) : (
        info.data && (
          <>
            <div className="ep-training-meta">
              <span>Checked {new Date(info.data.checkedAt).toLocaleString("en-GB")}</span>
              <span>
                Provider updated{" "}
                {info.data.overview.updatedAt
                  ? new Date(info.data.overview.updatedAt).toLocaleString("en-GB")
                  : "not supplied"}
              </span>
              <span>{info.data.overview.queryToolCount} read-only knowledge tools</span>
            </div>
            {info.data.overview.sections.length ? (
              info.data.overview.sections.map((s, i) => (
                <details key={i}>
                  <summary>{s.title}</summary>
                  <p className="rw-preserve">{s.text}</p>
                </details>
              ))
            ) : (
              <p>
                The connected prompt does not expose labelled training sections. OpenFolk can
                prepare a reviewed guide; we won’t substitute an old draft.
              </p>
            )}
            <p className="rw-footnote">
              A published instruction describes intended behaviour, not proof that every call
              followed it. Other live tools are excluded from browser practice; external-system
              actions are not tested here.
            </p>
          </>
        )
      )}
    </section>
  );
}
