import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  canCollectWork,
  WORK_COLLECTORS,
  type WorkCollectionKind,
} from "@/lib/learn-work-collection";
import {
  createWorkCollectionRequest,
  readWorkCollectionEvidence,
  type WorkCollectionProgress,
} from "@/lib/learn-resumable-work";
import {
  workCollectionOutboxKey,
  readWorkCollectionDraft,
  prepareWorkCollectionDraft,
  operateWorkCollection,
  type WorkCollectionDraft,
} from "@/lib/learn-work-collection-outbox";
import type { RecoveryLock } from "@/lib/learn-slack-recovery-outbox";
import type { ScorecardPolicy, ScorePeriod, ScoreSubject } from "@/lib/learn-scorecards";
import type { ReviewedPerformanceMeasurement } from "@/lib/learn-performance-measurements";
import { LearnWorkCollectionEvidence } from "./LearnWorkCollectionEvidence";
export type RetainedWorkReview = {
  policy: ScorecardPolicy;
  period: ScorePeriod;
  subject: Pick<ScoreSubject, "kind" | "id">;
};
type Props = {
  tenantId: string;
  actorId: string;
  subjectId: string;
  subjectKind: ScoreSubject["kind"];
  canReview: boolean;
  current: {
    policy: ScorecardPolicy;
    period: ScorePeriod;
    rows: ReviewedPerformanceMeasurement[];
  } | null;
  onSaved: () => void;
  onReview: (selection: RetainedWorkReview) => void;
};
const lock: RecoveryLock = async (key, task) => {
  if (!navigator.locks) throw Error("Use a browser that supports saved-request coordination");
  return navigator.locks.request(key, task);
};
const date = (s: string) => new Date(s).toISOString();
export function LearnWorkCollections(props: Props) {
  if (!["member", "team"].includes(props.subjectKind)) return null;
  return (
    <section aria-label="Work evidence collection">
      {(Object.keys(WORK_COLLECTORS) as WorkCollectionKind[])
        .filter((kind) => WORK_COLLECTORS[kind].subjectKind === props.subjectKind)
        .map((kind) => (
          <Collection
            key={`${props.actorId}:${props.tenantId}:${props.subjectId}:${kind}`}
            {...props}
            mode={kind}
          />
        ))}
    </section>
  );
}
function Collection({
  tenantId,
  actorId,
  subjectId,
  mode,
  canReview,
  current,
  onSaved,
  onReview,
}: Props & { mode: WorkCollectionKind }) {
  const scope = {
      backend: supabaseConfig.url.replace(/\/$/, ""),
      tenantId,
      actorId,
      subjectId,
      kind: mode,
    },
    spec = WORK_COLLECTORS[mode];
  const [draft, setDraft] = useState<WorkCollectionDraft | null>(null),
    [reason, setReason] = useState(""),
    [endReason, setEndReason] = useState(""),
    [progress, setProgress] = useState<WorkCollectionProgress | null>(null),
    [message, setMessage] = useState(""),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const live = useRef(false),
    editable = useRef(canReview),
    pending = useRef(false),
    pause = useRef(false);
  editable.current = canReview;
  const context = current
    ? `${current.policy.id}:${current.policy.version}:${current.period.start}:${current.period.end}`
    : "unloaded";
  function restore() {
    try {
      const saved = readWorkCollectionDraft(localStorage, scope);
      setDraft(saved);
      if (saved) setReason(saved.request.reason);
      setReady(true);
      return saved;
    } catch (e) {
      setReady(false);
      setMessage(e instanceof Error ? e.message : "Saved collection unavailable");
      return null;
    }
  }
  useEffect(() => {
    live.current = true;
    restore();
    const changed = (e: StorageEvent) => {
      if (e.key === null || e.key === workCollectionOutboxKey(scope)) {
        pause.current = true;
        setProgress(null);
        restore();
        setMessage("Collection details changed in another tab. Check progress before continuing.");
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      pause.current = true;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, subjectId, mode]);
  useEffect(() => {
    if (pending.current) pause.current = true;
  }, [context, canReview]);
  const supported = !!current && canCollectWork(current.policy, mode);
  const exists = !!current?.rows.some((m) => m.metricKey === spec.metric);
  async function operate(action: "run" | "check" | "end" | "clear") {
    if (pending.current || !ready || !canReview) return;
    pending.current = true;
    pause.current = false;
    setBusy(true);
    setMessage("");
    try {
      if (!draft && (action !== "run" || !supported || exists || !current))
        throw Error("Load supported saved rules and a completed period before starting");
      const value =
        draft ??
        prepareWorkCollectionDraft(
          scope,
          createWorkCollectionRequest({
            policy: current!.policy,
            actorId,
            subjectId,
            kind: mode,
            period: current!.period,
            requestId: crypto.randomUUID(),
            reason,
          }),
        );
      const result = await operateWorkCollection(
        getSupabaseClient(),
        localStorage,
        lock,
        scope,
        value,
        action,
        () => live.current && editable.current && !pause.current,
        (p) => {
          if (live.current) {
            setDraft(value);
            setProgress(p);
          }
        },
        endReason,
      );
      if (!live.current) return;
      setMessage(
        result.state === "completed"
          ? "Collection completed. Inspect its retained evidence and confirm or dispute the measurement separately."
          : result.state === "abandoned"
            ? "Collection ended. Its request and any captured calculation evidence remain retained."
            : result.state === "superseded"
              ? (result.endReason ?? "This collection was superseded.")
              : `${result.processed.toLocaleString()} of ${result.population.toLocaleString()} retained items examined.`,
      );
      if (action === "clear") {
        setProgress(null);
        setReason("");
        setEndReason("");
      }
      if (result.state === "completed") onSaved();
    } catch (e) {
      if (live.current)
        setMessage(
          pause.current
            ? "Collection paused. An in-flight batch may have finished; check progress before continuing."
            : e instanceof Error
              ? e.message
              : "Collection outcome not confirmed",
        );
    } finally {
      pending.current = false;
      if (live.current) {
        restore();
        setBusy(false);
      }
    }
  }
  async function review() {
    if (!draft || pending.current || !canReview) return;
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const data = await readWorkCollectionEvidence(
        getSupabaseClient(),
        tenantId,
        draft.request.requestId,
        "overview",
      );
      if (!live.current || !editable.current) return;
      if (
        data.subject.id !== subjectId ||
        data.policy.id !== draft.request.policyId ||
        data.policy.version !== draft.request.policyVersion ||
        Date.parse(data.period.start) !== Date.parse(draft.request.period.start) ||
        Date.parse(data.period.end) !== Date.parse(draft.request.period.end)
      )
        throw Error("Retained review scope differs from this request");
      onReview({
        policy: { ...data.policy, status: "draft" },
        period: data.period,
        subject: data.subject,
      });
    } catch (e) {
      if (live.current) setMessage(e instanceof Error ? e.message : "Retained review unavailable");
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  if (!draft && ready && !supported) return null;
  if (!draft && ready && exists)
    return <p>{spec.collected} Review the retained calculation below.</p>;
  const terminal = !!progress && progress.state !== "collecting";
  return (
    <section className="lp-review" aria-label={spec.title}>
      <h4>{spec.title}</h4>
      <p>{spec.description} Missing history withholds the value. Human review is separate.</p>
      {draft ? (
        <>
          <p>
            Saved request: rules revision {draft.request.policyVersion},{" "}
            {date(draft.request.period.start)} – {date(draft.request.period.end)}. These remain
            fixed if the dates or rules above change.
          </p>
          <p>Reason: {draft.request.reason}</p>
        </>
      ) : (
        <label>
          Collection reason
          <input
            value={reason}
            required
            maxLength={1000}
            disabled={busy || !ready}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      {progress && (
        <>
          <p role="status">
            {progress.processed.toLocaleString()} of {progress.population.toLocaleString()} retained
            items examined · {progress.covered.toLocaleString()} of{" "}
            {progress.eligible.toLocaleString()} eligible items covered · {progress.state}
          </p>
          <progress
            aria-label="Collection progress"
            max={Math.max(1, progress.population)}
            value={progress.processed}
          />
          {progress.endReason && <p>Reason this collection ended: {progress.endReason}</p>}
        </>
      )}
      {!terminal && (
        <button
          type="button"
          className="cp-secondary"
          disabled={
            busy || !ready || !canReview || (!draft && (!supported || exists || !reason.trim()))
          }
          onClick={() => void operate("run")}
        >
          {busy ? "Collecting…" : draft ? "Resume saved collection" : "Collect work evidence"}
        </button>
      )}
      {busy && (
        <button
          type="button"
          className="cp-secondary"
          onClick={() => {
            pause.current = true;
            setMessage("Pausing after the current request. No further batches will be sent.");
          }}
        >
          Pause after this batch
        </button>
      )}
      {draft && (
        <>
          <button
            type="button"
            className="cp-secondary"
            disabled={busy || !ready || !canReview}
            onClick={() => void operate("check")}
          >
            Check collection progress
          </button>
          {!terminal && (
            <details>
              <summary>End this collection</summary>
              <p>
                This ends the saved request and retains its evidence. It does not delete source
                history or an already completed measurement.
              </p>
              <label>
                Reason for ending
                <input
                  maxLength={1000}
                  value={endReason}
                  disabled={busy}
                  onChange={(e) => setEndReason(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="cp-secondary"
                disabled={busy || !ready || !canReview || !endReason.trim()}
                onClick={() => void operate("end")}
              >
                End saved collection
              </button>
            </details>
          )}
          {terminal && (
            <button
              type="button"
              className="cp-secondary"
              disabled={busy || !ready || !canReview}
              onClick={() => void operate("clear")}
            >
              Clear finished request reminder
            </button>
          )}
          {progress?.state === "completed" && (
            <>
              <button
                type="button"
                className="cp-secondary"
                disabled={busy || !canReview}
                onClick={() => void review()}
              >
                Review collected rules and dates
              </button>
              <LearnWorkCollectionEvidence
                tenantId={tenantId}
                requestId={draft.request.requestId}
              />
            </>
          )}
        </>
      )}
      <p>
        Closing or reloading pauses further batches. This browser retains the original request for
        your account; keep its browser data until the outcome is confirmed.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
