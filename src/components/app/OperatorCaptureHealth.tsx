import { useEffect, useRef, useState } from "react";
import { getSupabaseClient } from "@/lib/supabase";
import {
  captureHealthSignal,
  readCaptureHealth,
  type CaptureHealthPage,
  type CaptureHealthRow,
} from "@/lib/learn-operator-capture-health";
import type { OperatorInputClient } from "@/lib/learn-operator-inputs";

export function OperatorCaptureHealth({
  tenantId,
  actorId,
  client,
}: {
  tenantId: string;
  actorId: string;
  client?: OperatorInputClient;
}) {
  const [page, setPage] = useState<CaptureHealthPage | null>(null),
    [rows, setRows] = useState<CaptureHealthRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now());
  const generation = useRef(0),
    working = useRef(false);
  async function load(after: string | null = null) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    const ticket = ++generation.current;
    try {
      const next = await readCaptureHealth(client ?? getSupabaseClient(), tenantId, after);
      if (ticket !== generation.current) return;
      setRows((old) => (after ? [...old, ...next.rows] : next.rows));
      setPage(next);
      setNow(Date.now());
    } catch {
      if (ticket === generation.current) {
        setPage(null);
        setRows([]);
        setError(
          "Capture status is unavailable. Check operator access and the health service, then refresh.",
        );
      }
    } finally {
      if (ticket === generation.current) {
        working.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    working.current = false;
    setPage(null);
    setRows([]);
    setError("");
    void load();
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      generation.current++;
      clearInterval(timer);
    };
  }, [tenantId, actorId, client]);
  const stamp = (v: string | null) => (v ? new Date(v).toLocaleString("en-GB") : "Not recorded");
  return (
    <section className="cp-card space-y-4" aria-labelledby="operator-capture-heading">
      <header className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            OpenFolk · input evidence
          </p>
          <h2 id="operator-capture-heading" className="text-xl font-semibold">
            Email, phone and Slack capture
          </h2>
          <p className="text-sm">
            Recorded account activity and the next operator check. Message content and credentials
            are excluded.
          </p>
        </div>
        <button className="cp-secondary" disabled={busy} onClick={() => void load()}>
          {busy ? "Checking…" : "Refresh capture status"}
        </button>
      </header>
      {error && <p role="status">{error}</p>}
      {page && (
        <>
          <p className="text-xs text-muted-foreground">
            Latest page checked {stamp(page.checked_at)}. Recorded activity does not prove complete
            source coverage. Refresh to see new worker results.
          </p>
          {!rows.length && (
            <p>
              No email, phone or Slack accounts were returned for this company. Check connector
              setup before assuming capture is running.
            </p>
          )}
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => {
              const signal = captureHealthSignal(r, now);
              return (
                <article
                  key={r.key}
                  className="rounded-xl border p-4 space-y-2"
                  aria-label={`${r.source} capture: ${r.label}`}
                >
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {r.source} ·{" "}
                    {r.provider === "simwood"
                      ? "Registered telephony account"
                      : r.provider.replaceAll("_", " ")}
                  </p>
                  <h3 className="font-semibold">{r.label}</h3>
                  <p
                    className={
                      signal.tone === "attention" ? "font-medium text-amber-800" : "font-medium"
                    }
                  >
                    {signal.label}
                  </p>
                  <p className="text-sm">{signal.action}</p>
                  <dl className="text-xs space-y-1">
                    {r.source === "slack" && r.latest_job && (
                      <div>
                        <dt className="inline">Latest job completed: </dt>
                        <dd className="inline">{stamp(r.latest_job.completed_at)}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="inline">Last recorded success: </dt>
                      <dd className="inline">{stamp(r.last_success_at)}</dd>
                    </div>
                    <div>
                      <dt className="inline">Last recorded issue: </dt>
                      <dd className="inline">{stamp(r.last_failure_at)}</dd>
                    </div>
                  </dl>
                  {r.source === "slack" && (
                    <p className="text-xs">
                      This card covers the latest approved channel history job. Thread imports are
                      reviewed separately.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
          {page.next_cursor && (
            <button
              className="cp-secondary"
              disabled={busy}
              onClick={() => void load(page.next_cursor)}
            >
              Load more accounts
            </button>
          )}
          <p className="text-sm">
            These are diagnostic reads. Capture permission is managed separately in LEARN capture
            settings. A permitted source still needs a working connection and capture schedule.
          </p>
        </>
      )}
    </section>
  );
}
