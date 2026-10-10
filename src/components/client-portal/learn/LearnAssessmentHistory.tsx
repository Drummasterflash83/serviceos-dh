import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  assessmentRequest,
  loadAssessmentHistory,
  loadSavedAssessment,
  type AssessmentSummary,
  type SavedAssessment,
} from "@/lib/learn-assessments";
import {
  assessmentOutboxKey,
  prepareAssessmentDraft,
  readAssessmentDraft,
  recoverAssessmentDraft,
  type AssessmentDraft,
} from "@/lib/learn-assessment-outbox";
import type { RecoveryLock } from "@/lib/learn-slack-recovery-outbox";
const lock: RecoveryLock = async (key, task) => {
  if (!navigator.locks) throw Error("Use a browser that supports saved-request coordination.");
  return navigator.locks.request(key, task);
};
import type { ReviewedPerformanceMeasurement } from "@/lib/learn-performance-measurements";
import type { ScorecardPolicy, ScoreSubject, ScorePeriod } from "@/lib/learn-scorecards";
const date = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
const number = (v: number | null) =>
  v === null
    ? "Not assessed"
    : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(v);
export function LearnAssessmentHistory({
  tenantId,
  actorId,
  canReview,
  subject,
  current,
}: {
  tenantId: string;
  actorId: string;
  canReview: boolean;
  subject: ScoreSubject;
  current: {
    policy: ScorecardPolicy;
    period: ScorePeriod;
    rows: ReviewedPerformanceMeasurement[];
  } | null;
}) {
  const [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [revision, setRevision] = useState(0);
  const scope = { backend: supabaseConfig.url.replace(/\/$/, ""), tenantId, actorId, subject };
  const [pending, setPending] = useState<AssessmentDraft | null>(null),
    [storageReady, setStorageReady] = useState(false);
  const busy = useRef(false),
    live = useRef(false),
    editable = useRef(canReview);
  editable.current = canReview;
  function restore() {
    try {
      const draft = readAssessmentDraft(localStorage, scope);
      setPending(draft);
      if (draft) setReason(draft.request.reason);
      setStorageReady(true);
    } catch (e) {
      setStorageReady(false);
      setMessage(e instanceof Error ? e.message : "Saved requests are unavailable.");
    }
  }
  useEffect(() => {
    live.current = true;
    restore();
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === assessmentOutboxKey(scope)) {
        restore();
        setMessage(
          "Saved assessment details changed in another tab. Review them before continuing.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, subject.kind, subject.id]);
  const [history, setHistory] = useState<AssessmentSummary[]>([]),
    [total, setTotal] = useState(0),
    [historyMessage, setHistoryMessage] = useState("Reading saved assessments…");
  const [selected, setSelected] = useState<string | null>(null),
    [saved, setSaved] = useState<SavedAssessment | null>(null),
    [savedMessage, setSavedMessage] = useState("");
  useEffect(() => {
    let active = true;
    setHistoryMessage("Reading saved assessments…");
    setHistory([]);
    void loadAssessmentHistory(getSupabaseClient(), tenantId, subject)
      .then((r) => {
        if (active) {
          setHistory(r.rows);
          setTotal(r.total);
          setHistoryMessage(r.total ? "" : "No saved assessments for this card yet.");
        }
      })
      .catch((e) => {
        if (active)
          setHistoryMessage(
            e instanceof Error ? e.message : "Assessment history could not be read",
          );
      });
    return () => {
      active = false;
    };
  }, [tenantId, subject.kind, subject.id, revision]);
  useEffect(() => {
    let active = true;
    setSaved(null);
    setSavedMessage(selected ? "Reading retained assessment…" : "");
    if (selected)
      void loadSavedAssessment(getSupabaseClient(), tenantId, subject, selected)
        .then((r) => {
          if (active) {
            setSaved(r);
            setSavedMessage("");
          }
        })
        .catch((e) => {
          if (active)
            setSavedMessage(e instanceof Error ? e.message : "Assessment could not be read");
        });
    return () => {
      active = false;
    };
  }, [tenantId, subject.kind, subject.id, selected]);
  async function recover(action: "save" | "check" | "cancel") {
    if (busy.current || !storageReady || !canReview) return;
    busy.current = true;
    setSaving(true);
    setMessage("");
    try {
      if (!pending && (action !== "save" || !current))
        throw Error("Load published rules and evidence first");
      const draft =
        pending ??
        prepareAssessmentDraft(
          scope,
          assessmentRequest(
            current!.policy,
            subject,
            current!.period,
            current!.rows,
            reason,
            crypto.randomUUID(),
          ),
        );
      const receipt = await recoverAssessmentDraft(
        getSupabaseClient(),
        localStorage,
        lock,
        scope,
        draft,
        action,
        () => live.current && editable.current,
      );
      if (!live.current) return;
      if (receipt.state === "pending") {
        setMessage(
          "No completed save was found. Retry this request, or cancel it before starting another.",
        );
      } else {
        setReason("");
        setMessage(
          receipt.state === "recorded"
            ? "Assessment confirmed with its retained rules, evidence and review decisions."
            : "Unfinished save cancelled. Reload the rules and evidence before a new assessment.",
        );
        if (receipt.state === "recorded") setSelected(receipt.assessmentId);
        setRevision((r) => r + 1);
      }
    } catch (e) {
      if (live.current)
        setMessage(e instanceof Error ? e.message : "Assessment save was not confirmed");
    } finally {
      busy.current = false;
      if (live.current) {
        restore();
        setSaving(false);
      }
    }
  }
  return (
    <section className="lp-panel lp-history" aria-label="Saved assessments">
      <h3>Saved assessments</h3>
      <p>
        Retain the published rules and evidence used for this review. Later reviews and corrections
        leave earlier assessments intact. An incomplete assessment stays unassessed.
      </p>
      <label>
        Reason for retaining this assessment
        <textarea
          value={reason}
          maxLength={1000}
          disabled={saving || !!pending}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {pending && (
        <p>
          Retry is fixed to {date(pending.request.period.start)} –{" "}
          {date(pending.request.period.end)} and the original reason. This browser keeps the request
          if you close or refresh this card. Check its status, retry it, or cancel the unfinished
          save. A completed assessment stays retained.
        </p>
      )}
      <button
        className="cp-secondary"
        type="button"
        onClick={() => void recover("save")}
        disabled={
          saving ||
          !storageReady ||
          !canReview ||
          (!pending && (!current || current.policy.status !== "published" || !reason.trim()))
        }
      >
        {saving ? "Saving…" : pending ? "Retry same assessment save" : "Save published assessment"}
      </button>
      {pending && (
        <>
          <button
            type="button"
            className="cp-secondary"
            disabled={saving || !storageReady || !canReview}
            onClick={() => void recover("check")}
          >
            Check saved request
          </button>
          <button
            type="button"
            className="cp-secondary"
            disabled={saving || !storageReady || !canReview}
            onClick={() => void recover("cancel")}
          >
            Cancel unfinished save
          </button>
        </>
      )}
      <p>
        Unconfirmed requests are kept for your account in this browser. Keep its data until the
        outcome is confirmed; recovery details are not shared across devices.
      </p>
      {current?.policy.status !== "published" && !pending && (
        <p>Load published rules for the selected dates to save an assessment.</p>
      )}
      {message && <p role="status">{message}</p>}
      {historyMessage && <p role="status">{historyMessage}</p>}
      {!!history.length && (
        <>
          <p>
            Showing the latest {history.length} of {total} saved assessments.
          </p>
          <ul>
            {history.map((r) => (
              <li key={r.id}>
                <button
                  className="cp-secondary"
                  type="button"
                  onClick={() => setSelected(r.id)}
                  aria-pressed={selected === r.id}
                >
                  {date(r.recorded_at)} · {r.reason}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {savedMessage && <p role="status">{savedMessage}</p>}
      {saved && (
        <div className="lp-content">
          <h4>Retained assessment · {date(saved.summary.recorded_at)}</h4>
          <p>
            {saved.policy.name} · revision {saved.policy.version} ·{" "}
            {date(saved.summary.window_start)} – {date(saved.summary.window_end)}
          </p>
          <p className="lp-score">
            Advisory score: <strong>{number(saved.score.score)}</strong> / {saved.score.scaleMax}
          </p>
          <p>{saved.summary.reason}</p>
          <p>
            This is the assessment at its saved time. It does not refresh with later evidence or
            approve a payment.
          </p>
          <div className="lp-history-table">
            <table>
              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Retained value</th>
                  <th>Score</th>
                  <th>Evidence status</th>
                </tr>
              </thead>
              <tbody>
                {saved.score.metrics.map((m) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td>
                      {number(m.value)} {m.unit}
                    </td>
                    <td>
                      {number(m.score)} / {saved.score.scaleMax}
                    </td>
                    <td>{m.reasons.join("; ") || "Confirmed for this assessment"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Retained review details</summary>
            <p>
              Recorded by {saved.summary.recorded_by}. Assessment {saved.summary.id}.
            </p>
            {saved.rows.map((m) => (
              <div key={m.id}>
                <p>
                  {m.metricKey}: {number(m.value)} {m.unit} · {m.review}
                </p>
                {m.correction && <p>Correction reason: {m.correction.reason}</p>}
                {m.reviews.map((r) => (
                  <p key={r.id}>
                    Review {r.revision}: {r.decision} · {r.reason} · {date(r.created_at)}
                  </p>
                ))}
              </div>
            ))}
          </details>
        </div>
      )}
    </section>
  );
}
