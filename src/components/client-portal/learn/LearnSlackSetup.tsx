import { useEffect, useRef, useState } from "react";
import { LearnSlackRecovery } from "./LearnSlackRecovery";
import { LearnSlackThreads } from "./LearnSlackThreads";
import { getSupabaseClient } from "@/lib/supabase";
import {
  loadSlackConnections,
  validateSlackImportRequest,
  slackChannelId,
  startSlackImport,
  type SlackConnectionOption,
  type SlackImportRequest,
} from "@/lib/learn-slack-setup";
const local = (ms: number) => {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export function LearnSlackSetup({
  tenantId,
  actorId,
  canEdit,
}: {
  tenantId: string;
  actorId: string;
  canEdit: boolean;
}) {
  const [view, setView] = useState<"channel" | "threads" | "recovery">("recovery");
  const [connections, setConnections] = useState<SlackConnectionOption[] | null>(null),
    [loading, setLoading] = useState(true),
    [notice, setNotice] = useState("");
  const [channel, setChannel] = useState(""),
    [start, setStart] = useState(() => local(Date.now() - 86400000)),
    [end, setEnd] = useState(() => local(Date.now())),
    [pages, setPages] = useState(3),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [queued, setQueued] = useState(false);
  const pending = useRef<SlackImportRequest | null>(null),
    generation = useRef(0);
  async function load() {
    const ticket = ++generation.current;
    setLoading(true);
    setNotice("");
    try {
      const result = await loadSlackConnections(getSupabaseClient(), tenantId);
      if (ticket === generation.current) setConnections(result);
    } catch {
      if (ticket === generation.current) {
        setConnections(null);
        setNotice("Slack connection details are unavailable. Reload to try again.");
      }
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [tenantId]);
  async function submit() {
    if (!canEdit || busy || queued) return;
    const connection = connections?.[0];
    if (!connection) return;
    const id = slackChannelId(channel, connection.teamId);
    if (!pending.current && !id) {
      setNotice("Paste a channel ID or an app.slack.com channel link from the selected workspace.");
      return;
    }
    const ticket = generation.current;
    setBusy(true);
    setNotice("");
    try {
      const request = pending.current ?? {
        requestId: crypto.randomUUID(),
        tenantId,
        connection,
        channelId: id!,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        maxPages: pages,
        reason,
      };
      validateSlackImportRequest(request);
      // Keep the same immutable request after any uncertain network outcome.
      pending.current = request;
      setSubmitted(true);
      const receipt = await startSlackImport(getSupabaseClient(), request);
      if (ticket === generation.current) {
        setQueued(true);
        setNotice(
          receipt.reused
            ? "This request was already recorded. No second job was created. This receipt does not establish the current import status."
            : "Import queued. The worker will check Slack access before reading messages. Queueing does not confirm import completion.",
        );
      }
    } catch (error) {
      if (ticket === generation.current)
        setNotice(
          error instanceof Error
            ? error.message
            : "Import was not confirmed. Retry the same request.",
        );
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Slack import type" className="flex flex-wrap gap-2">
        <button
          type="button"
          id="slack-recovery-tab"
          aria-pressed={view === "recovery"}
          aria-controls="slack-recovery-panel"
          className={view === "recovery" ? "cp-primary" : "cp-secondary"}
          onClick={() => setView("recovery")}
        >
          Progress &amp; recovery
        </button>
        <button
          type="button"
          id="slack-channel-tab"
          aria-pressed={view === "channel"}
          aria-controls="slack-channel-panel"
          className={view === "channel" ? "cp-primary" : "cp-secondary"}
          onClick={() => setView("channel")}
        >
          Channel messages
        </button>
        <button
          type="button"
          id="slack-threads-tab"
          aria-pressed={view === "threads"}
          aria-controls="slack-threads-panel"
          className={view === "threads" ? "cp-primary" : "cp-secondary"}
          onClick={() => setView("threads")}
        >
          Thread replies
        </button>
      </div>
      <div
        id="slack-recovery-panel"
        role="region"
        aria-labelledby="slack-recovery-tab"
        hidden={view !== "recovery"}
      >
        <LearnSlackRecovery
          key={`${actorId}:${tenantId}`}
          tenantId={tenantId}
          actorId={actorId}
          canEdit={canEdit}
        />
      </div>
      <div
        id="slack-channel-panel"
        role="region"
        aria-labelledby="slack-channel-tab"
        hidden={view !== "channel"}
        className="space-y-4"
      >
        <p>
          Use an existing company Slack connection to import one public channel for a chosen period.
          Existing emails, calls and stored messages remain in place.
        </p>
        {loading ? (
          <p role="status">Reading Slack connections…</p>
        ) : connections?.length === 0 ? (
          <p>
            No configured company Slack connection is available. A company Slack bot connection must
            be configured before importing. This form does not create credentials. Notification
            connections alone do not establish history access.
          </p>
        ) : (
          connections && (
            <p>
              Workspace: <strong>{connections[0].name}</strong>
            </p>
          )
        )}
        {!submitted && (
          <button className="cp-secondary" onClick={() => void load()} disabled={loading}>
            Reload connections
          </button>
        )}
        {!!connections?.length && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <fieldset disabled={!canEdit || busy || submitted} className="space-y-3">
              <label className="block">
                Public channel link or ID
                <input
                  className="block w-full rounded border p-2"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value)}
                  placeholder="https://app.slack.com/client/T…/C…"
                  required
                />
              </label>
              <p>
                Start and end use your device’s local time. Choose a past period of up to 24 hours.
              </p>
              <label className="block">
                From
                <input
                  type="datetime-local"
                  className="block w-full rounded border p-2"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                Until
                <input
                  type="datetime-local"
                  className="block w-full rounded border p-2"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                Page limit
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  className="block w-full rounded border p-2"
                  value={pages}
                  onChange={(e) => setPages(Number(e.target.value))}
                  required
                />
              </label>
              <p>
                Each page contains up to 15 messages. Reaching the limit leaves the period
                incomplete. Threads, private or shared channels, and attachment downloads are not
                included in this import.
              </p>
              <label className="block">
                Reason for this import
                <textarea
                  className="block w-full rounded border p-2"
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
            </fieldset>
            <button className="cp-secondary" disabled={!canEdit || busy || queued} type="submit">
              {queued
                ? "Request recorded"
                : busy
                  ? "Queueing…"
                  : submitted
                    ? "Retry same request"
                    : "Approve and queue import"}
            </button>
          </form>
        )}
        {!canEdit && <p>Only your company’s owner or admin can approve an import.</p>}
        {notice && <p role="status">{notice}</p>}
      </div>
      <div
        id="slack-threads-panel"
        role="region"
        aria-labelledby="slack-threads-tab"
        hidden={view !== "threads"}
      >
        <LearnSlackThreads key={tenantId} tenantId={tenantId} canEdit={canEdit} />
      </div>
    </div>
  );
}
