import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, PhoneOff, Headphones, Send, MessageSquare } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase";
import { type ReceptionistCall } from "@/lib/receptionist-data";
import { callBrief } from "@/lib/receptionist-review";
import {
  PracticeLifecycle,
  practiceVoiceError,
  practiceEndedMessage,
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
const scenarios = [
  "A named person",
  "Booking or appointment",
  "An invoice question",
  "A job update",
  "An unhappy caller",
  "My own scenario",
];
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
export function PracticeImprove({
  tenant,
  userId,
  name,
  demo,
  active,
  info,
}: {
  tenant: string;
  userId?: string;
  name: string;
  demo: boolean;
  active: boolean;
  info: ReturnType<typeof useEmmaInfo>;
}) {
  const db = getSupabaseClient(),
    qc = useQueryClient();
  const sdk = useRef<Vapi | null>(null),
    media = useRef<{ stop: () => void } | null>(null),
    lifecycle = useRef<PracticeLifecycle | null>(null),
    alive = useRef(true),
    generation = useRef(0),
    endedAt = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "active" | "ended">("idle"),
    [muted, setMuted] = useState(false),
    [error, setError] = useState(""),
    [connectionNote, setConnectionNote] = useState(""),
    [scenario, setScenario] = useState(scenarios[0]);
  const [session, setSession] = useState<{ id: string; callId: string | null } | null>(null),
    [showFeedback, setShowFeedback] = useState(false),
    [transcript, setTranscript] = useState<{ role: string; text: string }[]>([]);
  const [noticed, setNoticed] = useState(""),
    [change, setChange] = useState(""),
    [sending, setSending] = useState(false),
    [saved, setSaved] = useState<string | null>(null);
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
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw Error("Your improvement history is unavailable");
      return data as SavedNote[];
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
    setState("ended");
    setMuted(false);
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
      setState((s) => (s === "active" || s === "connecting" ? "ended" : s));
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
    if ((noticed.trim() || change.trim()) && !saved) {
      setError(
        "Send or clear your current feedback before starting another conversation, so it stays linked to the right call.",
      );
      return;
    }
    const attempt = ++generation.current;
    const connection = new PracticeLifecycle();
    lifecycle.current = connection;
    setState("connecting");
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
      setSession({ id, callId: data.callId });
      // The SDK owns the browser microphone lifecycle. We still obtain consent
      // before reserving a paid Vapi call, then release our preflight track.
      media.current?.stop();
      media.current = null;
      const voice = new VapiClient("");
      sdk.current = voice;
      const ready = () => {
        if (alive.current && attempt === generation.current && connection.ready()) {
          if (timer.current) clearTimeout(timer.current);
          setState("active");
          setConnectionNote("Microphone connected. You can speak to Emma.");
          timer.current = setTimeout(() => stop(), data.maxSeconds * 1000);
        }
      };
      voice.on("call-start", ready);
      voice.on("call-end", () => {
        if (alive.current && attempt === generation.current && connection.end()) {
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
      if (!connection.ended) ready();
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
      (!noticed.trim() && !change.trim())
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
      title: `Practice & improve · ${scenario}`,
      body: [
        `Scenario: ${scenario}`,
        `Mode: ${session ? "In-app conversation" : "Written feedback — no practice call"}`,
        noticed.trim() ? `What I noticed:\n${noticed.trim()}` : "",
        change.trim() ? `What I would like changed:\n${change.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
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
      setChange("");
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
          <div className="ep-scenarios" aria-label="Practice scenario">
            {scenarios.map((s) => (
              <button
                key={s}
                disabled={speaking || !!pendingPayload.current}
                aria-pressed={scenario === s}
                onClick={() => setScenario(s)}
              >
                {s}
              </button>
            ))}
          </div>
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
                disabled={speaking || !session?.callId}
                onClick={() => setShowFeedback(true)}
              >
                <MessageSquare size={18} /> Give feedback
              </button>
            </div>
            <div className="ep-live-caption" role="status">
              {state === "connecting"
                ? connectionNote
                : state === "active"
                  ? "You’re speaking with Emma."
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
              <div className="ep-phone-result">
                <strong>Your conversation</strong>
                {result.data ? (
                  <>
                    <p>{callBrief(result.data).text}</p>
                    {result.data.transcript ? (
                      <details>
                        <summary>Read the full transcript</summary>
                        <p className="rw-preserve">{result.data.transcript}</p>
                      </details>
                    ) : (
                      <small>Transcript is still processing or was not supplied.</small>
                    )}
                    <CallRecording
                      key={session.id}
                      tenant={tenant}
                      call={result.data}
                      demo={demo}
                      practiceSessionId={session.id}
                    />
                  </>
                ) : (
                  <p>
                    {result.isError ? result.error.message : "Preparing recording and transcript…"}
                  </p>
                )}
                <button
                  type="button"
                  className="rw-btn rw-btn-light"
                  onClick={() => void result.refetch()}
                >
                  Check recording
                </button>
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
          {(showFeedback || (state === "ended" && !!session?.callId)) && (
            <section className="rw-panel ep-notes">
              <span className="rw-eyebrow">KEEP THE LEARNING WITH THE CALL</span>
              <h2>Help {name} get better</h2>
              <p>
                Tell us what happened and what you’d like changed. Your note is saved with the
                conversation above; OpenFolk will review it before changing Emma.
              </p>
              <form onSubmit={(e) => void send(e)}>
                <label>
                  What did you notice?
                  <textarea
                    value={noticed}
                    maxLength={3500}
                    disabled={sending || !!pendingPayload.current}
                    onChange={(e) => setNoticed(e.target.value)}
                    placeholder="For example: I asked for Mary, but Emma asked me to explain the reason again."
                  />
                </label>
                <label>
                  What would you like her to do instead?
                  <textarea
                    value={change}
                    maxLength={3500}
                    disabled={sending || !!pendingPayload.current}
                    onChange={(e) => setChange(e.target.value)}
                    placeholder="For example: When someone asks for Mary, connect them without another question."
                  />
                </label>
                <small>
                  {session?.callId
                    ? "This exact conversation is attached to your feedback."
                    : "This idea has no call attached."}{" "}
                  Feedback does not change Emma automatically.
                </small>
                <button
                  className="rw-btn rw-btn-primary"
                  disabled={demo || sending || speaking || (!noticed.trim() && !change.trim())}
                >
                  <Send size={17} />
                  {sending
                    ? "Saving…"
                    : pendingPayload.current
                      ? "Check & retry submission"
                      : "Send report"}
                </button>
              </form>
              {saved && (
                <p className="ep-saved" role="status">
                  Saved. Follow delivery and our response below.
                </p>
              )}
            </section>
          )}
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
            <h2>Your reports</h2>
          </div>
          <MessageSquare size={25} />
        </div>
        {notes.isError ? (
          <p role="alert">
            {notes.error.message} <button onClick={() => void notes.refetch()}>Retry</button>
          </p>
        ) : notes.isPending && !demo ? (
          <p>Loading your observations…</p>
        ) : !notes.data?.length ? (
          <div className="ep-empty">Your completed reports will appear here.</div>
        ) : (
          notes.data.map((n) => {
            const d = delivery.data?.find(
              (d) => d.source_id === n.id && d.source_version === n.version,
            );
            return (
              <article key={n.id} className="ep-note">
                <div>
                  <strong>{n.title}</strong>
                  <span className="rw-pill">{n.status}</span>
                </div>
                <small>
                  {new Date(n.created_at).toLocaleString("en-GB")} ·{" "}
                  {delivery.isError
                    ? "Slack status unavailable"
                    : d?.state === "sent"
                      ? "Delivered to Slack"
                      : d?.state === "failed"
                        ? "Saved · Slack delivery needs attention"
                        : "Saved · Slack delivery pending"}
                </small>
                <p className="rw-preserve">{n.body}</p>
                <p>{n.response || "OpenFolk’s response will appear here."}</p>
                {n.practice_session_id && (
                  <PracticeEvidence
                    tenant={tenant}
                    sessionId={n.practice_session_id}
                    viewerId={userId!}
                  />
                )}
                {n.call_id && !n.practice_session_id && (
                  <PhonePracticeEvidence tenant={tenant} callId={n.call_id} viewerId={userId!} />
                )}
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
}: {
  tenant: string;
  sessionId: string;
  viewerId: string;
}) {
  const [opened, setOpened] = useState(false);
  const evidence = useQuery({
    queryKey: ["receptionist-practice-evidence", viewerId, tenant, sessionId],
    enabled: opened,
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
      <button className="rw-text-btn" onClick={() => setOpened(!opened)}>
        {opened ? "Hide" : "Open"} practice conversation
      </button>
      {opened &&
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
