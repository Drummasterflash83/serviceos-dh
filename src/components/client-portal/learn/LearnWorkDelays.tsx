import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  delayApprovalPayload,
  mergeDelayHistory,
  readDelayCandidates,
  readDelayEvidence,
  readDelayPage,
  type DelayCandidates,
  type DelayEntry,
  type DelayHistory,
  type DelayPayload,
} from "@/lib/learn-work-delays";
import {
  delayOutboxKey,
  prepareDelayDraft,
  readDelayDraft,
  recoverDelayDraft,
  type DelayDraft,
  type DelayRecoveryLock,
} from "@/lib/learn-work-delay-outbox";
import type { TimeWindow } from "@/lib/learn-scorecards";
import { loadWorkReferenceLabels } from "@/lib/learn-work-history";
const inputInstant = (s: string) => (s.length === 16 ? s + ":00Z" : s + "Z");
const time = (s: string) =>
  s
    .replace("T", " ")
    .replace(/\.0+Z$/, "Z")
    .replace("Z", " UTC");
const owner = (v: { kind: string; ref: string } | null, labels: Record<string, string> = {}) =>
  v ? (labels[`${v.kind}:${v.ref}`] ?? `${v.kind}: ${v.ref}`) : "Not recorded";
const lock: DelayRecoveryLock = async (key, action) => {
  if (!navigator.locks)
    throw Error("Use a browser that supports saved-request coordination before reviewing delays.");
  return navigator.locks.request(key, action);
};
export function LearnWorkDelays({
  tenantId,
  actorId,
  objectId,
  period,
}: {
  tenantId: string;
  actorId: string;
  objectId: string;
  period: TimeWindow;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="lp-panel ld-panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Review approved delays on this work</summary>
      {open && (
        <DelayReview
          key={`${tenantId}:${actorId}:${objectId}`}
          tenantId={tenantId}
          actorId={actorId}
          objectId={objectId}
          period={period}
        />
      )}
    </details>
  );
}
function DelayReview({
  tenantId,
  actorId,
  objectId,
  period,
}: {
  tenantId: string;
  actorId: string;
  objectId: string;
  period: TimeWindow;
}) {
  const scope = useMemo(
    () => ({ backend: supabaseConfig.url.replace(/\/$/, ""), tenantId, actorId, objectId }),
    [tenantId, actorId, objectId],
  );
  const [historyPage, setHistoryPage] = useState(0);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<DelayHistory | null>(null),
    [fresh, setFresh] = useState(false),
    [candidates, setCandidates] = useState<DelayCandidates | null>(null),
    [sourceError, setSourceError] = useState("");
  const [pending, setPending] = useState<DelayDraft | null>(null),
    [storageError, setStorageError] = useState("");
  const [selected, setSelected] = useState<number | null>(null),
    [label, setLabel] = useState(""),
    [reason, setReason] = useState("");
  const [shorter, setShorter] = useState(false),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [reverseId, setReverseId] = useState<string | null>(null),
    [reverseReason, setReverseReason] = useState("");
  const [message, setMessage] = useState("Reading delay review history…"),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const alive = useRef(false),
    generation = useRef(0),
    working = useRef(false);
  const syncPending = () => {
    try {
      const value = readDelayDraft(localStorage, scope);
      setPending(value);
      setStorageError("");
      return value;
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Recovery details could not be read.",
      );
      return null;
    }
  };
  useEffect(() => {
    alive.current = true;
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === delayOutboxKey(scope)) {
        generation.current++;
        syncPending();
        setFresh(false);
        setMessage(
          "Saved request details changed in another tab. Reload the reviews before making a change.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      alive.current = false;
      window.removeEventListener("storage", changed);
    };
  }, [scope]);
  useEffect(() => {
    let active = true;
    const token = ++generation.current;
    const current = () => active && alive.current && token === generation.current;
    const retained = syncPending();
    setHistory(null);
    setHistoryPage(0);
    setFresh(false);
    setCandidates(null);
    setSourceError("");
    setSelected(null);
    setReverseId(null);
    setMessage(
      retained
        ? "An earlier delay request needs confirmation before another change."
        : "Reading saved decisions and captured intervals…",
    );
    void readDelayPage(getSupabaseClient(), tenantId, objectId)
      .then((page) => {
        if (current()) {
          setHistory(mergeDelayHistory(null, page));
          setHistoryPage(0);
          setFresh(true);
          if (!retained)
            setMessage(
              "Saved decisions loaded. A waiting state alone does not approve an exclusion.",
            );
        }
      })
      .catch((error) => {
        if (current())
          setMessage(error instanceof Error ? error.message : "Delay history unavailable.");
      });
    void readDelayCandidates(getSupabaseClient(), tenantId, objectId, period)
      .then((value) => {
        if (current()) setCandidates(value);
      })
      .catch((error) => {
        if (current())
          setSourceError(
            error instanceof Error ? error.message : "Captured intervals unavailable.",
          );
      });
    return () => {
      active = false;
    };
  }, [scope, period.start, period.end, reload]);
  useEffect(() => {
    let active = true;
    setLabels({});
    if (candidates)
      void loadWorkReferenceLabels(
        getSupabaseClient(),
        tenantId,
        candidates.intervals.flatMap((item) => [item.responsible, item.waitingOn]),
      )
        .then((value) => {
          if (active) setLabels(value);
        })
        .catch(() => {
          // Captured references remain visible when current directory labels cannot be read.
        });
    return () => {
      active = false;
    };
  }, [tenantId, candidates]);
  async function more() {
    if (!history?.hasMore || !fresh || working.current) return;
    const token = generation.current,
      old = history;
    working.current = true;
    setBusy(true);
    try {
      const page = await readDelayPage(
        getSupabaseClient(),
        tenantId,
        objectId,
        old.next,
        old.through,
      );
      if (alive.current && token === generation.current) {
        setHistory(mergeDelayHistory(old, page));
        setMessage("Next decisions loaded from the same retained history.");
      }
    } catch (error) {
      if (alive.current && token === generation.current)
        setMessage(
          (error instanceof Error ? error.message : "Next history page unavailable.") +
            " Earlier decisions remain visible; retry the same page.",
        );
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recover(draft: DelayDraft, action: "submit" | "check" | "cancel") {
    if (working.current || !alive.current) return;
    const token = ++generation.current,
      current = () => alive.current && token === generation.current;
    working.current = true;
    setBusy(true);
    setFresh(false);
    try {
      const result = await recoverDelayDraft(
        getSupabaseClient(),
        localStorage,
        lock,
        scope,
        draft,
        action,
        current,
      );
      if (!current()) return;
      syncPending();
      if (result.state === "pending")
        setMessage(
          "This request is not recorded. Retry the original decision or cancel the pending request.",
        );
      else {
        setMessage(
          result.state === "cancelled"
            ? "Pending request cancelled. A delayed copy will be refused."
            : `Delay ${draft.payload.decision === "approve" ? "approval" : "reversal"} recorded at ${time(result.recordedAt!)}.`,
        );
        setFresh(false);
        setReverseId(null);
        setReverseReason("");
        setSelected(null);
        setLabel("");
        setReason("");
        try {
          const page = await readDelayPage(getSupabaseClient(), tenantId, objectId);
          if (current()) {
            setHistory(mergeDelayHistory(null, page));
            setHistoryPage(0);
            setFresh(true);
          }
        } catch {
          if (current())
            setMessage(
              `The request is confirmed ${result.state}, but current reviews could not be refreshed. Reload before making another change.`,
            );
        }
      }
    } catch (error) {
      if (current()) {
        syncPending();
        setMessage(error instanceof Error ? error.message : "Delay outcome needs checking.");
      }
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function submit(payload: DelayPayload) {
    try {
      void recover(prepareDelayDraft(scope, crypto.randomUUID(), payload), "submit");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check the review details.");
    }
  }
  const complete = !!history && !history.hasMore && fresh;
  const disabled = busy || !complete || !!pending || !!storageError;
  const reversed = new Set(
    history?.entries.filter((e) => e.decision === "reverse").map((e) => e.approvalId),
  );
  const target = history?.entries.find((e) => e.id === reverseId && e.decision === "approve");
  const candidate = selected === null ? null : candidates?.intervals[selected];
  let approval: DelayPayload | null = null,
    validation = "";
  if (candidate) {
    try {
      approval = delayApprovalPayload(
        objectId,
        history?.through ?? 0,
        candidate,
        shorter ? { start: inputInstant(start), end: inputInstant(end) } : null,
        label,
        reason,
      );
    } catch (error) {
      validation = error instanceof Error ? error.message : "Check the interval and reason.";
    }
  }
  return (
    <div className="ls-settings ld-review">
      <p>
        Review whether a captured delay should be excluded from future working-time measures on this
        work item. Your approval records your judgement; it does not publish a score or change pay.
        Working-time collection is still being connected.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {storageError && <p role="alert">{storageError}</p>}
      <button type="button" disabled={busy} onClick={() => setReload((n) => n + 1)}>
        Reload delay reviews
      </button>
      {pending && (
        <section className="ls-rule" aria-label="Delay request recovery">
          <h4>Unconfirmed {pending.payload.decision === "approve" ? "approval" : "reversal"}</h4>
          <p>
            Request: {pending.requestId} · expected history revision{" "}
            {pending.payload.expectedRevision}
          </p>
          <p>Original reason: {pending.payload.reason}</p>
          {pending.payload.decision === "approve" ? (
            <>
              <p>
                {pending.payload.label}: {time(pending.payload.period.start)} to{" "}
                {time(pending.payload.period.end)}
              </p>
              <p>Selected capture records: {pending.payload.evidenceIds.join(", ")}</p>
            </>
          ) : (
            <p>Original approval: {pending.payload.approvalId}</p>
          )}
          <p>
            Checking does not make the change. Cancelling stops an unrecorded request; an already
            recorded decision stays in the history.
          </p>
          <div className="ls-add">
            <button
              type="button"
              disabled={busy || !!storageError}
              onClick={() => void recover(pending, "check")}
            >
              Check delay outcome
            </button>
            <button
              type="button"
              disabled={busy || !!storageError}
              onClick={() => void recover(pending, "submit")}
            >
              Retry original delay request
            </button>
            <button
              type="button"
              disabled={busy || !!storageError}
              onClick={() => void recover(pending, "cancel")}
            >
              Cancel pending delay request
            </button>
          </div>
        </section>
      )}
      <section aria-label="Saved delay decisions">
        <h4>Saved approvals and reversals</h4>
        {history ? (
          <>
            <p>
              {history.entries.length} of {history.through} decisions read · retained history
              revision {history.through}.
            </p>
            {!fresh && <p>Last confirmed view. Reload before changing reviews.</p>}
            {history.hasMore && (
              <p>Read the remaining decisions to establish which approvals are still active.</p>
            )}
            {!history.entries.length && (
              <p>No delay approvals or reversals are recorded on this work.</p>
            )}
            {history.entries.slice(historyPage * 20, (historyPage + 1) * 20).map((entry) => (
              <article className="ls-rule" key={entry.id}>
                <h5>
                  {entry.decision === "reverse"
                    ? "Reversal"
                    : !complete
                      ? "Approval · current status awaiting complete history"
                      : reversed.has(entry.id)
                        ? "Approval · reversed"
                        : "Approval · active"}
                  : {entry.label}
                </h5>
                <p>
                  {time(entry.period.start)} to {time(entry.period.end)} (end not included)
                </p>
                <p>{entry.reason}</p>
                <p className="lc-observed">
                  Revision {entry.revision} · recorded {time(entry.recordedAt)} · reviewer{" "}
                  {entry.recordedBy === actorId ? "you" : entry.recordedBy}
                </p>
                {entry.decision === "reverse" ? (
                  <p>
                    Reverses approval {entry.approvalId}. The original evidence is retained below
                    its approval.
                  </p>
                ) : (
                  <>
                    <DelayProof
                      tenantId={tenantId}
                      objectId={objectId}
                      entry={entry}
                      labels={labels}
                    />
                    <button
                      type="button"
                      disabled={disabled || reversed.has(entry.id)}
                      onClick={() => {
                        setReverseId(entry.id);
                        setReverseReason("");
                      }}
                    >
                      Review reversal of approval {entry.revision}
                    </button>
                  </>
                )}
              </article>
            ))}
            {history.entries.length > 20 && (
              <div className="ls-add">
                <span>
                  Review page {historyPage + 1} of {Math.ceil(history.entries.length / 20)} loaded
                  pages.
                </span>
                <button
                  type="button"
                  disabled={historyPage === 0}
                  onClick={() => setHistoryPage((n) => n - 1)}
                >
                  Previous review page
                </button>
                <button
                  type="button"
                  disabled={(historyPage + 1) * 20 >= history.entries.length}
                  onClick={() => setHistoryPage((n) => n + 1)}
                >
                  Next review page
                </button>
              </div>
            )}
            {history.hasMore && (
              <button type="button" disabled={busy || !fresh} onClick={() => void more()}>
                Read next delay decisions
              </button>
            )}
          </>
        ) : (
          <p>Saved review history is not yet confirmed.</p>
        )}
      </section>
      {target && (
        <fieldset disabled={disabled || reversed.has(target.id)}>
          <legend>Reverse approval {target.revision}</legend>
          <p>
            {target.label}: {time(target.period.start)} to {time(target.period.end)}.
          </p>
          <p>
            A reversal stops this approval being used by new calculations. Earlier evidence and
            saved assessments remain available.
          </p>
          <label>
            Reason for reversing
            <textarea
              maxLength={1000}
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!reverseReason.trim()}
            onClick={() =>
              submit({
                objectId,
                expectedRevision: history!.through,
                decision: "reverse",
                approvalId: target.id,
                period: null,
                label: null,
                evidenceIds: [],
                reason: reverseReason,
              })
            }
          >
            Record reversal
          </button>
          <button type="button" onClick={() => setReverseId(null)}>
            Keep approval
          </button>
        </fieldset>
      )}
      <section aria-label="Captured delay intervals">
        <h4>Choose a captured interval to review</h4>
        <p>
          Source period: {time(period.start)} to {time(period.end)}. Change the work-history dates
          above to review another period.
        </p>
        {sourceError && (
          <p role="alert">{sourceError} Existing review recovery remains available.</p>
        )}
        {!candidates && !sourceError && <p>Reading captured intervals…</p>}
        {candidates && (
          <>
            <p>
              {candidates.coverageStart
                ? `Captured history begins ${time(candidates.coverageStart)}.`
                : "No captured history is available."}{" "}
              Time before capture cannot be approved as an exclusion.
            </p>
            {!candidates.intervals.length && (
              <p>No captured intervals can be reviewed in this period.</p>
            )}
            {!!candidates.intervals.length && (
              <p className="lc-observed">
                Names use the current company directory where available; captured references remain
                in the evidence.
              </p>
            )}
            <div className="ld-candidates">
              {candidates.intervals.map((item, i) => (
                <button
                  className="ld-candidate"
                  key={`${item.period.start}:${i}`}
                  type="button"
                  aria-pressed={selected === i}
                  disabled={disabled}
                  onClick={() => {
                    setSelected(i);
                    setShorter(false);
                    setStart("");
                    setEnd("");
                    setLabel("");
                    setReason("");
                  }}
                >
                  <strong>
                    Review interval {i + 1}: {item.state}
                  </strong>
                  <span>
                    {time(item.period.start)} to {time(item.period.end)}
                  </span>
                  <span>
                    Responsible {owner(item.responsible, labels)} · waiting on{" "}
                    {owner(item.waitingOn, labels)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
      {candidate && (
        <fieldset disabled={disabled}>
          <legend>Review selected interval</legend>
          <p>
            {candidate.state}: {time(candidate.period.start)} to {time(candidate.period.end)}.
          </p>
          <p>Captured records: {candidate.evidenceIds.join(", ")}</p>
          <label className="ld-check">
            <input
              type="checkbox"
              checked={shorter}
              onChange={(e) => setShorter(e.target.checked)}
            />
            Use a shorter interval within these boundaries
          </label>
          {shorter && (
            <div className="ls-fields">
              <label>
                Delay starts (UTC)
                <input
                  type="datetime-local"
                  step="1"
                  value={start}
                  onInput={(e) => setStart(e.currentTarget.value)}
                />
              </label>
              <label>
                Delay ends (UTC)
                <input
                  type="datetime-local"
                  step="1"
                  value={end}
                  onInput={(e) => setEnd(e.currentTarget.value)}
                />
              </label>
            </div>
          )}
          <label>
            Delay label
            <input
              maxLength={200}
              placeholder="For example, awaiting a supplier response"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            Reason and evidence reviewed
            <textarea maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p>
            Selected records establish the work state and ownership. Explain why you consider this
            time an approved delay; a waiting status alone is insufficient.
          </p>
          {validation && <p>{validation}</p>}
          <button type="button" disabled={!approval} onClick={() => approval && submit(approval)}>
            Approve selected delay
          </button>
        </fieldset>
      )}
    </div>
  );
}
function DelayProof({
  tenantId,
  objectId,
  entry,
  labels,
}: {
  tenantId: string;
  objectId: string;
  entry: DelayEntry;
  labels: Record<string, string>;
}) {
  const [open, setOpen] = useState(false),
    [proof, setProof] = useState<Awaited<ReturnType<typeof readDelayEvidence>> | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    if (!open || proof) return;
    setError("");
    void readDelayEvidence(getSupabaseClient(), tenantId, objectId, entry.id)
      .then((value) => {
        if (active) {
          setProof(value);
          setPage(0);
        }
      })
      .catch((error) => {
        if (active)
          setError(error instanceof Error ? error.message : "Retained proof unavailable.");
      });
    return () => {
      active = false;
    };
  }, [open, tenantId, objectId, entry.id, reload]);
  return (
    <details className="ld-proof" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Read retained evidence for approval {entry.revision}</summary>
      {open &&
        (error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              Retry retained evidence
            </button>
          </>
        ) : !proof ? (
          <p role="status">Reading original captured evidence…</p>
        ) : (
          <>
            <p>
              Original capture read {time(proof.capture.observedAt)}. {proof.capture.count} source
              records retained for {time(proof.approval.period.start)} to{" "}
              {time(proof.approval.period.end)}.
            </p>
            <p>Selected supporting records: {proof.approval.evidenceIds.join(", ")}</p>
            <ol className="ld-events" start={page * 100 + 1}>
              {proof.capture.events.slice(page * 100, (page + 1) * 100).map((event: any) => (
                <li key={event.id}>
                  <strong>
                    {time(event.occurredAt)} · {event.kind}
                  </strong>
                  <p>
                    {event.before.status} → {event.after.status}
                  </p>
                  <p>
                    Responsible: {owner(event.after.responsible_ref, labels)} · waiting on:{" "}
                    {owner(event.after.waiting_on_ref, labels)}
                  </p>
                  <p>
                    Source {event.id} · sequence {event.sequence}
                  </p>
                  <details>
                    <summary>All recorded fields for this event</summary>
                    <pre>{JSON.stringify(event, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
            <p>
              Evidence page {page + 1} of {Math.max(1, Math.ceil(proof.capture.count / 100))}.
            </p>
            <div className="ls-add">
              <button type="button" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
                Previous capture records
              </button>
              <button
                type="button"
                disabled={(page + 1) * 100 >= proof.capture.count}
                onClick={() => setPage((n) => n + 1)}
              >
                Next capture records
              </button>
            </div>
          </>
        ))}
    </details>
  );
}
