import { slackCaptureIssue } from "@/lib/learn-slack-capture-issue";
import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  loadSlackThreadRecovery,
  SlackThreadRecoveryError,
  type SlackThreadRecoveryMode,
  type SlackThreadRecoveryState,
} from "@/lib/learn-slack-thread-recovery";
import {
  readThreadRecoveryDraft,
  prepareThreadRecoveryDraft,
  submitThreadRecoveryDraft,
  discardRejectedThreadRecovery,
  threadRecoveryOutboxKey,
  type ThreadRecoveryDraft,
  type ThreadRecoveryLock,
} from "@/lib/learn-slack-thread-recovery-outbox";
export type ThreadRecoveryTarget = { accountId: string; importId: string };
const display = (value: string) => new Date(value).toLocaleString();
const parentDate = (value: string) => display(new Date(Number(value) * 1000).toISOString());
const lock: ThreadRecoveryLock = async (key, task) => {
  if (!navigator.locks)
    throw Error(
      "This browser cannot safely coordinate saved approvals. Use a browser that supports Web Locks.",
    );
  return navigator.locks.request(key, task);
};
function status(s: SlackThreadRecoveryState) {
  if (!s.stateValid) return "Stored thread progress needs attention";
  if (s.supersededBy) return "A newer approval exists for this window";
  if (s.progress?.complete) return "Approved thread window pages captured";
  if (s.latestJob?.status === "queued") return "Thread recovery queued";
  if (s.latestJob?.status === "running") return "Importing thread replies";
  if (s.latestJob?.status === "retrying") return "Waiting to retry";
  if (s.latestJob?.stopReason === "page_budget_exhausted")
    return "Page limit reached — thread window incomplete";
  return "Thread window incomplete — review recovery";
}
export function LearnSlackThreadRecovery({
  tenantId,
  actorId,
  canEdit,
  active,
  selection,
  onRecorded,
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
  active: boolean;
  selection: ThreadRecoveryTarget | null;
  onRecorded: () => void;
}) {
  const scope = { tenantId, actorId, backend: supabaseConfig.url.replace(/\/$/, "") };
  const scopeKey = `${scope.backend}:${actorId}:${tenantId}`;
  const scopeNow = useRef(scopeKey);
  scopeNow.current = scopeKey;
  const live = useRef(false),
    editable = useRef(false),
    generation = useRef(0),
    inFlight = useRef(false);
  editable.current = canEdit && active;
  const heading = useRef<HTMLHeadingElement>(null);
  const [target, setTarget] = useState<ThreadRecoveryTarget | null>(null);
  const [progress, setProgress] = useState<SlackThreadRecoveryState | null>(null);
  const [draft, setDraft] = useState<ThreadRecoveryDraft | null>(null);
  const [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [readError, setReadError] = useState(""),
    [notice, setNotice] = useState(""),
    [rejected, setRejected] = useState(false);
  const [mode, setMode] = useState<SlackThreadRecoveryMode>("continue"),
    [pages, setPages] = useState(3),
    [reason, setReason] = useState("");
  const current = () => live.current && scopeNow.current === scopeKey;
  async function refresh(t: ThreadRecoveryTarget) {
    const ticket = ++generation.current;
    setTarget(t);
    setProgress(null);
    setReadError("");
    setLoading(true);
    try {
      const value = await loadSlackThreadRecovery(
        getSupabaseClient(),
        tenantId,
        t.accountId,
        t.importId,
      );
      if (current() && ticket === generation.current) {
        setProgress(value);
        setMode(value.canContinue ? "continue" : "restart");
      }
    } catch (error) {
      if (current() && ticket === generation.current)
        setReadError(error instanceof Error ? error.message : "Thread progress is unavailable.");
    } finally {
      if (current() && ticket === generation.current) setLoading(false);
    }
  }
  function restore() {
    try {
      const saved = readThreadRecoveryDraft(localStorage, scope);
      setDraft(saved);
      setReady(true);
      setRejected(false);
      if (saved)
        void refresh({ accountId: saved.request.accountId, importId: saved.request.importId });
    } catch (error) {
      setReady(false);
      setNotice(error instanceof Error ? error.message : "Saved recovery is unavailable.");
    }
  }
  useEffect(() => {
    live.current = true;
    restore();
    const changed = (event: StorageEvent) => {
      if (event.key === threadRecoveryOutboxKey(scope) || event.key === null) {
        restore();
        setNotice("Saved thread recovery changed in another tab. Review it before continuing.");
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId]);
  useEffect(() => {
    if (!selection) return;
    if (inFlight.current || draft) {
      setNotice("Resolve the saved thread approval before selecting another recovery.");
      return;
    }
    setNotice("");
    setReason("");
    setRejected(false);
    void refresh(selection);
  }, [selection]);
  useEffect(() => {
    if (active && target) heading.current?.focus();
  }, [target?.importId, active]);
  async function approve() {
    if (!editable.current || inFlight.current || !ready || (!draft && (!progress || loading)))
      return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setRejected(false);
    try {
      const prepared =
        draft ??
        prepareThreadRecoveryDraft(scope, progress!, {
          requestId: crypto.randomUUID(),
          tenantId,
          accountId: progress!.accountId,
          importId: progress!.importId,
          stateVersion: progress!.stateVersion,
          mode,
          maxPages: pages,
          reason: reason.trim(),
        });
      const receipt = await submitThreadRecoveryDraft(
        getSupabaseClient(),
        localStorage,
        lock,
        scope,
        prepared,
        () => current() && editable.current,
      );
      if (current()) {
        setDraft(null);
        setReason("");
        setNotice(
          receipt.reused
            ? "This thread approval was already recorded. No duplicate job was created."
            : "Thread recovery queued. Earlier approvals and messages are retained.",
        );
        void refresh({ accountId: receipt.accountId, importId: receipt.requestId });
        onRecorded();
      }
    } catch (error) {
      if (current()) {
        try {
          setDraft(readThreadRecoveryDraft(localStorage, scope));
        } catch {
          setReady(false);
        }
        setNotice(
          error instanceof Error
            ? error.message
            : "Approval was not confirmed. Retry the saved request.",
        );
        setRejected(
          error instanceof SlackThreadRecoveryError &&
            ["conflict", "invalid", "unavailable"].includes(error.kind),
        );
      }
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  }
  async function clearRejected() {
    if (!draft || !rejected || busy) return;
    try {
      await discardRejectedThreadRecovery(localStorage, lock, scope, draft.request.requestId);
      if (current()) {
        setDraft(null);
        setRejected(false);
        setReason("");
        setNotice("Rejected review cleared. Review the refreshed thread before approving again.");
        if (target) void refresh(target);
      }
    } catch (error) {
      if (current())
        setNotice(error instanceof Error ? error.message : "Saved review could not be cleared.");
    }
  }
  if (!target && !draft && !notice) return null;
  const eligible = progress && (mode === "continue" ? progress.canContinue : progress.canRestart);
  return (
    <section className="rounded border p-4 space-y-3" aria-labelledby="slack-thread-recovery-title">
      <h4 ref={heading} tabIndex={-1} id="slack-thread-recovery-title" className="font-semibold">
        Thread progress &amp; recovery
      </h4>
      <p>
        Continue from a saved position or restart the same thread window. Earlier replies and
        approvals stay in place.
      </p>
      {draft && (
        <div role="status" className="rounded border p-3 space-y-2">
          <strong>Saved thread approval awaiting confirmation</strong>
          <p>
            {draft.review.channelId} · thread started {parentDate(draft.review.parentTimestamp)}
          </p>
          <p>
            {display(draft.review.start)} – {display(draft.review.end)}
          </p>
          <p>
            {draft.request.mode === "continue"
              ? "Continue from saved position"
              : "Restart this thread window"}{" "}
            · up to {draft.request.maxPages} pages
          </p>
          <p className="break-words">Reason: {draft.request.reason}</p>
          <p>
            Your exact request is saved in this browser. Retry it even if current progress cannot be
            read; refreshing does not clear it.
          </p>
        </div>
      )}
      {target && (
        <button
          className="cp-secondary"
          disabled={busy || loading}
          onClick={() => void refresh(target)}
        >
          Refresh thread progress
        </button>
      )}
      {loading && <p role="status">Reading saved thread progress…</p>}
      {readError && <p role="alert">{readError}</p>}
      {progress && (
        <article className="space-y-2">
          <strong>{status(progress)}</strong>
          {!progress.progress?.complete && slackCaptureIssue(progress.latestJob?.errorCode) && (
            <p>{slackCaptureIssue(progress.latestJob?.errorCode)}</p>
          )}
          <p>
            {progress.channelId} · thread started {parentDate(progress.parentTimestamp)}
          </p>
          {progress.window && progress.progress && (
            <>
              <p>
                Approved window: {display(progress.window.start)} – {display(progress.window.end)}
              </p>
              <p>
                {progress.progress.pagesThisApproval} of up to {progress.window.pageLimit} pages
                captured under this approval. Earlier approved batches remain retained.
              </p>
              <p>
                This page budget covers one observed thread window. It is not a percentage of all
                Slack messages.
              </p>
              {progress.previousImportId && (
                <p>
                  This approval {progress.recoveryMode === "restart" ? "restarted" : "continued"} an
                  earlier thread window.
                </p>
              )}
              {!progress.progress.complete && (
                <p>
                  Approval expires {display(progress.window.expiresAt)}. A new approval renews it
                  for 24 hours.
                </p>
              )}
            </>
          )}
          {progress.latestJob?.availableAt && (
            <p>
              Eligible to run from {display(progress.latestJob.availableAt)}; timing depends on the
              worker.
            </p>
          )}
          {progress.supersededBy && (
            <button
              className="cp-secondary"
              disabled={busy || !!draft}
              onClick={() =>
                void refresh({ accountId: progress.accountId, importId: progress.supersededBy! })
              }
            >
              View newer thread approval
            </button>
          )}
          {!progress.active &&
            !progress.progress?.complete &&
            !progress.canRestart &&
            !progress.supersededBy && (
              <p>
                Recovery is unavailable. Review the company connection and stored thread progress.
              </p>
            )}
        </article>
      )}
      {(draft || (progress?.canRestart && canEdit)) && (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void approve();
          }}
        >
          {!draft && (
            <fieldset className="space-y-3" disabled={!canEdit || busy || loading || !ready}>
              <label className="block">
                Thread recovery action
                <select
                  className="block w-full rounded border p-2"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as SlackThreadRecoveryMode)}
                >
                  <option value="continue" disabled={!progress?.canContinue}>
                    Continue from saved position
                  </option>
                  <option value="restart">Restart the same thread window</option>
                </select>
              </label>
              {mode === "restart" && (
                <p>
                  Restart reads this thread window again from the beginning. Existing replies are
                  retained and repeated messages are deduplicated.
                </p>
              )}
              <label className="block">
                Thread recovery page limit
                <input
                  className="block w-full rounded border p-2"
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={pages}
                  onChange={(event) => setPages(Number(event.target.value))}
                  required
                />
              </label>
              <p>
                Up to 15 messages per page. Reaching the limit may leave this thread window
                incomplete.
              </p>
              <label className="block">
                Reason for thread recovery
                <textarea
                  className="block w-full rounded border p-2"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  required
                />
              </label>
            </fieldset>
          )}
          <button
            className="cp-primary"
            type="submit"
            disabled={!canEdit || busy || !ready || (!draft && (!eligible || loading))}
          >
            {busy
              ? "Confirming thread approval…"
              : draft
                ? "Retry saved thread approval"
                : mode === "restart"
                  ? "Approve thread restart"
                  : "Approve thread continuation"}
          </button>
          {draft && rejected && (
            <button
              className="cp-secondary"
              type="button"
              disabled={busy}
              onClick={() => void clearRejected()}
            >
              Clear rejected thread review and refresh
            </button>
          )}
        </form>
      )}
      {!canEdit && <p>Only your company’s owner or admin can approve thread recovery.</p>}
      {notice && <p role="status">{notice}</p>}
      <p className="text-sm">
        Unconfirmed thread recoveries are saved for this account and company in this browser. Keep
        its data until resolved; the saved request is not available on another device.
      </p>
    </section>
  );
}
