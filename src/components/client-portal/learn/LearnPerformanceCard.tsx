import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import { loadScorecardDraft } from "@/lib/learn-scorecard-settings";
import {
  loadPerformanceMeasurements,
  type ReviewedPerformanceMeasurement,
} from "@/lib/learn-performance-measurements";
import { reviewPerformanceMeasurement, type ReviewRequest } from "@/lib/learn-performance-reviews";
import { loadPerformanceEvidence } from "@/lib/learn-performance-evidence";
import {
  evaluateScorecard,
  type ScorecardPolicy,
  type ScorecardResult,
  type EvidenceRef,
  type ScoreSubject,
} from "@/lib/learn-scorecards";
const date = (s: string) => new Date(s).toLocaleString("en-GB");
const number = (n: number | null) =>
  n === null
    ? "Not assessed"
    : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n);
type Props = {
  tenantId: string;
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
function Assessment({ tenantId, kind, id, groupId, canReview }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() =>
      new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10),
    ),
    [until, setUntil] = useState(today);
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
        const period = {
          start: new Date(query.from).toISOString(),
          end: new Date(query.until).toISOString(),
        };
        if (
          Date.parse(period.end) > Date.now() ||
          Date.parse(period.start) >= Date.parse(period.end)
        )
          throw Error("Choose a completed period with the end after the start.");
        const policy = await loadScorecardDraft(getSupabaseClient(), tenantId, kind, groupId);
        if (!policy) {
          if (active)
            setMessage(
              "No scoring rules are saved for this card’s scope. Configure the measures and scale in scoring settings first.",
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
  }, [tenantId, kind, id, groupId, query]);
  const current = from === query.from && until === query.until ? loaded : null;
  const refresh = () => setQuery({ from, until, revision: query.revision + 1 });
  return (
    <div className="lp-content">
      <p>
        Review the measurements behind this card. A draft simulation does not activate a score or
        change pay.
      </p>
      <form
        className="lp-period"
        onSubmit={(e) => {
          e.preventDefault();
          refresh();
        }}
      >
        <label>
          From (UTC, inclusive)
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </label>
        <label>
          Until (UTC, exclusive)
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            max={today}
            required
          />
        </label>
        <button className="cp-secondary" disabled={loading} type="submit">
          {loading ? "Reading…" : "Load / refresh assessment"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
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
                  Weight {metric.weight} · {number(metric.value)} {metric.unit} · score{" "}
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
                      {number(m.value)} {m.unit} · {m.review}
                    </summary>
                    <p>
                      Source observed {date(m.observedAt)} · source coverage through{" "}
                      {m.sourceThrough ? date(m.sourceThrough) : "unknown"}.
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
                      <ReviewForm
                        key={`${m.id}:${m.reviews.length}:${query.revision}`}
                        tenantId={tenantId}
                        measurement={m}
                        onRecorded={refresh}
                      />
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
        metadata, not an immutable capture of the original source.
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
function Evidence({ tenantId, reference }: { tenantId: string; reference: EvidenceRef }) {
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
      <summary>
        {reference.table.replaceAll("_", " ")} · {reference.id}
      </summary>
      {open &&
        (error ? (
          <p>{error}</p>
        ) : data ? (
          <dl>
            {data.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>Reading source…</p>
        ))}
    </details>
  );
}
