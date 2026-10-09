import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  loadWorkTimeline,
  loadWorkOwnerLabels,
  type WorkTimeline,
  type WorkHistoryScope,
  type WorkOwnerRef,
} from "@/lib/learn-work-history";

const number = (n: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(n);
const date = (s: string) =>
  new Date(s).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });
export function LearnWorkHistory({
  tenantId,
  objectId,
  canReview,
}: {
  tenantId: string;
  objectId: string;
  canReview: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="lp-panel lw-panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Ownership & time on this work</summary>
      {open &&
        (canReview ? (
          <HistoryQuery key={`${tenantId}:${objectId}`} tenantId={tenantId} objectId={objectId} />
        ) : (
          <p>Work history review is available to your company’s owner and admins.</p>
        ))}
    </details>
  );
}
function HistoryQuery({ tenantId, objectId }: { tenantId: string; objectId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() =>
    new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10),
  );
  const [until, setUntil] = useState(today);
  const [query, setQuery] = useState({ from, until, revision: 0 });
  const valid =
    !!from &&
    !!until &&
    from < until &&
    until <= today &&
    Date.parse(until) - Date.parse(from) <= 366 * 86400000;
  return (
    <>
      <p>
        Review the recorded owners, state changes and elapsed time for this item. Working hours and
        approved delays have not been applied.
      </p>
      <form
        className="lp-period"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setQuery({ from, until, revision: query.revision + 1 });
        }}
      >
        <label>
          Start date (UTC)
          <input type="date" value={from} max={until} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          End date, not included (UTC)
          <input type="date" value={until} max={today} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <button type="submit" disabled={!valid}>
          Read work history
        </button>
      </form>
      {!valid && (
        <p role="status">
          Choose a completed period of up to 366 days, with the end after the start.
        </p>
      )}
      <HistoryResult
        key={`${query.from}:${query.until}:${query.revision}`}
        scope={{
          tenantId,
          objectId,
          period: { start: query.from + "T00:00:00Z", end: query.until + "T00:00:00Z" },
        }}
      />
    </>
  );
}
function HistoryResult({ scope }: { scope: WorkHistoryScope }) {
  const [value, setValue] = useState<{
    timeline: WorkTimeline;
    labels: Record<string, string>;
    labelsMissing: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const db = getSupabaseClient();
        const timeline = await loadWorkTimeline(db, scope);
        let labels: Record<string, string> = {},
          labelsMissing = false;
        try {
          labels = await loadWorkOwnerLabels(db, timeline);
        } catch {
          labelsMissing = true;
        }
        if (active) setValue({ timeline, labels, labelsMissing });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Work history could not be read");
      }
    })();
    return () => {
      active = false;
    };
  }, [scope.tenantId, scope.objectId, scope.period.start, scope.period.end]);
  if (error)
    return (
      <p role="alert" className="lc-missing">
        {error}. No duration has been assessed.
      </p>
    );
  if (!value) return <p role="status">Reading captured work history…</p>;
  const { timeline: t, labels } = value;
  const owner = (r: WorkOwnerRef | null) =>
    r ? (labels[`${r.kind}:${r.ref}`] ?? `${r.kind}: ${r.ref}`) : "No recorded owner";
  return (
    <div className="lw-result">
      <strong>
        {t.coverage === "complete"
          ? "The selected period has continuous captured history"
          : t.coverage === "partial"
            ? "Part of this period has no captured history"
            : "No captured history covers this period"}
      </strong>
      <p>
        {number(t.knownMinutes)} recorded minutes · {number(t.unknownMinutes)} minutes without
        history · {t.handoffs.length} recorded owner{" "}
        {t.handoffs.length === 1 ? "change" : "changes"}
      </p>
      {t.coverage !== "complete" && (
        <p className="lc-missing">Missing time cannot establish how long anyone held this work.</p>
      )}
      <p className="lc-observed">
        Period: {date(t.period.start)} to {date(t.period.end)} UTC. Read {date(t.observedAt)} UTC.
      </p>
      {t.intervals.length > 0 && (
        <div className="lw-table-wrap">
          <table>
            <caption>Recorded work intervals — elapsed clock time, before scoring review</caption>
            <thead>
              <tr>
                <th>From / until (UTC)</th>
                <th>Recorded owner</th>
                <th>State</th>
                <th>Minutes</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {t.intervals.map((i, index) => (
                <tr key={`${i.start}:${index}`}>
                  <td>
                    {date(i.start)}
                    <br />
                    {date(i.end)}
                  </td>
                  <td>
                    {owner(i.responsible)}
                    <small>Accountable: {owner(i.accountable)}</small>
                  </td>
                  <td>
                    {i.state}
                    {i.waitingOn && <small>Waiting on {owner(i.waitingOn)}</small>}
                  </td>
                  <td>{number(i.elapsedMinutes)}</td>
                  <td>
                    <details>
                      <summary>Source records</summary>
                      {i.evidenceIds.map((id) => (
                        <code key={id}>{id}</code>
                      ))}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {t.handoffs.length > 0 && (
        <>
          <h5>Recorded owner changes</h5>
          <ul>
            {t.handoffs.map((h) => (
              <li key={h.evidenceId}>
                {date(h.occurredAt)} UTC: {owner(h.from)} → {owner(h.to)}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="lc-observed">
        Names are current directory labels. Historical team membership and legacy user references
        still need verification before personal scoring.
        {value.labelsMissing ? " Some names could not be loaded; stored references are shown." : ""}
      </p>
    </div>
  );
}
