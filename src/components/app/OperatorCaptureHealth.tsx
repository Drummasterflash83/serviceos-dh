import { phoneProcessingSignal } from "@/lib/learn-phone-operator-evidence";
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
          {page.phone_processing &&
            (page.phone_processing.total > 0 || rows.some((r) => r.source === "phone")) && (
              <section
                className="rounded-xl border p-4 space-y-3"
                aria-label="Company phone recording processing"
              >
                <div>
                  <h3 className="font-semibold">Phone recording processing</h3>
                  <p className="text-sm">
                    Company-wide retained recordings, across its phone accounts.
                  </p>
                </div>
                <p className="font-medium">{phoneProcessingSignal(page.phone_processing).label}</p>
                <p className="text-sm">{phoneProcessingSignal(page.phone_processing).action}</p>
                <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                  {(
                    [
                      ["Stored recordings", page.phone_processing.total],
                      ["Audio, transcript and analysis saved", page.phone_processing.complete],
                      ["Audio download pending", page.phone_processing.download_pending],
                      ["Transcript pending", page.phone_processing.transcribe_pending],
                      ["Analysis pending", page.phone_processing.analyse_pending],
                      ["Held for review", page.phone_processing.needs_review],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-semibold">{value.toLocaleString("en-GB")}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">
                  Pending work: {page.phone_processing.ready.toLocaleString("en-GB")} ready ·{" "}
                  {page.phone_processing.cooling_down.toLocaleString("en-GB")} waiting to retry ·{" "}
                  {page.phone_processing.recent_processing.toLocaleString("en-GB")} with recent
                  processing attempts ·{" "}
                  {page.phone_processing.waiting_provider.toLocaleString("en-GB")} awaiting a
                  provider ID or readiness ·{" "}
                  {page.phone_processing.unknown_retry.toLocaleString("en-GB")} not classified.
                  Review holds are included in the stage counts above.
                </p>
              </section>
            )}
          {!page.phone_processing && rows.some((r) => r.source === "phone") && (
            <p className="text-sm">
              Phone processing counts are not verified. Check the health service before treating the
              backlog as empty.
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
                    {r.source === "phone" && r.phone_evidence?.last_confirmed && (
                      <>
                        <div>
                          <dt className="inline">Confirmed capture through: </dt>
                          <dd className="inline">{stamp(r.phone_evidence.last_confirmed.to)}</dd>
                        </div>
                        <div>
                          <dt className="inline">Records saved in that window: </dt>
                          <dd className="inline">
                            {r.phone_evidence.last_confirmed.calls_processed.toLocaleString(
                              "en-GB",
                            )}{" "}
                            calls ·{" "}
                            {r.phone_evidence.last_confirmed.recordings_processed.toLocaleString(
                              "en-GB",
                            )}{" "}
                            recordings
                          </dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt className="inline">
                        {r.source === "phone"
                          ? "Account-reported success: "
                          : "Last recorded success: "}
                      </dt>
                      <dd className="inline">{stamp(r.last_success_at)}</dd>
                    </div>
                    <div>
                      <dt className="inline">Last recorded issue: </dt>
                      <dd className="inline">{stamp(r.last_failure_at)}</dd>
                    </div>
                  </dl>
                  {r.source === "phone" && (
                    <p className="text-xs">
                      Scheduled capture evidence only. This read does not verify that a schedule is
                      configured or enabled.
                    </p>
                  )}
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
