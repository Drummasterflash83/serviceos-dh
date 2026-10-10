import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  assessmentRequest,
  loadAssessmentHistory,
  loadSavedAssessment,
  saveAssessment,
  type AssessmentSummary,
  type SavedAssessment,
  type SaveAssessmentRequest,
} from "@/lib/learn-assessments";
import type { ReviewedPerformanceMeasurement } from "@/lib/learn-performance-measurements";
import type { ScorecardPolicy, ScoreSubject, ScorePeriod } from "@/lib/learn-scorecards";
const date = (s: string) => new Date(s).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
const number = (v: number | null) =>
  v === null
    ? "Not assessed"
    : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(v);
export function LearnAssessmentHistory({
  tenantId,
  subject,
  current,
}: {
  tenantId: string;
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
  const pending = useRef<SaveAssessmentRequest | null>(null),
    busy = useRef(false);
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
  async function save() {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setMessage("");
    try {
      if (!pending.current) {
        if (!current) throw Error("Load published rules and evidence first");
        pending.current = assessmentRequest(
          current.policy,
          subject,
          current.period,
          current.rows,
          reason,
          crypto.randomUUID(),
        );
      }
      const receipt = await saveAssessment(getSupabaseClient(), pending.current);
      pending.current = null;
      setReason("");
      setMessage(
        receipt.reused
          ? "Earlier save recovered. No duplicate was created."
          : "Assessment retained with its rules, evidence and review decisions.",
      );
      setSelected(receipt.assessmentId);
      setRevision((r) => r + 1);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Assessment save was not confirmed";
      setMessage(text);
      if (text.startsWith("Evidence or rules changed.")) pending.current = null;
    } finally {
      busy.current = false;
      setSaving(false);
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
          disabled={saving || !!pending.current}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {pending.current && (
        <p>
          Retry is fixed to {date(pending.current.period.start)} –{" "}
          {date(pending.current.period.end)} and the original reason. Keep this card open until the
          save is confirmed.
        </p>
      )}
      <button
        className="cp-secondary"
        type="button"
        onClick={() => void save()}
        disabled={
          saving ||
          (!pending.current &&
            (!current || current.policy.status !== "published" || !reason.trim()))
        }
      >
        {saving
          ? "Saving…"
          : pending.current
            ? "Retry same assessment save"
            : "Save published assessment"}
      </button>
      {current?.policy.status !== "published" && !pending.current && (
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
