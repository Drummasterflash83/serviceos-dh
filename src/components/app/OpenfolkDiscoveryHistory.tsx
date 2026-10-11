import { useEffect, useState } from "react";
import type { DiscoveryHistoryPage, DiscoveryHistoryQuery } from "@/lib/openfolk";
import type { ApiResult } from "@/lib/types";

export type HistoryLoader = (
  query: DiscoveryHistoryQuery,
) => Promise<ApiResult<DiscoveryHistoryPage>>;
const when = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Time unavailable";

export function OpenfolkDiscoveryHistory({ load }: { load: HistoryLoader }) {
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState({ provider: "", status: "" });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<DiscoveryHistoryPage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setResult(null);
    setError(null);
    void load({
      page_size: 25,
      provider: filter.provider || undefined,
      status: filter.status || undefined,
      cursor: cursors[page],
    })
      .then((response) => {
        if (!active) return;
        if (!response.ok) {
          setError(response.error.message);
          return;
        }
        const data = response.data;
        if (
          !Array.isArray(data.runs) ||
          data.page !== page ||
          data.page_size !== 25 ||
          !Number.isSafeInteger(data.total) ||
          data.total < 0 ||
          data.runs.length > 25 ||
          typeof data.as_of !== "string" ||
          !Number.isFinite(Date.parse(data.as_of)) ||
          typeof data.has_more !== "boolean" ||
          (data.has_more && !data.next_cursor)
        ) {
          setError("History response is incomplete. Refresh to try again.");
          return;
        }
        setResult(data);
      })
      .catch(() => {
        if (active) setError("History could not be loaded. Refresh to try again.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [load, filter, cursors, page, refresh]);
  const restart = () => {
    setPage(0);
    setCursors([null]);
    setRefresh((n) => n + 1);
  };
  return (
    <section
      className="rounded-xl border border-hairline bg-white p-4 sm:p-5"
      aria-label="Discovery and sync history"
    >
      <h3 className="text-sm font-semibold text-display">Discovery and sync history</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Recorded Phone, Email and file-import runs. A successful run does not establish complete
        capture or current connection health.
      </p>
      <form
        className="my-3 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter({ provider: provider.trim(), status: status.trim() });
          restart();
        }}
      >
        <label className="text-xs">
          Provider or source
          <input
            aria-label="History provider or source"
            maxLength={128}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="All providers"
            className="mt-1 block rounded border border-hairline px-2 py-1.5"
            disabled={busy}
          />
        </label>
        <label className="text-xs">
          Run status
          <input
            aria-label="History run status"
            maxLength={128}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            className="mt-1 block rounded border border-hairline px-2 py-1.5"
            disabled={busy}
          />
        </label>
        <button
          type="submit"
          className="rounded border border-hairline px-3 py-1.5 text-xs"
          disabled={busy}
        >
          Apply filters
        </button>
        <button
          type="button"
          className="rounded border border-hairline px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => {
            setProvider("");
            setStatus("");
            setFilter({ provider: "", status: "" });
            restart();
          }}
        >
          Clear filters
        </button>
        <button
          type="button"
          className="rounded border border-hairline px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={restart}
        >
          Refresh history
        </button>
      </form>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Loading history…
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error} Refresh history to restart from the latest records.
        </p>
      )}
      {result && (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            {result.total} matching runs · Page {page + 1} · Observed {when(result.as_of)}
          </p>
          {result.runs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recorded runs match these filters.</p>
          ) : (
            <ol className="space-y-2">
              {result.runs.map((run) => (
                <li
                  key={`${run.source}:${run.run_id}`}
                  className="rounded-lg border border-hairline p-3 text-xs"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>
                      {run.provider ?? "Unknown provider"} · {run.capability ?? "Unspecified run"}
                    </strong>
                    <span>{run.status ?? "Status unavailable"}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Started {when(run.started_at)} · Completed {when(run.completed_at)}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Processed: {run.scanned ?? "unavailable"}
                    {run.failed !== null ? ` · Invalid rows: ${run.failed}` : ""}
                    {run.warnings !== null ? ` · Duplicates: ${run.warnings}` : ""}
                  </p>
                  {run.error && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-destructive">
                      {run.error}
                    </p>
                  )}
                  <details className="mt-2 text-muted-foreground">
                    <summary>Run reference</summary>
                    <p className="break-all">
                      {run.source} · {run.run_id}
                    </p>
                  </details>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded border border-hairline px-3 py-1.5 text-xs"
              disabled={busy || page === 0}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous history page
            </button>
            <button
              type="button"
              className="rounded border border-hairline px-3 py-1.5 text-xs"
              disabled={busy || !result.has_more}
              onClick={() => {
                if (!result.next_cursor) return;
                setCursors((old) => [...old.slice(0, page + 1), result.next_cursor]);
                setPage((n) => n + 1);
              }}
            >
              Next history page
            </button>
          </div>
        </>
      )}
    </section>
  );
}
