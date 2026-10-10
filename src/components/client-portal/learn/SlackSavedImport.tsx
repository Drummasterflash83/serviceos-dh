import type { useSlackImportOutbox } from "./useSlackImportOutbox";
export function SlackSavedImport({
  outbox,
  canEdit,
}: {
  outbox: ReturnType<typeof useSlackImportOutbox>;
  canEdit: boolean;
}) {
  const d = outbox.draft ?? outbox.completed;
  return (
    <div className="space-y-3">
      {d && (
        <section className="rounded border p-3 space-y-2" aria-label="Saved import review">
          <strong>
            {outbox.draft ? "Saved imports awaiting resolution" : "Import review resolved"}
          </strong>
          <p>
            {d.entries.filter((e) => !!e.receipt).length} of {d.entries.length} requests confirmed
            {d.entries.some((e) => e.skipped)
              ? ` · ${d.entries.filter((e) => e.skipped).length} rejected request${d.entries.filter((e) => e.skipped).length === 1 ? "" : "s"} cleared`
              : ""}
            .
          </p>
          {d.entries.map((e) => (
            <div key={e.request.requestId} className="border-t pt-2 text-sm">
              <p>
                {e.kind === "channel"
                  ? `${e.request.connection.name} · ${e.request.channelId}`
                  : `Thread started ${new Date(Number(e.request.parentTimestamp) * 1000).toLocaleString()}`}
              </p>
              <p>
                {new Date(e.request.start).toLocaleString()} –{" "}
                {new Date(e.request.end).toLocaleString()} · up to {e.request.maxPages} pages
              </p>
              <p className="break-words">{e.request.reason}</p>
              <p>
                {e.receipt
                  ? "Confirmed — evidence capture not yet verified"
                  : e.skipped
                    ? "Rejected request cleared"
                    : outbox.rejection?.requestId === e.request.requestId
                      ? "Rejected — review source details"
                      : "Awaiting confirmation"}
              </p>
            </div>
          ))}
          {outbox.draft && (
            <>
              <p>
                Reloading or refreshing progress keeps these requests. Retry uses their original IDs
                and skips confirmed requests.
              </p>
              <button
                className="cp-secondary"
                disabled={!canEdit || outbox.busy || !outbox.ready}
                onClick={() => void outbox.submit()}
              >
                {outbox.busy ? "Recording requests…" : "Retry saved requests"}
              </button>
              {outbox.rejection && (
                <div className="space-y-2">
                  <p>
                    One request was explicitly rejected. Clearing it leaves all other pending
                    requests and existing evidence in place.
                  </p>
                  <button
                    className="cp-secondary"
                    disabled={outbox.busy}
                    onClick={() => void outbox.skipRejected()}
                  >
                    Clear rejected request
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}
      <p className="text-sm">
        Unconfirmed approvals are saved in this browser for your account and company. Keep this
        browser’s data until resolved. They are not available on another device.
      </p>
      {!outbox.ready && (
        <button className="cp-secondary" onClick={() => outbox.reload()}>
          Reload saved imports
        </button>
      )}
      {outbox.notice && <p role="status">{outbox.notice}</p>}
    </div>
  );
}
