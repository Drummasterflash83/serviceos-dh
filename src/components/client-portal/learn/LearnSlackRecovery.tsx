import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import { loadSlackStoredChannels, type SlackStoredChannel } from "@/lib/learn-slack-threads";
import {
  loadSlackHistoryState,
  SlackHistoryRecoveryError,
  type SlackHistoryState,
  type SlackHistoryRecoveryMode,
} from "@/lib/learn-slack-history-recovery";
import {
  readRecoveryDraft,
  prepareRecoveryDraft,
  submitRecoveryDraft,
  discardRejectedRecovery,
  recoveryOutboxKey,
  type RecoveryDraft,
  type RecoveryLock,
} from "@/lib/learn-slack-recovery-outbox";
const display = (s: string) => new Date(s).toLocaleString();
const lock: RecoveryLock = async (key, task) => {
  if (!navigator.locks)
    throw Error(
      "This browser cannot safely coordinate saved approvals. Use a browser that supports Web Locks.",
    );
  return await navigator.locks.request(key, task);
};
function status(s: SlackHistoryState) {
  if (!s.stateValid) return "Stored progress needs attention";
  if (s.progress?.complete) return "Approved window pages captured";
  if (s.latestJob?.status === "running") return "Importing";
  if (s.latestJob?.status === "queued") return "Queued";
  if (s.latestJob?.status === "retrying") return "Waiting to retry";
  if (s.latestJob?.stopReason === "page_budget_exhausted")
    return "Page limit reached — window incomplete";
  return "Window incomplete — review recovery";
}
export function LearnSlackRecovery({
  tenantId,
  actorId,
  canEdit,
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
}) {
  const scope = { tenantId, actorId, backend: supabaseConfig.url.replace(/\/$/, "") };
  const [channels, setChannels] = useState<SlackStoredChannel[]>([]),
    [channelLoading, setChannelLoading] = useState(true),
    [next, setNext] = useState<string | null>(null),
    [account, setAccount] = useState("");
  const [progress, setProgress] = useState<SlackHistoryState | null>(null),
    [draft, setDraft] = useState<RecoveryDraft | null>(null),
    [storageReady, setStorageReady] = useState(false);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [readError, setReadError] = useState(""),
    [rejected, setRejected] = useState(false);
  const [mode, setMode] = useState<SlackHistoryRecoveryMode>("continue"),
    [pages, setPages] = useState(3),
    [reason, setReason] = useState("");
  const generation = useRef(0),
    inFlight = useRef(false),
    live = useRef(false),
    editable = useRef(canEdit);
  editable.current = canEdit;
  async function refresh(id: string) {
    const ticket = ++generation.current;
    setLoading(true);
    setReadError("");
    setProgress(null);
    try {
      const s = await loadSlackHistoryState(getSupabaseClient(), tenantId, id);
      if (ticket === generation.current) {
        setProgress(s);
        setMode(s.canContinue ? "continue" : "restart");
      }
    } catch (e) {
      if (ticket === generation.current)
        setReadError(e instanceof Error ? e.message : "Channel progress is unavailable.");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  function restore() {
    try {
      const saved = readRecoveryDraft(localStorage, scope);
      setDraft(saved);
      setStorageReady(true);
      setRejected(false);
      if (saved) {
        setAccount(saved.request.accountId);
        void refresh(saved.request.accountId);
      }
      return saved;
    } catch (e) {
      setStorageReady(false);
      setNotice(e instanceof Error ? e.message : "Saved browser approvals are unavailable.");
      return null;
    }
  }
  async function loadChannels(after: string | null = null) {
    setChannelLoading(true);
    setReadError("");
    try {
      const p = await loadSlackStoredChannels(getSupabaseClient(), tenantId, after);
      if (live.current) {
        setChannels((old) => (after ? [...old, ...p.accounts] : p.accounts));
        setNext(p.nextCursor);
      }
    } catch (e) {
      if (live.current)
        setReadError(e instanceof Error ? e.message : "Stored channels are unavailable.");
    } finally {
      if (live.current) setChannelLoading(false);
    }
  }
  useEffect(() => {
    live.current = true;
    restore();
    void loadChannels();
    const changed = (e: StorageEvent) => {
      if (e.key === recoveryOutboxKey(scope)) {
        restore();
        setNotice(
          "Saved recovery changed in another tab. Review the current request before continuing.",
        );
      }
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId]);
  async function approve() {
    if (!canEdit || inFlight.current || !storageReady || (!draft && (!progress || loading))) return;
    inFlight.current = true;
    setBusy(true);
    setNotice("");
    setRejected(false);
    try {
      const prepared =
        draft ??
        prepareRecoveryDraft(scope, progress!, {
          requestId: crypto.randomUUID(),
          tenantId,
          accountId: account,
          stateVersion: progress!.stateVersion,
          mode,
          maxPages: pages,
          reason: reason.trim(),
        });
      const receipt = await submitRecoveryDraft(
        getSupabaseClient(),
        localStorage,
        lock,
        scope,
        prepared,
        () => live.current && editable.current,
      );
      if (live.current) {
        setDraft(null);
        setReason("");
        setNotice(
          receipt.reused
            ? "This approval was already recorded. Its current progress is shown below."
            : "Recovery queued. Refresh progress to follow the worker.",
        );
        void refresh(account);
      }
    } catch (e) {
      if (live.current) {
        try {
          setDraft(readRecoveryDraft(localStorage, scope));
        } catch {
          setStorageReady(false);
        }
        setNotice(
          e instanceof Error ? e.message : "Approval was not confirmed. Retry the saved request.",
        );
        setRejected(
          e instanceof SlackHistoryRecoveryError &&
            ["conflict", "invalid", "unavailable"].includes(e.kind),
        );
      }
    } finally {
      inFlight.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function clearRejected() {
    if (!draft || !rejected || busy) return;
    try {
      await discardRejectedRecovery(localStorage, lock, scope, draft.request.requestId);
      setDraft(null);
      setRejected(false);
      setReason("");
      setNotice("Rejected review cleared. Review the refreshed progress before another approval.");
      void refresh(account);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Saved review could not be cleared.");
    }
  }
  const disabled = busy || !!draft,
    eligible = progress && (mode === "continue" ? progress.canContinue : progress.canRestart);
  return (
    <section aria-labelledby="slack-recovery-title" className="space-y-4">
      <h3 id="slack-recovery-title" className="font-semibold">
        Channel progress & recovery
      </h3>
      <p>
        Continue an incomplete channel import from its saved position, or restart the same approved
        window. Earlier messages and approvals stay in place.
      </p>
      {draft && (
        <div className="rounded border p-3 space-y-2" role="status">
          <strong>Saved approval awaiting confirmation</strong>
          <p>
            {draft.review.name} · {draft.review.channelId}
          </p>
          <p>
            {display(draft.review.start)} – {display(draft.review.end)}
          </p>
          <p>
            {draft.request.mode === "continue"
              ? "Continue from saved position"
              : "Restart this window"}{" "}
            · up to {draft.request.maxPages} pages
          </p>
          <p className="break-words">Reason: {draft.request.reason}</p>
          <p>
            This browser saved your exact request. Retry it to find out whether it was recorded.
            Refreshing progress does not clear it.
          </p>
        </div>
      )}
      <label className="block">
        Channel to review
        <select
          className="block w-full rounded border p-2"
          value={account}
          disabled={disabled || loading || channelLoading}
          onChange={(e) => {
            setAccount(e.target.value);
            setProgress(null);
            setNotice("");
            if (e.target.value) void refresh(e.target.value);
          }}
        >
          <option value="">Choose a stored channel</option>
          {account && !channels.some((c) => c.id === account) && (
            <option value={account}>
              {draft?.review.name ?? progress?.name ?? "Saved channel"}
            </option>
          )}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.channelId}
              {c.status === "active" ? "" : ` · ${c.status}`}
            </option>
          ))}
        </select>
      </label>
      {channelLoading && <p role="status">Reading stored channels…</p>}
      {!channelLoading && !channels.length && !readError && (
        <p>No stored channels are available. Choose Channel messages to review a new import.</p>
      )}
      {!account && (
        <button className="cp-secondary" disabled={busy} onClick={() => void loadChannels()}>
          Reload channels
        </button>
      )}
      {next && (
        <button
          className="cp-secondary"
          disabled={disabled}
          onClick={() => void loadChannels(next)}
        >
          More channels
        </button>
      )}
      {account && (
        <button
          className="cp-secondary"
          disabled={busy || loading}
          onClick={() => void refresh(account)}
        >
          Refresh channel progress
        </button>
      )}
      {loading && <p role="status">Reading saved channel progress…</p>}
      {readError && <p role="alert">{readError}</p>}
      {progress && (
        <article className="rounded border p-3 space-y-2">
          <strong>{status(progress)}</strong>
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
                This is a page budget, not a percentage of all messages. It covers this channel
                window only; thread replies are reviewed separately.
              </p>
              {progress.previousApprovalId && (
                <p>
                  This approval {progress.recoveryMode === "restart" ? "restarted" : "continued"} an
                  earlier window.
                </p>
              )}
              {!progress.progress.complete && (
                <p>
                  Current approval expires {display(progress.window.expiresAt)}. A new recovery
                  approval renews it for 24 hours.
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
          {!progress.active && !progress.progress?.complete && !progress.canRestart && (
            <p>
              Recovery is unavailable. Check the company connection or ask an owner to review the
              stored progress.
            </p>
          )}
        </article>
      )}
      {(draft || (progress?.canRestart && canEdit)) && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void approve();
          }}
        >
          {!draft && (
            <fieldset
              disabled={!canEdit || disabled || !progress?.canRestart || loading}
              className="space-y-3"
            >
              <label className="block">
                Recovery action
                <select
                  className="block w-full rounded border p-2"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as SlackHistoryRecoveryMode)}
                >
                  <option value="continue" disabled={!progress?.canContinue}>
                    Continue from saved position
                  </option>
                  <option value="restart">Restart the same window</option>
                </select>
              </label>
              {mode === "restart" && (
                <p>
                  Restart reads this window again from the beginning. Use it when the saved position
                  can no longer be used. Stored messages are retained and repeated messages are
                  deduplicated.
                </p>
              )}
              <label className="block">
                New page limit
                <input
                  className="block w-full rounded border p-2"
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={pages}
                  onChange={(e) => setPages(Number(e.target.value))}
                  required
                />
              </label>
              <p>
                Up to 15 messages per page. Reaching this limit may leave the window incomplete.
              </p>
              <label className="block">
                Reason for recovery
                <textarea
                  className="block w-full rounded border p-2"
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
            </fieldset>
          )}
          <button
            className="cp-primary"
            disabled={!canEdit || busy || !storageReady || (!draft && (!eligible || loading))}
            type="submit"
          >
            {busy
              ? "Confirming approval…"
              : draft
                ? "Retry saved approval"
                : mode === "restart"
                  ? "Approve restart"
                  : "Approve continuation"}
          </button>
          {draft && rejected && (
            <button
              type="button"
              className="cp-secondary"
              disabled={busy}
              onClick={() => void clearRejected()}
            >
              Clear rejected review and refresh
            </button>
          )}
        </form>
      )}
      {!canEdit && <p>Only your company’s owner or admin can approve recovery.</p>}
      {notice && <p role="status">{notice}</p>}
      <p className="text-sm">
        Unconfirmed recovery requests are saved on this browser for your account and company. Keep
        this browser’s data until they are resolved. They are not available on another device.
      </p>
    </section>
  );
}
