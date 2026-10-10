import { useEffect, useRef, useState } from "react";
import { useSlackImportOutbox } from "./useSlackImportOutbox";
import { LearnSlackThreadRecovery, type ThreadRecoveryTarget } from "./LearnSlackThreadRecovery";
import { SlackSavedImport } from "./SlackSavedImport";
import { getSupabaseClient } from "@/lib/supabase";
import {
  loadSlackStoredChannels,
  loadSlackObservedThreads,
  validateSlackThreadRequest,
  slackThreadProgress,
  type SlackStoredChannel,
  type SlackThreadPage,
} from "@/lib/learn-slack-threads";
const local = (ms: number) => {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const display = (value: string) => new Date(value).toLocaleString();
export function LearnSlackThreads({
  tenantId,
  actorId,
  canEdit,
  active = true,
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
  active?: boolean;
}) {
  const [recoveryTarget, setRecoveryTarget] = useState<ThreadRecoveryTarget | null>(null);
  const outbox = useSlackImportOutbox(tenantId, actorId, canEdit, "threads");
  const busy = outbox.busy;
  const [channels, setChannels] = useState<SlackStoredChannel[]>([]),
    [channelsNext, setChannelsNext] = useState<string | null>(null),
    [account, setAccount] = useState("");
  const [page, setPage] = useState<SlackThreadPage | null>(null),
    [before, setBefore] = useState<string | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false),
    [notice, setNotice] = useState(""),
    [readError, setReadError] = useState(false);
  const [start, setStart] = useState(() => local(Date.now() - 86400000)),
    [end, setEnd] = useState(() => local(Date.now())),
    [limit, setLimit] = useState(3),
    [reason, setReason] = useState("");
  const generation = useRef(0);
  async function channelsLoad(after: string | null = null) {
    const ticket = ++generation.current;
    setLoading(true);
    setNotice("");
    setReadError(false);
    try {
      const r = await loadSlackStoredChannels(getSupabaseClient(), tenantId, after);
      if (ticket === generation.current) {
        setChannels((old) => (after ? [...old, ...r.accounts] : r.accounts));
        setChannelsNext(r.nextCursor);
      }
    } catch (e) {
      if (ticket === generation.current) {
        setReadError(true);
        setNotice(e instanceof Error ? e.message : "Stored channels could not be read.");
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void channelsLoad();
    return () => {
      generation.current++;
    };
  }, [tenantId]);
  async function threadsLoad(id: string, cursor: string | null = null) {
    const ticket = ++generation.current;
    setLoading(true);
    setNotice("");
    setReadError(false);
    setPage(null);
    setSelected([]);
    setBefore(cursor);
    try {
      const r = await loadSlackObservedThreads(getSupabaseClient(), tenantId, id, cursor);
      if (ticket === generation.current) setPage(r);
    } catch (e) {
      if (ticket === generation.current) {
        setReadError(true);
        setNotice(e instanceof Error ? e.message : "Threads could not be read.");
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    const first = outbox.draft?.entries[0];
    if (first?.kind === "threads" && !account && !loading) {
      setAccount(first.request.accountId);
      void threadsLoad(first.request.accountId);
    }
  }, [outbox.draft?.id, account, loading]);
  async function approve() {
    if (!canEdit || busy || !outbox.ready || !page?.canImport || !page.connectionRevision) return;
    setNotice("");
    try {
      const requests = page.threads
        .filter((t) => selected.includes(t.sourceId))
        .map((t) => ({
          kind: "threads" as const,
          request: {
            requestId: crypto.randomUUID(),
            tenantId,
            accountId: page.accountId,
            sourceId: t.sourceId,
            sourceVersion: t.sourceVersion,
            parentTimestamp: t.parentTimestamp,
            connectionRevision: page.connectionRevision!,
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
            maxPages: limit,
            reason,
          },
        }));
      if (!requests.length) throw Error("Select at least one observed thread.");
      for (const r of requests) validateSlackThreadRequest(r.request);
      await outbox.submit(requests);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Review the selected imports before approving.");
    }
  }
  const locked = busy || !!outbox.draft || !outbox.ready,
    allConfirmed = !!outbox.completed;
  return (
    <section className="space-y-4" aria-labelledby="slack-thread-title">
      <h3 id="slack-thread-title" className="font-semibold">
        Thread replies
      </h3>
      <p>
        Browse threads observed in stored Slack messages. A thread may have started before the
        period you want to import. This list does not establish that every Slack thread has been
        discovered.
      </p>
      <SlackSavedImport outbox={outbox} canEdit={canEdit} />
      <LearnSlackThreadRecovery
        key={`${tenantId}:${actorId}`}
        tenantId={tenantId}
        actorId={actorId}
        canEdit={canEdit}
        active={active}
        selection={recoveryTarget}
        onRecorded={() => {
          if (account) void threadsLoad(account, before);
        }}
      />
      <label className="block">
        Stored channel
        <select
          className="block w-full rounded border p-2"
          value={account}
          disabled={loading || locked}
          onChange={(e) => {
            const id = e.target.value;
            setAccount(id);
            setPage(null);
            if (id) void threadsLoad(id);
          }}
        >
          <option value="">Choose a stored channel</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.teamId}/{c.channelId}
              {c.status === "active" ? "" : ` · ${c.status}`}
            </option>
          ))}
        </select>
      </label>
      {!channels.length && !loading && !readError && (
        <p>
          No stored Slack channel is available yet. Start with the channel history import above.
        </p>
      )}
      {channelsNext && (
        <button
          className="cp-secondary"
          disabled={loading || locked}
          onClick={() => void channelsLoad(channelsNext)}
        >
          Load more channels
        </button>
      )}
      {!account && (
        <button
          className="cp-secondary"
          disabled={loading || locked}
          onClick={() => void channelsLoad()}
        >
          Reload stored channels
        </button>
      )}
      {account && (
        <button
          className="cp-secondary"
          disabled={loading || busy}
          onClick={() => {
            outbox.clearCompleted();
            void threadsLoad(account, before);
          }}
        >
          Refresh thread progress
        </button>
      )}
      {loading && <p role="status">Reading stored thread evidence…</p>}
      {page && (
        <>
          {!page.canImport && (
            <p>
              This channel’s connection is unavailable for imports. Retained threads and their
              latest import status remain visible.
            </p>
          )}
          {!page.threads.length && (
            <p>No observed threads on this page. This does not mean the channel has no replies.</p>
          )}
          {!!page.threads.length && (
            <div className="space-y-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={locked || !canEdit || !page.canImport}
                  checked={selected.length === page.threads.length}
                  onChange={(e) =>
                    setSelected(e.target.checked ? page.threads.map((t) => t.sourceId) : [])
                  }
                />
                Select displayed threads ({page.threads.length})
              </label>
              {page.threads.map((t) => (
                <article key={t.sourceId} className="rounded border p-3 space-y-2">
                  <label className="flex gap-2 items-start">
                    <input
                      type="checkbox"
                      disabled={locked || !canEdit || !page.canImport}
                      checked={selected.includes(t.sourceId)}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, t.sourceId]
                            : old.filter((id) => id !== t.sourceId),
                        )
                      }
                    />
                    <span className="min-w-0 break-words">
                      {t.excerpt || "Message without text"}
                      <span className="block text-sm">
                        Thread started {new Date(Number(t.parentTimestamp) * 1000).toLocaleString()}
                        {t.observedTimestamp !== t.parentTimestamp
                          ? " · identified through a stored reply"
                          : ""}
                      </span>
                    </span>
                  </label>
                  <p className="font-medium">{slackThreadProgress(t.latestImport)}</p>
                  {t.latestImport && (
                    <div className="text-sm space-y-1">
                      <p>
                        Latest approved window: {display(t.latestImport.start)} –{" "}
                        {display(t.latestImport.end)}
                      </p>
                      <p>
                        {t.latestImport.pages} of up to {t.latestImport.pageLimit} pages captured.
                        This is a page budget, not a total-message percentage.
                      </p>
                      {t.latestImport.availableAt && (
                        <p>
                          Eligible to run from {display(t.latestImport.availableAt)}; execution time
                          depends on the worker.
                        </p>
                      )}
                      {t.latestImport.complete && (
                        <p>Applies to this observed thread and window only.</p>
                      )}
                      <button
                        type="button"
                        className="cp-secondary"
                        onClick={() =>
                          setRecoveryTarget({
                            accountId: page.accountId,
                            importId: t.latestImport!.id,
                          })
                        }
                      >
                        Review thread progress &amp; recovery
                      </button>
                      {t.latestImport.errorCode && (
                        <p>Support reference: {t.latestImport.errorCode}</p>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {before && (
              <button
                className="cp-secondary"
                disabled={loading || locked}
                onClick={() => void threadsLoad(account)}
              >
                Newest threads
              </button>
            )}
            {page.nextCursor && (
              <button
                className="cp-secondary"
                disabled={loading || locked}
                onClick={() => void threadsLoad(account, page.nextCursor)}
              >
                Older threads
              </button>
            )}
          </div>
          {!!page.threads.length && !outbox.draft && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void approve();
              }}
            >
              <fieldset className="space-y-3" disabled={locked || !canEdit || !page.canImport}>
                <p>
                  Import replies for the selected threads over a past period of up to 24 hours.
                  Times use your device’s local timezone. Existing evidence stays in place.
                </p>
                <label className="block">
                  Replies from
                  <input
                    type="datetime-local"
                    className="block w-full rounded border p-2"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  Replies until
                  <input
                    type="datetime-local"
                    className="block w-full rounded border p-2"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    required
                  />
                </label>
                <label className="block">
                  Page limit per thread
                  <input
                    type="number"
                    className="block w-full rounded border p-2"
                    value={limit}
                    min={1}
                    max={10}
                    step={1}
                    onChange={(e) => setLimit(Number(e.target.value))}
                    required
                  />
                </label>
                <p>
                  Up to 15 messages per page. Reaching the limit leaves that window incomplete.
                  Attachment downloads are not included.
                </p>
                <label className="block">
                  Reason
                  <textarea
                    className="block w-full rounded border p-2"
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                  />
                </label>
              </fieldset>
              <button
                type="submit"
                className="cp-secondary"
                disabled={
                  !canEdit ||
                  !page.canImport ||
                  busy ||
                  allConfirmed ||
                  !outbox.ready ||
                  !selected.length
                }
              >
                {busy
                  ? "Recording requests…"
                  : allConfirmed
                    ? "Requests recorded"
                    : `Approve ${selected.length} thread import${selected.length === 1 ? "" : "s"}`}
              </button>
            </form>
          )}
        </>
      )}
      {!canEdit && <p>Only your company’s owner or admin can approve imports.</p>}
      {notice && <p role={readError ? "alert" : "status"}>{notice}</p>}
    </section>
  );
}
