import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, supabaseConfig } from "@/lib/supabase";
import {
  readRecurringChannels,
  readSavedRecurring,
  resolveSavedRecurring,
  recurringOutboxKey,
  recurringStates,
  type RecurringChannel,
  type SavedRecurring,
  type RecurringClient,
  type RecurringLock,
} from "@/lib/learn-slack-recurring";
const lock: RecurringLock = async (key, task) => {
  if (!navigator.locks) throw Error("Use a browser that supports saved-request coordination.");
  return navigator.locks.request(key, task);
};
export function LearnSlackRecurring({
  tenantId,
  actorId,
  canEdit = true,
  client,
  backend = supabaseConfig.url.replace(/\/$/, ""),
}: {
  tenantId: string;
  actorId: string;
  canEdit?: boolean;
  client?: RecurringClient;
  backend?: string;
}) {
  const scope = { tenantId, actorId, backend };
  const [channels, setChannels] = useState<RecurringChannel[]>([]),
    [next, setNext] = useState<string | null>(null),
    [account, setAccount] = useState("");
  const [writable, setWritable] = useState(false),
    [ready, setReady] = useState(false),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<SavedRecurring | null>(null),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [target, setTarget] = useState<"channel" | "threads">("channel");
  const [notice, setNotice] = useState(""),
    [readError, setReadError] = useState("");
  const generation = useRef(0),
    live = useRef(false),
    working = useRef(false),
    current = useRef({ tenantId, actorId, backend, canEdit });
  current.current = { tenantId, actorId, backend, canEdit };
  const db = () => client ?? getSupabaseClient();
  const allowed = () =>
    live.current &&
    current.current.canEdit &&
    current.current.tenantId === tenantId &&
    current.current.actorId === actorId &&
    current.current.backend === backend;
  function restore() {
    try {
      const d = readSavedRecurring(localStorage, scope);
      setPending(d);
      setReady(true);
      if (d) setAccount(d.request.accountId);
      return d;
    } catch {
      setReady(false);
      setNotice(
        "Saved capture settings need review. Keep this browser data and ask OpenFolk to check it.",
      );
      return null;
    }
  }
  async function load(after: string | null = null) {
    const ticket = ++generation.current;
    setLoading(true);
    setReadError("");
    try {
      const page = await readRecurringChannels(db(), tenantId, after);
      if (ticket !== generation.current || !live.current) return;
      setChannels((old) => (after ? [...old, ...page.channels] : page.channels));
      setNext(page.next);
      setWritable(page.canWrite);
      if (!after) setAccount((old) => old || page.channels[0]?.accountId || "");
    } catch (e) {
      if (ticket === generation.current) {
        setWritable(false);
        setReadError(e instanceof Error ? e.message : "Capture settings are unavailable.");
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    live.current = true;
    restore();
    void load();
    const changed = (e: StorageEvent) => {
      if (e.key === recurringOutboxKey(scope)) restore();
    };
    window.addEventListener("storage", changed);
    return () => {
      live.current = false;
      generation.current++;
      window.removeEventListener("storage", changed);
    };
  }, [tenantId, actorId, backend]);
  const selected = channels.find((c) => c.accountId === account);
  const threadAction = target === "threads";
  const enabled = threadAction ? selected?.threads?.enabled === true : selected?.enabled === true;
  const canEnable = threadAction
    ? selected?.threads?.canEnable === true
    : !!(selected?.completeVerified || selected?.pausedWindow);
  const subject = threadAction ? "thread reply capture" : "ongoing capture";
  async function resolve(mode: "apply" | "check" | "cancel") {
    if (working.current || !ready || !allowed()) return;
    const draft =
      pending ??
      (selected
        ? {
            version: 1 as const,
            backend,
            label: selected.name,
            request: {
              ...(threadAction ? { kind: "threads" as const } : {}),
              tenantId,
              actorId,
              accountId: selected.accountId,
              requestId: crypto.randomUUID(),
              revision: selected.revision,
              enabled: !enabled,
              reason: reason.trim(),
            },
          }
        : null);
    if (
      !draft ||
      (!pending &&
        (!writable ||
          loading ||
          !reviewed ||
          !reason.trim() ||
          (threadAction && !selected?.threads) ||
          (!enabled && !canEnable)))
    )
      return;
    working.current = true;
    setBusy(true);
    setNotice("");
    try {
      const receipt = await resolveSavedRecurring(
        db(),
        localStorage,
        lock,
        scope,
        draft,
        mode,
        allowed,
      );
      if (!allowed()) return;
      setNotice(
        receipt.state === "pending"
          ? "No result is recorded yet. The request stays saved."
          : receipt.state === "cancelled"
            ? "Request cancelled. A delayed copy cannot apply it."
            : receipt.state === "recorded" && receipt.enabled
              ? draft.request.kind === "threads"
                ? "Thread reply capture enabled. Check observed-thread progress as windows are processed."
                : "Ongoing capture enabled. Check channel progress to confirm messages are arriving."
              : draft.request.kind === "threads"
                ? "Thread reply capture paused. Saved replies and progress remain available."
                : "Ongoing capture paused. Saved messages and unfinished progress remain available.",
      );
      restore();
      if (receipt.state !== "pending") {
        setReason("");
        setReviewed(false);
        await load();
      }
    } catch (e) {
      if (allowed()) {
        setNotice(e instanceof Error ? e.message : "The result could not be confirmed.");
        restore();
      }
    } finally {
      working.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <section className="cp-card space-y-4" aria-label="Ongoing Slack capture">
      <div>
        <h3 className="font-semibold">Ongoing Slack capture</h3>
        <p className="text-sm">
          Keep an approved public channel current after its first import. Existing messages and
          history stay saved.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="cp-secondary"
          type="button"
          disabled={busy || loading}
          onClick={() => void load()}
        >
          Refresh channels
        </button>
        {loading && <span role="status">Checking channel progress…</span>}
      </div>
      {readError && <p role="alert">{readError}</p>}
      {!loading && !readError && channels.length === 0 && (
        <p>
          No imported Slack channels are available yet. Connect Slack and complete an initial
          channel import first.
        </p>
      )}
      {channels.length > 0 && (
        <label className="block">
          Channel
          <select
            className="mt-1 block w-full rounded border p-2"
            value={account}
            disabled={busy || !!pending}
            onChange={(e) => {
              setAccount(e.target.value);
              setTarget("channel");
              setReviewed(false);
              setReason("");
            }}
          >
            {pending && !selected && (
              <option value={pending.request.accountId}>{pending.label} — saved request</option>
            )}
            {channels.map((c) => (
              <option key={c.accountId} value={c.accountId}>
                {c.name}
                {c.channelId ? ` · ${c.channelId}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {next && (
        <button
          className="cp-secondary"
          type="button"
          disabled={loading || busy}
          onClick={() => void load(next)}
        >
          Load more channels
        </button>
      )}
      {selected && (
        <div className="space-y-1 text-sm">
          <p>
            <strong>Last checked setting:</strong>{" "}
            {selected.enabled ? "Enabled" : selected.revision ? "Paused" : "Not enabled"}
          </p>
          <p>
            <strong>Progress:</strong> {recurringStates[selected.state]}
          </p>
          {selected.updatedAt && (
            <p>Last recorded update: {new Date(selected.updatedAt).toLocaleString()}</p>
          )}
          {selected.threads ? (
            <div className="rounded border p-3 space-y-1" aria-label="Observed thread progress">
              <p>
                <strong>Thread reply capture:</strong>{" "}
                {selected.threads.enabled ? "Enabled" : "Not enabled"}
              </p>
              {selected.threads.observed === null ? (
                <p>No thread window has been checked yet.</p>
              ) : (
                <p>
                  {selected.threads.completed} of {selected.threads.observed} observed threads have
                  completed this window.{" "}
                  {selected.threads.discoveryComplete
                    ? "Discovery finished for retained parents."
                    : "More retained parents may still be discovered."}
                </p>
              )}
              <p>
                Only threads identified in saved messages are included. Unseen parents, attachments
                and earlier edits need separate coverage checks.
              </p>
              {selected.state === "threads_pending" && (
                <p>
                  Review thread imports; interrupted or exhausted imports need recovery
                  before the next channel window.
                </p>
              )}
            </div>
          ) : (
            <p>
              Thread reply controls are not available from this service yet. Channel messages,
              thread replies, attachments and earlier edits have separate coverage.
            </p>
          )}
          {!selected.enabled && !selected.completeVerified && !selected.pausedWindow && (
            <p>Complete or recover the initial window before enabling ongoing capture.</p>
          )}
        </div>
      )}
      {pending ? (
        <div className="space-y-2" role="group" aria-label="Saved Slack capture request">
          <p>
            Saved request: {pending.request.enabled ? "Enable" : "Pause"}{" "}
            {pending.request.kind === "threads" ? "thread reply capture" : "ongoing capture"} for{" "}
            <strong>{pending.label}</strong>.
          </p>
          <p className="text-sm">
            Keep this request until its result is confirmed. Checking the result does not apply it
            again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="cp-secondary"
              type="button"
              disabled={busy || !canEdit}
              onClick={() => void resolve("check")}
            >
              Check saved result
            </button>
            <button
              className="cp-primary"
              type="button"
              disabled={busy || !canEdit}
              onClick={() => void resolve("apply")}
            >
              Retry saved request
            </button>
            <button
              className="cp-secondary"
              type="button"
              disabled={busy || !canEdit}
              onClick={() => void resolve("cancel")}
            >
              Cancel saved request
            </button>
          </div>
        </div>
      ) : selected && canEdit && writable ? (
        <div className="space-y-3">
          <label className="block">
            Change setting
            <select
              className="mt-1 block w-full rounded border p-2"
              value={target}
              disabled={busy}
              onChange={(e) => {
                setTarget(e.target.value as "channel" | "threads");
                setReviewed(false);
                setReason("");
              }}
            >
              <option value="channel">Channel capture</option>
              {selected.threads && <option value="threads">Thread reply capture</option>}
            </select>
          </label>
          {threadAction && !enabled && !canEnable && (
            <p>
              Enable ongoing channel capture first. If a thread window has already started, pause
              replies and let channel capture advance before enabling a fresh window.
            </p>
          )}
          <label className="block">
            Reason for this change
            <textarea
              className="mt-1 block w-full rounded border p-2"
              rows={3}
              value={reason}
              maxLength={1000}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            <span>
              {threadAction
                ? enabled
                  ? "Pause automatic thread reads and retain saved replies. Channel capture can continue."
                  : "Allow ongoing reads of observed threads in this public channel. Unfinished replies hold the next channel window; LEARN and Slack switches still apply."
                : enabled
                  ? "Pause new capture for this channel and retain saved progress."
                  : "Allow ongoing reads of this public channel until paused. LEARN and Slack module switches still apply."}
            </span>
          </label>
          <button
            className="cp-primary"
            type="button"
            disabled={
              busy ||
              loading ||
              !ready ||
              !reviewed ||
              !reason.trim() ||
              (!enabled && !canEnable) ||
              (threadAction && !selected.threads)
            }
            onClick={() => void resolve("apply")}
          >
            {busy ? "Saving…" : `${enabled ? "Pause" : "Enable"} ${subject}`}
          </button>
        </div>
      ) : (
        selected && (
          <p className="text-sm">
            Your current access allows you to view progress. An authorised administrator can change
            capture settings.
          </p>
        )
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
