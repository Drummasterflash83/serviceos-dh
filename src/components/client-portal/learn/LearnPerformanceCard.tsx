import { LearnAssessmentHistory } from "./LearnAssessmentHistory";
import {
  correctPerformanceMeasurement,
  type CorrectionRequest,
} from "@/lib/learn-performance-corrections";
import { assessmentPeriod, assessmentTimeField } from "@/lib/learn-assessment-period";
import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { loadPublishedScorecard } from "@/lib/learn-scorecard-publication";
import { loadScorecardDraft } from "@/lib/learn-scorecard-settings";
import {
  loadPerformanceMeasurements,
  type ReviewedPerformanceMeasurement,
} from "@/lib/learn-performance-measurements";
import { reviewPerformanceMeasurement, type ReviewRequest } from "@/lib/learn-performance-reviews";
import { LearnWorkCollections, type RetainedWorkReview } from "./LearnWorkCollections";
import { LearnWorkCollectionEvidence } from "./LearnWorkCollectionEvidence";
import { loadPerformanceEvidence } from "@/lib/learn-performance-evidence";
import {
  evaluateScorecard,
  type ScorecardPolicy,
  type ScorecardResult,
  type EvidenceRef,
  type ScoreSubject,
} from "@/lib/learn-scorecards";
const unitLabel = (s: string) => (s === "item_minutes" ? "item-minutes" : s);
const date = (s: string) => new Date(s).toLocaleString("en-GB");
const number = (n: number | null) =>
  n === null
    ? "Not assessed"
    : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n);
type Props = {
  tenantId: string;
  actorId: string;
  kind: ScoreSubject["kind"];
  id: string;
  groupId: string | null;
  canReview: boolean;
};
export function LearnPerformanceCard(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <details className="lp-panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Performance evidence & score preview</summary>
      {open &&
        (props.canReview ? (
          <Assessment {...props} />
        ) : (
          <p>Performance evidence is currently available to your company’s owner and admins.</p>
        ))}
    </details>
  );
}
function Assessment({ tenantId, actorId, kind, id, groupId, canReview }: Props) {
  const [retainedReview, setRetainedReview] = useState<RetainedWorkReview | null>(null);
  const nowField = assessmentTimeField();
  const [from, setFrom] = useState(() => assessmentTimeField(Date.now() - 7 * 86400000)),
    [until, setUntil] = useState(nowField);
  const [ruleMode, setRuleMode] = useState<"draft" | "published">("draft");
  const [query, setQuery] = useState({ from, until, revision: 0 });
  const [loaded, setLoaded] = useState<{
    policy: ScorecardPolicy;
    rows: ReviewedPerformanceMeasurement[];
    score: ScorecardResult;
    at: string;
  } | null>(null);
  const [message, setMessage] = useState("Reading performance evidence…"),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setLoading(true);
    setMessage("Reading performance evidence…");
    void (async () => {
      try {
        const period = retainedReview?.period ?? assessmentPeriod(query.from, query.until);
        const policy =
          retainedReview?.policy ??
          (ruleMode === "published"
            ? await loadPublishedScorecard(getSupabaseClient(), tenantId, kind, groupId, period)
            : await loadScorecardDraft(getSupabaseClient(), tenantId, kind, groupId));
        if (!policy) {
          if (active)
            setMessage(
              ruleMode === "published"
                ? "No published rules cover this period. Earlier dates cannot inherit newly published rules. You can review a draft simulation instead."
                : "No scoring rules are saved for this card’s scope. Configure the measures and scale in scoring settings first.",
            );
          return;
        }
        const subject: ScoreSubject = { kind, id, groupIds: groupId ? [groupId] : [] };
        const rows = await loadPerformanceMeasurements(
          getSupabaseClient(),
          policy,
          subject,
          period,
        );
        const score = evaluateScorecard(policy, subject, period, rows);
        if (active) {
          setLoaded({ policy, rows, score, at: new Date().toISOString() });
          setMessage("");
        }
      } catch (e) {
        if (active)
          setMessage(e instanceof Error ? e.message : "Performance evidence could not be read.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tenantId, kind, id, groupId, query, ruleMode, retainedReview]);
  const current = retainedReview || (from === query.from && until === query.until) ? loaded : null;
  const refresh = () => setQuery({ from, until, revision: query.revision + 1 });
  return (
    <div className="lp-content">
      <p>
        Review the measurements behind this card. A draft simulation does not activate a score or
        change pay.
      </p>
      <label>
        Rules to review
        <select
          value={ruleMode}
          onChange={(e) => {
            setRetainedReview(null);
            setLoaded(null);
            setRuleMode(e.target.value as "draft" | "published");
          }}
        >
          <option value="draft">Draft simulation</option>
          <option value="published">Published rules for these dates</option>
        </select>
      </label>
      {retainedReview ? (
        <p>
          Reviewing the retained draft rules, revision {retainedReview.policy.version}, for{" "}
          {retainedReview.period.start} – {retainedReview.period.end}. This is a draft simulation.{" "}
          <button
            type="button"
            className="cp-secondary"
            onClick={() => {
              setRetainedReview(null);
              setLoaded(null);
              refresh();
            }}
          >
            Return to selected rules and dates
          </button>
        </p>
      ) : (
        <form
          className="lp-period"
          onSubmit={(e) => {
            e.preventDefault();
            refresh();
          }}
        >
          <label>
            From (UTC, inclusive)
            <input
              type="datetime-local"
              step="1"
              value={from}
              onInput={(e) => setFrom(e.currentTarget.value)}
              onChange={(e) => setFrom(e.target.value)}
              required
            />
          </label>
          <label>
            Until (UTC, exclusive)
            <input
              type="datetime-local"
              step="1"
              value={until}
              onInput={(e) => setUntil(e.currentTarget.value)}
              onChange={(e) => setUntil(e.target.value)}
              max={nowField}
              required
            />
          </label>
          <button
            className="cp-secondary"
            type="button"
            onClick={() => setUntil(assessmentTimeField())}
          >
            Through now
          </button>
          <button className="cp-secondary" disabled={loading} type="submit">
            {loading ? "Reading…" : "Load / refresh assessment"}
          </button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <LearnAssessmentHistory
        key={`${actorId}:${tenantId}:${kind}:${id}`}
        tenantId={tenantId}
        actorId={actorId}
        canReview={canReview}
        subject={{ kind, id, groupIds: groupId ? [groupId] : [] }}
        current={
          current
            ? { policy: current.policy, rows: current.rows, period: current.score.period }
            : null
        }
      />
      <LearnWorkCollections
        tenantId={tenantId}
        actorId={actorId}
        subjectId={id}
        subjectKind={kind}
        canReview={canReview}
        current={
          current
            ? { policy: current.policy, period: current.score.period, rows: current.rows }
            : null
        }
        onSaved={refresh}
        onReview={(selection) => {
          if (
            selection.subject.id !== id ||
            selection.subject.kind !== kind ||
            selection.policy.tenantId !== tenantId
          )
            return;
          setLoaded(null);
          setRetainedReview(selection);
          setRuleMode("draft");
        }}
      />
      {!current && loaded && <p>Load the selected dates before reviewing.</p>}
      {current && (
        <>
          <h3>
            {current.policy.name} · revision {current.policy.version}
          </h3>
          <p className="lp-score">
            {current.policy.status === "draft" ? "Draft simulation" : "Advisory score"}:{" "}
            <strong>
              {number(
                current.policy.status === "draft"
                  ? current.score.previewScore
                  : current.score.score,
              )}
            </strong>{" "}
            / {current.score.scaleMax}
          </p>
          <p>
            Evidence read {date(current.at)}. Refresh to check for changes. Missing or disputed
            evidence remains unassessed.
          </p>
          {!current.rows.length && (
            <p>
              No stored measurements were returned for this exact subject, period and rule revision.
            </p>
          )}
          {current.score.metrics.map((metric) => {
            const observations = current.rows.filter((r) => r.metricKey === metric.key);
            const replaced = new Set(observations.map((r) => r.supersedes));
            return (
              <article className="lp-metric" key={metric.key}>
                <h4>{metric.label}</h4>
                <p>
                  Weight {metric.weight} · {number(metric.value)} {unitLabel(metric.unit)} · score{" "}
                  {number(metric.score)} / {current.score.scaleMax}
                </p>
                {!!metric.reasons.length && (
                  <ul>
                    {metric.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                )}
                {observations.map((m) => (
                  <details
                    key={`${m.id}:${query.revision}`}
                    className="lp-observation"
                    open={!replaced.has(m.id)}
                  >
                    <summary>
                      {replaced.has(m.id) ? "Earlier observation" : "Current observation"}:{" "}
                      {number(m.value)} {unitLabel(m.unit)} · {m.review}
                    </summary>
                    <p>
                      Source observed {date(m.sourceObservedAt ?? m.observedAt)} · source coverage
                      through {m.sourceThrough ? date(m.sourceThrough) : "unknown"}.
                    </p>
                    <p>
                      {m.sampleCount} samples · {m.coveredCount} of {m.eligibleCount ?? "unknown"}{" "}
                      eligible records covered.
                    </p>
                    <EvidenceList tenantId={tenantId} refs={m.evidence} />
                    {!!m.exclusions.length && (
                      <div>
                        <h5>Recorded exclusions</h5>
                        {m.exclusions.map((x, i) => (
                          <div key={i}>
                            <p>
                              {x.reason}: {x.count}
                            </p>
                            <EvidenceList tenantId={tenantId} refs={x.evidence} />
                          </div>
                        ))}
                      </div>
                    )}
                    <details>
                      <summary>Measurement and review history</summary>
                      <p>
                        Measurement: {m.id}
                        {m.supersedes ? ` · corrects ${m.supersedes}` : ""}
                      </p>
                      {m.correction && (
                        <div>
                          <p>
                            Value corrected from {number(m.correction.previous_value)} to{" "}
                            {number(m.correction.corrected_value)} {unitLabel(m.unit)} ·{" "}
                            {date(m.correction.created_at)}
                          </p>
                          <p>{m.correction.reason}</p>
                          <small>
                            Corrected by: {m.correction.corrected_by}. Original source timing and
                            evidence retained.
                          </small>
                        </div>
                      )}
                      {!m.reviews.length && <p>No human review recorded.</p>}
                      <ol>
                        {m.reviews.map((r) => (
                          <li key={r.id}>
                            {r.decision} · review {r.revision} · {date(r.created_at)}
                            <p>{r.reason}</p>
                            <small>Reviewer: {r.reviewed_by}</small>
                          </li>
                        ))}
                      </ol>
                    </details>
                    {!replaced.has(m.id) && canReview && (
                      <div>
                        <CorrectionForm tenantId={tenantId} measurement={m} onRecorded={refresh} />
                        <ReviewForm
                          key={`${m.id}:${m.reviews.length}:${query.revision}`}
                          tenantId={tenantId}
                          measurement={m}
                          onRecorded={refresh}
                        />
                      </div>
                    )}
                  </details>
                ))}
              </article>
            );
          })}
        </>
      )}
    </div>
  );
}
function CorrectionForm({
  tenantId,
  measurement,
  onRecorded,
}: {
  tenantId: string;
  measurement: ReviewedPerformanceMeasurement;
  onRecorded: () => void;
}) {
  const [value, setValue] = useState(measurement.value === null ? "" : String(measurement.value));
  const [withheld, setWithheld] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<CorrectionRequest | null>(null);
  const corrected = withheld ? null : value.trim() ? Number(value) : NaN;
  const valid =
    (corrected === null || Number.isFinite(corrected)) &&
    corrected !== measurement.value &&
    !!reason.trim();
  async function submit() {
    if (busy || (!pending.current && !valid)) return;
    pending.current ??= {
      tenantId,
      measurementId: measurement.id,
      requestId: crypto.randomUUID(),
      expectedReviewRevision: measurement.reviews.at(-1)?.revision ?? 0,
      value: corrected,
      reason,
    };
    setFrozen(true);
    setBusy(true);
    setMessage("");
    try {
      await correctPerformanceMeasurement(getSupabaseClient(), pending.current);
      onRecorded();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Correction could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="lp-review">
      <summary>Correct or withhold this value</summary>
      <p>
        The original value, source evidence, coverage and timing stay in the history. The new value
        needs a separate evidence review before it can support a score.
      </p>
      <label>
        Corrected value ({unitLabel(measurement.unit)})
        <input
          type="number"
          step="any"
          value={value}
          disabled={frozen || withheld}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <label className="lp-check">
        <input
          type="checkbox"
          checked={withheld}
          disabled={frozen}
          onChange={(e) => setWithheld(e.target.checked)}
        />
        Withhold this value (not assessed)
      </label>
      <label>
        Correction reason
        <textarea
          maxLength={1000}
          value={reason}
          disabled={frozen}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        className="cp-secondary"
        disabled={busy || (!frozen && !valid)}
        onClick={() => void submit()}
      >
        {busy ? "Recording correction…" : frozen ? "Retry same correction" : "Record correction"}
      </button>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
function ReviewForm({
  tenantId,
  measurement,
  onRecorded,
}: {
  tenantId: string;
  measurement: ReviewedPerformanceMeasurement;
  onRecorded: () => void;
}) {
  const [reason, setReason] = useState(""),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const pending = useRef<ReviewRequest | null>(null);
  const [frozen, setFrozen] = useState(false);
  async function submit(decision: "confirmed" | "disputed") {
    if (busy) return;
    if (!pending.current && (!reason.trim() || (decision === "confirmed" && !checked))) {
      setMessage("Add a reason and confirm you checked the sources before confirming evidence.");
      return;
    }
    pending.current ??= {
      tenantId,
      measurementId: measurement.id,
      requestId: crypto.randomUUID(),
      expectedRevision: measurement.reviews.at(-1)?.revision ?? 0,
      decision,
      reason,
    };
    setFrozen(true);
    setBusy(true);
    setMessage("");
    try {
      await reviewPerformanceMeasurement(getSupabaseClient(), pending.current);
      onRecorded();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Review could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lp-review">
      <label>
        Review reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={frozen}
          maxLength={1000}
        />
      </label>
      <label className="lp-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          disabled={frozen}
        />
        I checked the source records, calculation and exclusions.
      </label>
      <div className="lp-actions">
        {frozen ? (
          <button
            className="cp-secondary"
            disabled={busy}
            onClick={() => void submit(pending.current!.decision)}
          >
            {busy ? "Recording…" : "Retry same review"}
          </button>
        ) : (
          <>
            <button
              className="cp-secondary"
              disabled={!checked || !reason.trim()}
              onClick={() => void submit("confirmed")}
            >
              Confirm evidence
            </button>
            <button
              className="cp-secondary"
              disabled={!reason.trim()}
              onClick={() => void submit("disputed")}
            >
              Dispute evidence
            </button>
          </>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
function EvidenceList({ tenantId, refs }: { tenantId: string; refs: EvidenceRef[] }) {
  const [limit, setLimit] = useState(10);
  return (
    <div className="lp-evidence">
      <p>
        {refs.length} supporting source reference(s). These show current stored excerpts or
        metadata. Work calculation receipts retain their original proof; other excerpts show current
        source data.
      </p>
      {refs.slice(0, limit).map((ref, i) => (
        <Evidence key={`${ref.table}:${ref.id}:${i}`} tenantId={tenantId} reference={ref} />
      ))}
      {refs.length > limit && (
        <button className="cp-secondary" onClick={() => setLimit((n) => n + 10)}>
          Show more sources ({refs.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
const evidenceTitles: Record<string, string> = {
  interactions: "Communication excerpt",
  email_messages: "Email excerpt",
  phone_calls: "Call details",
  phone_recordings: "Recording details",
  jobs: "Job details",
  team_members: "Team member details",
  learn_team_work_measurement_runs: "Retained team workload calculation",
  learn_work_measurement_runs: "Calculation record",
};
const evidenceLabels: Record<string, string> = {
  snippet: "Excerpt",
  "body preview": "Excerpt",
  summary: "Stored summary",
  "sent at": "Sent",
  "received at": "Received",
  "started at": "Started",
  "occurred at": "Occurred",
  "source connector id": "Source",
  direction: "Provider direction",
  outcome: "Provider outcome",
  "duration seconds": "Duration",
};
function evidenceValue(label: string, value: string) {
  if (
    ["sent at", "received at", "started at", "occurred at"].includes(label) &&
    Number.isFinite(Date.parse(value))
  )
    return new Date(value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
  return label === "duration seconds" ? value + " seconds" : value;
}
function Evidence(props: { tenantId: string; reference: EvidenceRef }) {
  return props.reference.table === "learn_work_collection_runs" ? (
    <LearnWorkCollectionEvidence tenantId={props.tenantId} requestId={props.reference.id} />
  ) : (
    <LegacyEvidence {...props} />
  );
}
function LegacyEvidence({ tenantId, reference }: { tenantId: string; reference: EvidenceRef }) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<{ label: string; value: string }[] | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setData(null);
    setError("");
    void loadPerformanceEvidence(getSupabaseClient(), tenantId, reference).then(
      (r) => {
        if (active) setData(r);
      },
      () => {
        if (active) setError("Source unavailable with your current access.");
      },
    );
    return () => {
      active = false;
    };
  }, [open, tenantId, reference.table, reference.id]);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{evidenceTitles[reference.table] ?? "Supporting evidence"}</summary>
      {open &&
        (error ? (
          <p>{error}</p>
        ) : data?.length === 0 ? (
          <p>This source record has no excerpt or metadata to display.</p>
        ) : data ? (
          <div>
            <dl>
              {data.map((f) => (
                <div key={f.label}>
                  <dt>{evidenceLabels[f.label] ?? f.label}</dt>
                  <dd>{evidenceValue(f.label, f.value)}</dd>
                </div>
              ))}
            </dl>
            <small>Source reference: {reference.id}</small>
          </div>
        ) : (
          <p>Reading source…</p>
        ))}
    </details>
  );
}
